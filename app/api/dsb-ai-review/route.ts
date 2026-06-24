/**
 * POST /api/dsb-ai-review
 * ----------------------------------------------------------------------------
 * On-demand AI compliance review for a single case.
 *
 * What it does:
 *   1. Loads the case + its first upload + every active checklist item
 *      (globals + tenant-specific overrides).
 *   2. Downloads the PDF via a signed URL.
 *   3. Sends the PDF + the checklist items to Claude with explicit verdict
 *      instructions.
 *   4. Upserts one dsb_case_checklist_responses row per item:
 *        - ai_suggested_status  ← AI's verdict (verified/issue/not_mentioned/not_attached)
 *        - ai_suggested_notes   ← short Arabic rationale
 *        - status               ← pre-filled with AI verdict
 *        - notes                ← pre-filled with AI rationale
 *      so the reviewer arrives to a fully populated checklist they can
 *      sweep through and accept-or-edit via the existing Save All flow.
 *   5. Writes an `ai_review_complete` audit log entry.
 *   6. Returns { ok, verdicts, cost_usd, model, tokens }.
 *
 * Runtime: Node.js (PDFs + Anthropic SDK), maxDuration 120s.
 */

import { NextResponse } from 'next/server'
import { createSupabaseService, createSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 120

const CHECKLIST_VERDICTS = ['verified', 'issue', 'not_mentioned', 'not_attached'] as const
type ChecklistVerdict = (typeof CHECKLIST_VERDICTS)[number]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

// Same Pricing table as /api/dsb-extract — keep in sync with Anthropic billing.
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-haiku-4-5-20251001':  { input: 0.80, output: 4.00, cacheRead: 0.08, cacheWrite: 1.00 },
  'claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
}

/**
 * Robust JSON extractor — handles:
 *   - raw JSON
 *   - ```json … ``` fenced blocks with arbitrary whitespace/newlines
 *   - prose preambles before the JSON
 *   - TRUNCATED arrays (max_tokens hit mid-object) — repair by trimming the
 *     last incomplete element and closing the bracket so we keep whatever
 *     verdicts the AI managed to write before running out of room.
 */
function extractJson(text: string): unknown {
  // 1. Remove all ```language fences anywhere in the text, not just at edges.
  const stripped = text
    .replace(/```(?:json|jsonc)?\s*/gi, '')
    .replace(/```/g, '')
    .trim()
  try {
    return JSON.parse(stripped)
  } catch {
    /* fall through */
  }

  // 2. Find the JSON array (preferred for ai-review output).
  const firstA = stripped.indexOf('[')
  if (firstA >= 0) {
    const lastA = stripped.lastIndexOf(']')
    if (lastA > firstA) {
      try {
        return JSON.parse(stripped.slice(firstA, lastA + 1))
      } catch {
        /* might be truncated — fall through to repair */
      }
    }
    // 3. Repair a truncated array: walk objects, keep complete ones, close `]`.
    const repaired = repairTruncatedArray(stripped.slice(firstA))
    if (repaired) {
      try {
        return JSON.parse(repaired)
      } catch {
        /* fall through */
      }
    }
  }

  // 4. Object form fallback (in case the AI ignored the array spec).
  const first = stripped.indexOf('{')
  const last = stripped.lastIndexOf('}')
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(stripped.slice(first, last + 1))
    } catch {
      /* fall through */
    }
  }

  throw new Error('Claude returned non-JSON: ' + text.slice(0, 300))
}

/**
 * Given a string starting with `[` that may be truncated, walk through it
 * tracking string/brace depth and return a string that ends at the boundary
 * of the last COMPLETE object inside the array — closed with `]`.
 */
function repairTruncatedArray(s: string): string | null {
  let depth = 0
  let inString = false
  let escape = false
  let lastCompleteObjectEnd = -1
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) lastCompleteObjectEnd = i
    }
  }
  if (lastCompleteObjectEnd === -1) return null
  return s.slice(0, lastCompleteObjectEnd + 1) + ']'
}

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function POST(req: Request) {
  const svc = createSupabaseService()

  // ----- Parse body (we need tenant_id for the secret-auth path) -----
  let body: unknown
  try { body = await req.json() } catch { return jsonError('invalid JSON body') }
  const { case_id, tenant_id: bodyTenantId } = (body || {}) as {
    case_id?: unknown
    tenant_id?: unknown
  }
  if (!isUuid(case_id)) return jsonError('case_id must be UUID')

  // ----- Auth: two paths -----
  // (1) Shared-secret (server-to-server). Used by /api/dsb-extract to chain
  //     the review automatically after extraction. Caller passes tenant_id
  //     in the body since there's no user session.
  // (2) Cookie-based (a signed-in user pressing the on-demand review button).
  let tenantId: string
  let callerUserId: string | null
  const expectedSecret = process.env.DSB_EXTRACT_SECRET
  const providedSecret = req.headers.get('x-dsb-secret')
  if (expectedSecret && providedSecret === expectedSecret) {
    if (!isUuid(bodyTenantId)) return jsonError('tenant_id required for secret auth')
    tenantId = bodyTenantId
    callerUserId = null
  } else {
    const supabase = createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) return jsonError('not signed in', 401)
    const { data: profile } = await svc
      .from('users')
      .select('id, tenant_id, dsb_role')
      .eq('email', user.email)
      .maybeSingle()
    if (!profile) return jsonError('not linked to a tenant', 403)
    const callerRole = (profile.dsb_role as string | null) ?? null
    if (!callerRole || !['employee', 'supervisor', 'owner'].includes(callerRole)) {
      return jsonError('no permission', 403)
    }
    tenantId = profile.tenant_id as string
    callerUserId = profile.id as string
  }

  try {
    // ----- 1. Load case + first upload + checklist items -----
    const { data: caseRow } = await svc
      .from('dsb_cases')
      .select(`
        id, tenant_id, case_number,
        uploads:dsb_uploads(id, filename, storage_path, storage_bucket)
      `)
      .eq('id', case_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!caseRow) return jsonError('case not found', 404)

    const uploads = (caseRow as { uploads?: unknown[] }).uploads ?? []
    if (!Array.isArray(uploads) || uploads.length === 0) {
      return jsonError('case has no uploads', 400)
    }
    const upload = uploads[0] as { storage_path: string; storage_bucket: string | null }

    const { data: checklistRaw } = await svc
      .from('dsb_checklist_items')
      .select('id, code, prompt_ar, order_index')
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .eq('active', true)
      .order('order_index', { ascending: true })
    const checklistItems = ((checklistRaw ?? []) as Array<{
      id: string; code: string; prompt_ar: string; order_index: number
    }>)
    if (checklistItems.length === 0) {
      return jsonError('no active checklist items configured', 400)
    }

    // ----- 2. Download PDF -----
    const bucket = upload.storage_bucket || 'Document submission'
    const { data: signed, error: signErr } = await svc.storage
      .from(bucket)
      .createSignedUrl(upload.storage_path, 600)
    if (signErr || !signed?.signedUrl) {
      throw new Error('signed URL failed: ' + (signErr?.message || 'no URL'))
    }
    const pdfResp = await fetch(signed.signedUrl, { signal: AbortSignal.timeout(30_000) })
    if (!pdfResp.ok) throw new Error(`PDF download failed: HTTP ${pdfResp.status}`)
    const pdfBase64 = Buffer.from(await pdfResp.arrayBuffer()).toString('base64')

    // ----- 3. Call Claude with checklist evaluation prompt -----
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

    const systemPrompt = `You are a methodical compliance reviewer for Saudi real-estate disbursement vouchers. The PDF is in Arabic. You will be given a numbered checklist. You MUST process the items strictly one at a time, in the order given.

PROTOCOL — REPEAT FOR EVERY ITEM IN ORDER:
  STEP A — READ: Re-read the Arabic prompt of the current item carefully so you know exactly what is being asked.
  STEP B — SEARCH: Scan the PDF looking for the specific section, signature, value, date, calculation, or attachment that would satisfy this item. Note the page number(s) where evidence appears (or note that nothing was found).
  STEP C — RECORD EVIDENCE: Write down what you observed in the PDF for this item — even if nothing — in the "evidence_ar" field. Keep this CONCISE (≤ 15 Arabic words). Be factual ("ظهر التوقيع في الصفحة ٣"), not a conclusion.
  STEP D — DECIDE VERDICT:
     - "verified"      — clearly satisfied / present in the document with the expected value, format, date, or signature.
     - "issue"         — addressed but flawed: wrong value, missing field, mismatched name, expired date, calculation error, illegible signature, etc.
     - "not_mentioned" — the document does not address this item at all.
     - "not_attached"  — the item references a supporting document (invoice/receipt/certificate/contract/proof) that is NOT present in the PDF.
  STEP E — RATIONALE: One brief Arabic sentence (≤ 15 words) explaining WHY you chose this verdict.

After finishing one item, move to the next. Do NOT batch items. Do NOT skip items. Do NOT change the order. Do NOT invent evidence — if you can't find something, say so honestly.

If you are uncertain between two verdicts, prefer "issue" over "verified" (we want the reviewer's attention drawn to uncertain cases). Prefer "not_attached" over "not_mentioned" when the item asks for an external supporting document.

Return ONLY a JSON array with one object per item, IN THE SAME ORDER as the input. No prose, no markdown, no fences. Shape:
[
  {
    "code":         "ITEM_CODE",
    "evidence_ar":  "ما لاحظته في الوثيقة لهذا البند تحديدًا — وقائع فقط، لا استنتاجات.",
    "page_ref":     "ص ٣"  OR  "ص ٢-٤"  OR  "غير موجود",
    "status":       "verified" | "issue" | "not_mentioned" | "not_attached",
    "rationale_ar": "جملة قصيرة تشرح القرار."
  },
  ...
]

CRITICAL: the output array length MUST equal the input checklist length. Every item code from the input must appear exactly once in the output.`

    const userText = `Below is the numbered checklist. Go through it strictly item-by-item, in order. Return one JSON object per item with the verdict and a one-sentence Arabic rationale that cites the page or evidence.

${checklistItems.map((it, idx) => `${idx + 1}. ${it.code} — ${it.prompt_ar}`).join('\n')}

Reminder: return JSON array only — no prose, no markdown.`

    const claudeBody = {
      model: process.env.DSB_EXTRACT_MODEL || 'claude-haiku-4-5-20251001',
      // Each item carries 5 fields (code, evidence_ar, page_ref, status,
      // rationale_ar). With 19 items and Arabic verbosity that's typically
      // 2-3k output tokens; 6000 gives comfortable headroom so we don't
      // truncate mid-array. extractJson also self-heals truncated arrays as
      // a safety net.
      max_tokens: 6000,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: userText },
          ],
        },
      ],
    }

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(claudeBody),
      signal: AbortSignal.timeout(90_000),
    })
    if (!claudeResp.ok) {
      const errBody = await claudeResp.text().catch(() => '')
      // Translate the common "PDF too large" error into something the
      // Arabic-speaking reviewer can act on.
      if (errBody.includes('maximum of 100 PDF pages') || errBody.includes('PDF pages may be provided')) {
        throw new Error(
          'الوثيقة تتجاوز الحد الأقصى المسموح به (١٠٠ صفحة). يرجى تقسيم الوثيقة إلى ملفات أصغر وإعادة رفعها، أو استبدالها بنسخة مختصرة.',
        )
      }
      if (errBody.includes('document') && errBody.includes('size')) {
        throw new Error('حجم الوثيقة يتجاوز الحد المسموح به. يرجى ضغط الملف وإعادة المحاولة.')
      }
      throw new Error(`Claude API ${claudeResp.status}: ${errBody.slice(0, 300)}`)
    }

    const claudeJson = (await claudeResp.json()) as {
      content?: Array<{ type: string; text?: string }>
      model?: string
      usage?: {
        input_tokens?: number
        output_tokens?: number
        cache_creation_input_tokens?: number
        cache_read_input_tokens?: number
      }
    }
    const firstText = (claudeJson.content || []).find((b) => b.type === 'text' && typeof b.text === 'string')
    const claudeText = firstText?.text || ''
    if (!claudeText) throw new Error('Claude returned no text content')

    const usedModel = (claudeJson.model as string | undefined) || claudeBody.model
    const u = claudeJson.usage ?? {}
    const inputTok = u.input_tokens ?? 0
    const outputTok = u.output_tokens ?? 0
    const cacheReadTok = u.cache_read_input_tokens ?? 0
    const cacheWriteTok = u.cache_creation_input_tokens ?? 0
    const rate = PRICING[usedModel] ?? PRICING['claude-haiku-4-5-20251001']!
    const costUsd =
      (inputTok * rate.input + outputTok * rate.output + cacheReadTok * rate.cacheRead + cacheWriteTok * rate.cacheWrite) /
      1_000_000

    // ----- 4. Parse + persist -----
    const parsed = extractJson(claudeText)
    const verdictsRaw = Array.isArray(parsed) ? parsed : []

    const itemByCode = new Map<string, { id: string }>()
    for (const it of checklistItems) itemByCode.set(it.code, { id: it.id })

    type RowOut = {
      tenant_id: string
      case_id: string
      checklist_item_id: string
      status: ChecklistVerdict
      notes: string | null
      ai_suggested_status: ChecklistVerdict
      ai_suggested_notes: string | null
    }
    const rows: RowOut[] = []
    const seenCodes = new Set<string>()
    for (const r of verdictsRaw as Array<Record<string, unknown>>) {
      if (!r || typeof r !== 'object') continue
      const code = typeof r.code === 'string' ? r.code : ''
      const status = typeof r.status === 'string' ? r.status : ''
      const item = itemByCode.get(code)
      if (!item) continue
      if (seenCodes.has(code)) continue // ignore duplicates (only keep first)
      seenCodes.add(code)
      if (!(CHECKLIST_VERDICTS as readonly string[]).includes(status)) continue
      // Compose the reviewer-facing notes from evidence + rationale so the
      // human sees BOTH what the AI observed in the document AND why it
      // concluded that verdict. Order in Arabic: evidence first, then verdict.
      const evidence =
        typeof r.evidence_ar === 'string' && r.evidence_ar.trim()
          ? r.evidence_ar.trim()
          : ''
      const pageRef =
        typeof r.page_ref === 'string' && r.page_ref.trim()
          ? r.page_ref.trim()
          : ''
      const rationale =
        typeof r.rationale_ar === 'string' && r.rationale_ar.trim()
          ? r.rationale_ar.trim()
          : ''
      const compositeNotes = [
        evidence ? `الدليل: ${evidence}` : '',
        pageRef ? `(${pageRef})` : '',
        rationale ? `— ${rationale}` : '',
      ]
        .filter(Boolean)
        .join(' ')
        .slice(0, 500) || null

      rows.push({
        tenant_id: tenantId,
        case_id: case_id,
        checklist_item_id: item.id,
        status: status as ChecklistVerdict,
        notes: compositeNotes,
        ai_suggested_status: status as ChecklistVerdict,
        ai_suggested_notes: compositeNotes,
      })
    }

    if (rows.length === 0) {
      throw new Error('Claude returned no usable verdicts')
    }

    // Completeness check — flag any input items the AI skipped. We don't fail
    // the request because partial output is still useful, but we surface the
    // miss to the reviewer and the audit log.
    const missingItems = checklistItems.filter((it) => !seenCodes.has(it.code))
    if (missingItems.length > 0) {
      console.warn(
        '[dsb-ai-review] AI skipped checklist items:',
        missingItems.map((it) => it.code).join(', '),
      )
    }

    const { error: upErr } = await svc
      .from('dsb_case_checklist_responses')
      .upsert(rows, { onConflict: 'case_id,checklist_item_id' })
    if (upErr) throw new Error('checklist upsert failed: ' + upErr.message)

    // ----- 5. Audit -----
    const auditNotes =
      `AI compliance review — ${rows.length}/${checklistItems.length} verdicts (${usedModel}, $${costUsd.toFixed(4)})` +
      (missingItems.length > 0
        ? `; missed: ${missingItems.map((it) => it.code).join(',')}`
        : '')
    await svc.from('dsb_audit_log').insert({
      tenant_id: tenantId,
      case_id: case_id,
      event: 'ai_review_complete',
      actor_user_id: callerUserId,
      notes: auditNotes,
      occurred_at: new Date().toISOString(),
    })

    return NextResponse.json({
      ok: true,
      verdicts: rows.length,
      total_items: checklistItems.length,
      missed_codes: missingItems.map((it) => it.code),
      cost_usd: Number(costUsd.toFixed(6)),
      model: usedModel,
      tokens: { input: inputTok, output: outputTok, cache_read: cacheReadTok, cache_write: cacheWriteTok },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[dsb-ai-review] failed', { case_id, tenant_id: tenantId, error: message })
    try {
      await svc.from('dsb_audit_log').insert({
        tenant_id: tenantId,
        case_id: case_id,
        event: 'ai_review_failed',
        actor_user_id: callerUserId,
        notes: 'AI review failed: ' + message.slice(0, 500),
        occurred_at: new Date().toISOString(),
      })
    } catch { /* swallow audit log failures */ }
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
