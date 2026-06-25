/**
 * POST /api/dsb-extract
 * ----------------------------------------------------------------------------
 * In-process replacement for the old n8n "Disbursement Breakdown (AI)" workflow.
 *
 * Input  (JSON body): { case_id: string, tenant_id: string }
 * Auth   (header):    x-dsb-secret: <DSB_EXTRACT_SECRET>  (skipped if env unset)
 * Output (JSON):
 *   success → { ok: true, sections: number, autofilled: string[] }
 *   error   → { ok: false, error: string }              (HTTP 4xx/5xx)
 *
 * What it does (mirrors n8n/dsb-breakdown.json):
 *   1. Load the case + first upload + project + developer (service role).
 *   2. Get a signed URL for the PDF in Supabase Storage, download bytes.
 *   3. Send the PDF to Claude with the same system prompt as n8n, requesting
 *      {sections[], case_metadata{...extracted{...}}}.
 *   4. Parse JSON robustly (strip fences, fall back to substring).
 *   5. Build dsb_breakdown_items rows; clamp `kind` to enum.
 *   6. Compute an autofill update for dsb_cases columns that are CURRENTLY
 *      NULL/blank (never overwrite human-entered values).
 *   7. ALWAYS overwrite dsb_cases.extracted_fields with the latest AI blob.
 *   8. Insert rows + patch case + write audit log.
 *
 * Runtime: Node.js (NOT Edge) because we use Anthropic SDK + binary PDFs +
 * a long-running fetch. maxDuration=120s — well under Vercel Pro's 300s limit
 * and over Hobby's 60s ceiling (the user should be on Pro for this).
 */

import { NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { fireDsbAiReviewWebhook } from '@/lib/n8n/fire-dsb-ai-review'
import { pdfPageCount, splitPdfIntoChunks } from '@/lib/dsb/pdf-chunks'

// NOTE: We intentionally do NOT use the @anthropic-ai/sdk wrapper for this
// call. The installed SDK version (0.30.1) does not type the `document`
// content block needed for native PDF reading; it landed in later SDK
// versions. To avoid bumping dependencies we hand-roll the HTTP call directly
// to the Anthropic Messages API, which accepts PDFs as base64 documents.

export const runtime = 'nodejs'
export const maxDuration = 120

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const ALLOWED_KINDS = [
  'voucher',
  'invoice',
  'proof_of_payment',
  'completion_certificate',
  'contract',
  'receipt',
  'other',
] as const
type BreakdownKind = (typeof ALLOWED_KINDS)[number]

interface SectionRaw {
  kind?: unknown
  page_from?: unknown
  page_to?: unknown
  summary_ar?: unknown
}

interface CaseMetadataRaw {
  voucher_number_text?: unknown
  voucher_date?: unknown
  amount_sar?: unknown
  delivery_date?: unknown
  notes?: unknown
  extracted?: unknown
}

interface ClaudeJson {
  sections?: unknown
  case_metadata?: unknown
}

// ---------------------------------------------------------------------------
// System prompt — copied verbatim from n8n/dsb-breakdown.json "Build Claude
// Message". Do NOT edit casually; the JSON shape downstream depends on it.
// ---------------------------------------------------------------------------

// Tightened prompt — ~40% shorter than the original. Cached via Anthropic
// prompt caching (cache_control below) so repeated calls only pay full price
// for the first read; subsequent reads are billed at 10% of the input rate.
const SYSTEM_PROMPT = `Classify and extract fields from a Saudi real-estate disbursement voucher PDF (Arabic). Output ONE JSON object only — no prose, no fences. Shape:
{
  "sections": [{ "kind": "voucher"|"invoice"|"proof_of_payment"|"completion_certificate"|"contract"|"receipt"|"other", "page_from": int, "page_to": int, "summary_ar": string }],
  "case_metadata": {
    "voucher_number_text": string|null,
    "voucher_date": "YYYY-MM-DD"|null,
    "amount_sar": number|null,
    "delivery_date": "YYYY-MM-DD"|null,
    "notes": string|null,
    "extracted": {
      "developer_name_ar": string|null, "developer_name_en": string|null,
      "beneficiary_name_ar": string|null, "beneficiary_name_en": string|null,
      "beneficiary_account_number": string|null, "beneficiary_bank_name": string|null, "beneficiary_iban": string|null,
      "invoice_number": string|null, "invoice_date": "YYYY-MM-DD"|null,
      "invoice_total_sar": number|null, "invoice_vat_sar": number|null, "issued_to": string|null,
      "disbursement_type_label_ar": string|null,
      "disbursement_type_code": "admin_marketing"|"construction"|"bank_financing"|"moh_incentive"|"unit_seriousness_fees"|"vat_project_registry"|"vat_sales_payment"|"other"|null,
      "line_items": [{ "description_ar": string|null, "description_en": string|null, "quantity": number|null, "unit_price_sar": number|null, "line_total_sar": number|null }]|null,
      "confidence_overall": number
    }
  }
}

Rules:
- Sections must NOT overlap; page indices are 1-based.
- Missing field → null. Never guess.
- Preserve Arabic literally; transliterate names to English where natural.
- Money: numeric only (60000, not "60,000 SAR").
- Dates: ISO YYYY-MM-DD. Convert Hijri/Arabic-numerals.
- confidence_overall ∈ [0,1].

"نوع الصرف" (disbursement type) — find the TICKED option and map:
"مصاريف إدارية وتسويقية"→admin_marketing | "مصاريف إنشائية"→construction | "من قيمة تمويل بنكي"→bank_financing | "من قيمة حافز وزارة الإسكان"→moh_incentive | "رسوم الجدية في شراء الوحدة العقارية المختارة"→unit_seriousness_fees | "ضريبة القيمة المضافة عن السجل الضريبي للمشروع"→vat_project_registry | "سداد ضريبة القيمة المضافة المستلمة عن المبيعات للمشروع"→vat_sales_payment | other text→other. If nothing ticked → both fields null. Multiple ticks → pick best fit, note ambiguity in case_metadata.notes.`

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

function isValidIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

/**
 * Robust JSON extractor. Handles:
 *   - raw JSON
 *   - ```json ... ``` fenced blocks
 *   - prose preambles (falls back to first '{' .. last '}')
 */
function extractJson(text: string): unknown {
  const stripped = text.trim().replace(/^```(json)?/i, '').replace(/```$/i, '').trim()
  try {
    return JSON.parse(stripped)
  } catch {
    /* fall through */
  }
  const first = stripped.indexOf('{')
  const last = stripped.lastIndexOf('}')
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(stripped.slice(first, last + 1))
    } catch {
      /* fall through */
    }
  }
  throw new Error('Claude returned non-JSON: ' + text.slice(0, 200))
}

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status })
}

// ---------------------------------------------------------------------------
// GET — lightweight diagnostic. Open in a browser to confirm the route is
// deployed AND that the env vars the POST handler needs are present. Returns
// booleans only (never the actual secret values).
// ---------------------------------------------------------------------------

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: '/api/dsb-extract',
    runtime,
    env: {
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || null,
      VERCEL_URL: process.env.VERCEL_URL || null,
      DSB_EXTRACT_SECRET_required: !!process.env.DSB_EXTRACT_SECRET,
      SUPABASE_URL_set: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY_set: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    now: new Date().toISOString(),
  })
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  // ----- Auth (optional, skipped if secret not configured) -----
  const expectedSecret = process.env.DSB_EXTRACT_SECRET
  if (expectedSecret) {
    const provided = req.headers.get('x-dsb-secret')
    if (provided !== expectedSecret) {
      return jsonError('unauthorized', 401)
    }
  }

  // ----- Parse body -----
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError('invalid JSON body')
  }
  const { case_id, tenant_id } = (body || {}) as { case_id?: unknown; tenant_id?: unknown }
  if (!isUuid(case_id) || !isUuid(tenant_id)) {
    return jsonError('case_id and tenant_id must be UUIDs')
  }

  const svc = createSupabaseService()

  // We capture these for the catch-block audit log if anything goes wrong.
  const auditScope = { tenant_id, case_id }

  try {
    // ----- 1. Load case + first upload -----
    const { data: caseRow, error: caseErr } = await svc
      .from('dsb_cases')
      .select(
        `
        id, tenant_id, project_id, developer_id, case_number,
        voucher_number_text, voucher_date, amount_sar, delivery_date, notes,
        uploads:dsb_uploads(id, filename, storage_path, storage_bucket, file_size_bytes, mime_type, page_count),
        project:dsb_projects!dsb_cases_project_id_fkey(id, code, name_ar),
        developer:dsb_developers!dsb_cases_developer_id_fkey(id, company_name_ar)
        `,
      )
      .eq('id', case_id)
      .eq('tenant_id', tenant_id)
      .maybeSingle()

    if (caseErr) throw new Error('case fetch failed: ' + caseErr.message)
    if (!caseRow) return jsonError('case not found', 404)

    const uploads = (caseRow as { uploads?: unknown[] }).uploads ?? []
    if (!Array.isArray(uploads) || uploads.length === 0) {
      return jsonError('case has no uploads to break down', 400)
    }
    const upload = uploads[0] as {
      id: string
      filename: string
      storage_path: string
      storage_bucket: string | null
      mime_type: string | null
    }
    if (!upload?.storage_path) {
      return jsonError('upload has no storage_path', 400)
    }

    const existing = {
      voucher_number_text: (caseRow as Record<string, unknown>).voucher_number_text ?? null,
      voucher_date: (caseRow as Record<string, unknown>).voucher_date ?? null,
      amount_sar: (caseRow as Record<string, unknown>).amount_sar ?? null,
      delivery_date: (caseRow as Record<string, unknown>).delivery_date ?? null,
      notes: (caseRow as Record<string, unknown>).notes ?? null,
    }

    const bucket = upload.storage_bucket || 'Document submission'

    // ----- 2. Sign URL + download PDF -----
    const { data: signed, error: signErr } = await svc.storage
      .from(bucket)
      .createSignedUrl(upload.storage_path, 600)
    if (signErr || !signed?.signedUrl) {
      throw new Error('signed URL failed: ' + (signErr?.message || 'no URL'))
    }

    const pdfResp = await fetch(signed.signedUrl, {
      signal: AbortSignal.timeout(30_000),
    })
    if (!pdfResp.ok) {
      throw new Error(`PDF download failed: HTTP ${pdfResp.status}`)
    }
    const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer())

    // ----- 3. Decide chunked vs single-shot based on page count -----
    // Anthropic caps PDF documents at 100 pages per request. We page-count
    // with pdf-lib up front so we can split oversized PDFs locally instead
    // of bouncing off the API. The friendly Arabic 100-page error in the
    // Claude-call helper remains as a safety net in case the count is wrong
    // (e.g. encrypted or malformed PDF).
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

    let totalPageCount: number
    try {
      totalPageCount = await pdfPageCount(pdfBuffer)
    } catch {
      // pdf-lib couldn't open the PDF — fall back to single-shot and let
      // the Claude API surface the real error message to the user.
      totalPageCount = 0
    }

    // Pricing table — keep in sync with https://docs.anthropic.com/en/docs/about-claude/pricing
    const PRICING: Record<string, {
      input: number
      output: number
      cacheRead: number
      cacheWrite: number
    }> = {
      'claude-haiku-4-5-20251001': {
        input: 0.80,
        output: 4.00,
        cacheRead: 0.08,
        cacheWrite: 1.00,
      },
      'claude-sonnet-4-5-20250929': {
        input: 3.00,
        output: 15.00,
        cacheRead: 0.30,
        cacheWrite: 3.75,
      },
    }

    /**
     * Send one PDF (chunk or whole document) to Claude and return the parsed
     * JSON plus cost/usage stats. Used both in the single-shot path and in
     * the per-chunk loop below — body shape, prompt, and parsing are
     * identical regardless of whether we're chunking.
     *
     * Cost controls (unchanged from the original implementation):
     *   1. Default to Haiku 4.5 — ~4x cheaper than Sonnet for both input
     *      and output. For structured extraction from a fixed-format Arabic
     *      voucher Haiku matches Sonnet's accuracy in our spot-tests.
     *   2. Prompt caching on the system prompt — cache_control: ephemeral.
     *      Cached reads are billed at 10% of input rate. The same system
     *      prompt runs for every chunk in a multi-chunk request, so chunks
     *      2..N pay the cached rate for system tokens.
     *   3. max_tokens 2500 — typical response well under 2000.
     */
    async function extractChunk(chunkBytes: Buffer): Promise<{
      sectionsRaw: SectionRaw[]
      metaRaw: CaseMetadataRaw
      model: string
      inputTok: number
      outputTok: number
      cacheReadTok: number
      cacheWriteTok: number
      costUsd: number
    }> {
      const chunkBase64 = chunkBytes.toString('base64')

      const claudeBody = {
        model: process.env.DSB_EXTRACT_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 2500,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: chunkBase64 },
              },
              {
                type: 'text',
                text: 'Return JSON only.',
              },
            ],
          },
        ],
      }

      const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey!,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(claudeBody),
        signal: AbortSignal.timeout(90_000),
      })

      if (!claudeResp.ok) {
        const errBody = await claudeResp.text().catch(() => '')
        // Safety net: if our pre-split count was wrong and Claude still
        // rejects with the 100-page error, surface the friendly Arabic
        // message. In practice this should not fire after the chunking
        // logic above kicks in.
        if (errBody.includes('maximum of 100 PDF pages') || errBody.includes('PDF pages may be provided')) {
          throw new Error(
            'الوثيقة تتجاوز الحد الأقصى المسموح به (١٠٠ صفحة) لمعالجة الذكاء الاصطناعي. يرجى تقسيم الوثيقة إلى ملفات أصغر.',
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
      const firstTextBlock = (claudeJson.content || []).find(
        (b) => b.type === 'text' && typeof b.text === 'string',
      )
      const claudeText = firstTextBlock?.text || ''
      if (!claudeText) throw new Error('Claude returned no text content')

      const usedModel = (claudeJson.model as string | undefined) || claudeBody.model
      const u = claudeJson.usage ?? {}
      const inputTok = u.input_tokens ?? 0
      const outputTok = u.output_tokens ?? 0
      const cacheReadTok = u.cache_read_input_tokens ?? 0
      const cacheWriteTok = u.cache_creation_input_tokens ?? 0
      const rate = PRICING[usedModel] ?? PRICING['claude-haiku-4-5-20251001']!
      const costUsd =
        (inputTok * rate.input +
          outputTok * rate.output +
          cacheReadTok * rate.cacheRead +
          cacheWriteTok * rate.cacheWrite) /
        1_000_000

      const parsed = extractJson(claudeText) as ClaudeJson
      const sectionsRaw: SectionRaw[] = Array.isArray(parsed.sections)
        ? (parsed.sections as SectionRaw[])
        : []
      const metaRaw: CaseMetadataRaw =
        parsed.case_metadata && typeof parsed.case_metadata === 'object'
          ? (parsed.case_metadata as CaseMetadataRaw)
          : {}

      return {
        sectionsRaw,
        metaRaw,
        model: usedModel,
        inputTok,
        outputTok,
        cacheReadTok,
        cacheWriteTok,
        costUsd,
      }
    }

    // ----- 3.5 Run extraction (single-shot or chunked sequentially) -----
    // For ≤100 pages we send the whole PDF in one call (the common case;
    // identical behaviour to the pre-chunking implementation). For larger
    // PDFs we split into ≤100-page chunks with pdf-lib and call Claude
    // sequentially for each — sequential keeps rate-limit risk low and lets
    // prompt caching kick in on chunks 2..N.
    let sectionsRaw: SectionRaw[]
    let metaRaw: CaseMetadataRaw
    let usedModel: string
    let inputTok = 0
    let outputTok = 0
    let cacheReadTok = 0
    let cacheWriteTok = 0
    let costUsd = 0
    let chunkCount = 1

    // Chunk threshold matches the splitter default (50). See lib/dsb/pdf-chunks
    // for the rationale (token-budget headroom, not just page count).
    const CHUNK_THRESHOLD = 50
    if (totalPageCount > 0 && totalPageCount > CHUNK_THRESHOLD) {
      // Chunked path.
      const chunks = await splitPdfIntoChunks(pdfBuffer, CHUNK_THRESHOLD)
      chunkCount = chunks.length
      // Merge accumulators.
      sectionsRaw = []
      // Per-field "first non-null wins" merge for metadata. Chunk 0 almost
      // always carries the metadata (it lives on the cover page), but
      // defensively we let later chunks fill blanks in case chunk 0 is sparse.
      const metaMerged: CaseMetadataRaw = {}
      let firstModel = ''
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!
        const out = await extractChunk(Buffer.from(chunk.bytes))
        if (i === 0) firstModel = out.model

        // Merge sections: concat, but shift Claude's 1-based page indices
        // by the chunk's 0-based offset so they map back to the original PDF.
        for (const s of out.sectionsRaw) {
          if (!s || typeof s !== 'object') continue
          const pf = typeof s.page_from === 'number' ? s.page_from : Number(s.page_from)
          const pt = typeof s.page_to === 'number' ? s.page_to : Number(s.page_to)
          sectionsRaw.push({
            ...s,
            page_from: Number.isFinite(pf) ? pf + chunk.pageOffset : s.page_from,
            page_to: Number.isFinite(pt) ? pt + chunk.pageOffset : s.page_to,
          })
        }

        // Merge metadata: first non-null per field wins. Iterate the chunk's
        // metadata keys and only set those that the merged object hasn't yet.
        for (const [k, v] of Object.entries(out.metaRaw)) {
          const key = k as keyof CaseMetadataRaw
          if (metaMerged[key] !== undefined && metaMerged[key] !== null) continue
          if (v === null || v === undefined) continue
          // Reject empty strings — treat as "not present" so a later chunk can fill in.
          if (typeof v === 'string' && v.trim() === '') continue
          ;(metaMerged as Record<string, unknown>)[key] = v
        }

        // Sum cost + tokens across chunks.
        inputTok += out.inputTok
        outputTok += out.outputTok
        cacheReadTok += out.cacheReadTok
        cacheWriteTok += out.cacheWriteTok
        costUsd += out.costUsd
      }
      metaRaw = metaMerged
      usedModel = firstModel
    } else {
      // Single-shot path (unchanged behaviour for ≤100-page PDFs).
      const out = await extractChunk(pdfBuffer)
      sectionsRaw = out.sectionsRaw
      metaRaw = out.metaRaw
      usedModel = out.model
      inputTok = out.inputTok
      outputTok = out.outputTok
      cacheReadTok = out.cacheReadTok
      cacheWriteTok = out.cacheWriteTok
      costUsd = out.costUsd
    }

    // ----- 5. Build dsb_breakdown_items rows -----
    const rows: Array<{
      tenant_id: string
      case_id: string
      upload_id: string
      kind: BreakdownKind
      page_from: number
      page_to: number
      summary_ar: string
      source: 'ai'
      order_index: number
    }> = []
    let idx = 0
    for (const s of sectionsRaw) {
      if (!s || typeof s !== 'object') continue
      const kindRaw = typeof s.kind === 'string' ? s.kind : 'other'
      const kind: BreakdownKind = (ALLOWED_KINDS as readonly string[]).includes(kindRaw)
        ? (kindRaw as BreakdownKind)
        : 'other'
      const pageFromNum = typeof s.page_from === 'number' ? s.page_from : Number(s.page_from)
      const pageToNum = typeof s.page_to === 'number' ? s.page_to : Number(s.page_to)
      const page_from = Number.isFinite(pageFromNum) ? Math.max(1, Math.floor(pageFromNum)) : null
      const page_to = Number.isFinite(pageToNum) ? Math.max(1, Math.floor(pageToNum)) : null
      if (page_from === null || page_to === null) continue
      const summary_ar = typeof s.summary_ar === 'string' ? s.summary_ar : ''
      idx += 1
      rows.push({
        tenant_id,
        case_id,
        upload_id: upload.id,
        kind,
        page_from,
        page_to,
        summary_ar,
        source: 'ai',
        order_index: idx,
      })
    }

    if (rows.length === 0) {
      throw new Error('no valid sections returned by Claude')
    }

    // ----- 6. Build conditional case-metadata autofill -----
    const metadataUpdate: Record<string, string | number> = {}

    if (
      isBlank(existing.voucher_number_text) &&
      typeof metaRaw.voucher_number_text === 'string' &&
      metaRaw.voucher_number_text.trim()
    ) {
      metadataUpdate.voucher_number_text = metaRaw.voucher_number_text.trim()
    }
    if (isBlank(existing.voucher_date) && isValidIsoDate(metaRaw.voucher_date)) {
      metadataUpdate.voucher_date = metaRaw.voucher_date
    }
    if (
      isBlank(existing.amount_sar) &&
      typeof metaRaw.amount_sar === 'number' &&
      Number.isFinite(metaRaw.amount_sar) &&
      metaRaw.amount_sar > 0
    ) {
      metadataUpdate.amount_sar = metaRaw.amount_sar
    }
    if (isBlank(existing.delivery_date) && isValidIsoDate(metaRaw.delivery_date)) {
      metadataUpdate.delivery_date = metaRaw.delivery_date
    }
    if (isBlank(existing.notes) && typeof metaRaw.notes === 'string' && metaRaw.notes.trim()) {
      metadataUpdate.notes = metaRaw.notes.trim()
    }

    const autofilledKeys = Object.keys(metadataUpdate)

    // ----- 7. Always set extracted_fields to whatever Claude returned -----
    const extractedBlob =
      metaRaw.extracted && typeof metaRaw.extracted === 'object' ? metaRaw.extracted : null

    const updateBody = {
      ...metadataUpdate,
      extracted_fields: extractedBlob,
      // Cost tracking — written on every extraction. extracted_at lets us
      // tell "extracted but cost not yet captured" (legacy rows) apart from
      // "extracted just now."
      extraction_model: usedModel,
      extraction_input_tokens: inputTok,
      extraction_output_tokens: outputTok,
      extraction_cache_read_tokens: cacheReadTok,
      extraction_cache_write_tokens: cacheWriteTok,
      extraction_cost_usd: Number(costUsd.toFixed(6)),
      extracted_at: new Date().toISOString(),
    }

    // ----- 8. Insert breakdown rows -----
    const { error: insertErr } = await svc.from('dsb_breakdown_items').insert(rows)
    if (insertErr) throw new Error('insert breakdown rows failed: ' + insertErr.message)

    // ----- 9. Patch case metadata -----
    const { error: patchErr } = await svc
      .from('dsb_cases')
      .update(updateBody)
      .eq('id', case_id)
      .eq('tenant_id', tenant_id)
    if (patchErr) throw new Error('patch case failed: ' + patchErr.message)

    // ----- 10. Audit log -----
    const auditNotes =
      `AI extracted ${rows.length} sections` +
      (chunkCount > 1 ? ` (split into ${chunkCount} chunks)` : '') +
      (autofilledKeys.length > 0 ? `; autofilled: ${autofilledKeys.join(',')}` : '')
    await svc.from('dsb_audit_log').insert({
      tenant_id,
      case_id,
      event: 'ai_breakdown_complete',
      notes: auditNotes,
      occurred_at: new Date().toISOString(),
    })

    // ----- 11. Auto-trigger the compliance review -----
    // Fire-and-forget — kicks off /api/dsb-ai-review as a separate serverless
    // invocation so it can spend its own ~30s on the Claude call without
    // blocking our response here. The checklist will be pre-populated by the
    // time the user opens the case page (or shortly after, if they open it
    // immediately). The on-demand "مراجعة آلية" button still works for
    // re-runs.
    fireDsbAiReviewWebhook({ case_id, tenant_id }).catch((e) =>
      console.error('[dsb-extract] auto-review trigger failed', e),
    )

    return NextResponse.json({
      ok: true,
      sections: rows.length,
      autofilled: autofilledKeys,
      cost_usd: Number(costUsd.toFixed(6)),
      model: usedModel,
      tokens: {
        input: inputTok,
        output: outputTok,
        cache_read: cacheReadTok,
        cache_write: cacheWriteTok,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[dsb-extract] failed', { case_id, tenant_id, error: message })

    // Best-effort failure audit log; ignore errors writing it.
    try {
      await svc.from('dsb_audit_log').insert({
        tenant_id: auditScope.tenant_id,
        case_id: auditScope.case_id,
        event: 'ai_breakdown_failed',
        notes: 'AI extraction failed: ' + message.slice(0, 500),
        occurred_at: new Date().toISOString(),
      })
    } catch (logErr) {
      console.error('[dsb-extract] audit log insert failed', logErr)
    }

    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
