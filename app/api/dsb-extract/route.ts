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
      "invoices": [{ "number": string|null, "date": "YYYY-MM-DD"|null, "total_sar": number|null, "vat_sar": number|null, "issued_to": string|null }]|null,
      "unit_number": string|null,
      "contract_number": string|null,
      "buyer_name_ar": string|null,
      "buyer_id_number": string|null,
      "paid_from_account_label": string|null,
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
- Multiple invoices: extract EACH invoice as its own object in the "invoices" array. Copy the first invoice's number/date/total/vat/issued_to into the singular fields for compatibility. Never concatenate invoice numbers into a single string.

Unit / contract / buyer identifiers — the app uses these to auto-link a case to a specific unit, sale, and contract PDF in the project database:
- "unit_number" — the physical unit label (e.g. "V-101", "شقة 12", "قطعة 45"). Look for "رقم الوحدة" / "الوحدة" / "رقم الفيلا" / "رقم الشقة".
- "contract_number" — "رقم العقد" / "عقد البيع رقم". Not the invoice number.
- "buyer_name_ar" — the person the unit is sold to. Look for "اسم المشتري" / "المشتري" / "اسم العميل" (only when the voucher relates to a specific unit sale — otherwise null).
- "buyer_id_number" — "رقم الهوية" / "رقم الإقامة" if next to the buyer.
- Return null for any of these if the document doesn't clearly reference a single unit / sale (e.g. project-wide overhead vouchers).

Paid-from account — the escrow report needs to know which project account this voucher was paid from:
- "paid_from_account_label" — the account name/label the voucher pulls funds from. Look for "الحساب المسدد منه" / "من حساب" / "المخصوم من" / a bank/account label at the header (e.g. "حساب الانشاءات", "حساب المشروع", "حساب التسويق"). Return the raw text as it appears; the app matches it to the project's registered accounts.

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
  const {
    case_id,
    tenant_id,
    skip_sections: skipSectionsRaw,
    merge_extracted: mergeExtractedRaw,
  } = (body || {}) as {
    case_id?: unknown
    tenant_id?: unknown
    skip_sections?: unknown
    merge_extracted?: unknown
  }
  if (!isUuid(case_id) || !isUuid(tenant_id)) {
    return jsonError('case_id and tenant_id must be UUIDs')
  }
  // Relink-mode flags. Set both true when the caller (dsb-relink-batch) is
  // re-running extraction on a case that already has breakdown_items and
  // populated metadata — we only want the freshly-parsed identifier fields
  // to flow into extracted_fields + drive the auto-linker, without
  // duplicating sections or clobbering existing voucher metadata.
  const skipSections = skipSectionsRaw === true
  const mergeExtracted = mergeExtractedRaw === true

  const svc = createSupabaseService()

  // We capture these for the catch-block audit log if anything goes wrong.
  const auditScope = { tenant_id, case_id }

  try {
    // ----- 1. Load case + first upload -----
    // Try the extended select (with the migration-057 columns sale_id +
    // contract_id + unit_id). If that fails because migration 057 hasn't
    // been applied yet in this environment, fall back to the base select
    // and skip the auto-linker step. This lets a code deploy land before
    // its migration without breaking extraction on already-uploaded cases.
    let caseRow: Record<string, unknown> | null = null
    let hasLinkColumns = true
    {
      const extended = await svc
        .from('dsb_cases')
        .select(
          `
          id, tenant_id, project_id, developer_id, case_number,
          voucher_number_text, voucher_date, amount_sar, delivery_date, notes, extracted_fields, paid_from_account_id,
          unit_id, sale_id, contract_id,
          uploads:dsb_uploads(id, filename, storage_path, storage_bucket, file_size_bytes, mime_type, page_count),
          project:dsb_projects!dsb_cases_project_id_fkey(id, code, name_ar),
          developer:dsb_developers!dsb_cases_developer_id_fkey(id, company_name_ar)
          `,
        )
        .eq('id', case_id)
        .eq('tenant_id', tenant_id)
        .maybeSingle()
      if (extended.error) {
        // Most likely: `column dsb_cases.sale_id does not exist` because
        // migration 057 hasn't been applied yet. Retry with the base
        // columns; unit_id shipped in migration 056 so it should be safe
        // on its own.
        console.warn(
          '[dsb-extract] extended select failed, falling back:',
          extended.error.message,
        )
        hasLinkColumns = false
        const base = await svc
          .from('dsb_cases')
          .select(
            `
            id, tenant_id, project_id, developer_id, case_number,
            voucher_number_text, voucher_date, amount_sar, delivery_date, notes,
            unit_id,
            uploads:dsb_uploads(id, filename, storage_path, storage_bucket, file_size_bytes, mime_type, page_count),
            project:dsb_projects!dsb_cases_project_id_fkey(id, code, name_ar),
            developer:dsb_developers!dsb_cases_developer_id_fkey(id, company_name_ar)
            `,
          )
          .eq('id', case_id)
          .eq('tenant_id', tenant_id)
          .maybeSingle()
        if (base.error) throw new Error('case fetch failed: ' + base.error.message)
        caseRow = base.data as Record<string, unknown> | null
      } else {
        caseRow = extended.data as Record<string, unknown> | null
      }
    }
    const caseErr = null as { message: string } | null // legacy shape used below

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

    // Guard: catch 0-byte / non-PDF payloads before we blow money shipping
    // them to Claude. Real PDFs start with "%PDF-".
    if (pdfBuffer.length < 100) {
      throw new Error(
        `الملف المرفوع فارغ أو تالف (${pdfBuffer.length} بايت). يُرجى إعادة رفع الوثيقة.`,
      )
    }
    if (!pdfBuffer.slice(0, 5).toString('latin1').startsWith('%PDF-')) {
      throw new Error(
        'الملف المرفوع ليس PDF صالحًا — تحقق من الرفع ثم أعد المحاولة.',
      )
    }

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

    // In relink mode, we don't care about sections at all — we're re-running
    // the AI only to refresh extracted_fields with the new identifier keys
    // (unit_number, contract_number, buyer_name_ar). An empty sections list
    // is fine; only original-mode extraction requires them.
    if (rows.length === 0 && !skipSections) {
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

    // ----- 7. Set / merge extracted_fields -----
    // Original extraction (skipSections=false): fully replace with Claude's
    // latest output.
    // Relink mode (mergeExtracted=true): merge new fields into whatever's
    // already there so we don't lose data the old extraction captured
    // (invoice line items, developer_name_ar, etc.) that the new pass may
    // not re-emit if the model focuses on the identifier fields.
    const newBlob =
      metaRaw.extracted && typeof metaRaw.extracted === 'object'
        ? (metaRaw.extracted as Record<string, unknown>)
        : null
    let extractedBlob: Record<string, unknown> | null = newBlob
    if (mergeExtracted && newBlob) {
      const existingBlob =
        ((caseRow as Record<string, unknown>).extracted_fields as
          | Record<string, unknown>
          | null) ?? {}
      // Merge: new AI values win when non-null, else keep existing.
      const merged: Record<string, unknown> = { ...existingBlob }
      for (const [k, v] of Object.entries(newBlob)) {
        if (v === null || v === undefined) continue
        if (typeof v === 'string' && v.trim() === '') continue
        merged[k] = v
      }
      extractedBlob = merged
    }

    // ----- 7.5 Auto-link unit / sale / contract from extracted fields -----
    // The AI reads the PDF for unit_number, contract_number, buyer_name,
    // buyer_id_number. If any of those match records in the case's project,
    // we populate dsb_cases.unit_id / .sale_id / .contract_id. Never
    // overwrite existing links — human-set linkage always wins.
    //
    // If migration 057 isn't applied yet (sale_id/contract_id columns
    // absent) we only compute unit_id and skip sale/contract linking.
    const linkPatch = await autoLinkCaseFromExtracted({
      svc,
      tenantId: tenant_id,
      caseProjectId: (caseRow as { project_id?: string }).project_id ?? null,
      existingUnitId: ((caseRow as Record<string, unknown>).unit_id as string | null) ?? null,
      existingSaleId: hasLinkColumns
        ? ((caseRow as Record<string, unknown>).sale_id as string | null) ?? null
        : null,
      existingContractId: hasLinkColumns
        ? ((caseRow as Record<string, unknown>).contract_id as string | null) ?? null
        : null,
      existingPaidFromAccountId:
        ((caseRow as Record<string, unknown>).paid_from_account_id as string | null) ?? null,
      extracted: extractedBlob as Record<string, unknown> | null,
      writeSaleAndContract: hasLinkColumns,
    })

    const updateBody = {
      ...metadataUpdate,
      ...linkPatch.patch,
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

    // ----- 8. Insert breakdown rows (skipped in relink mode) -----
    if (!skipSections && rows.length > 0) {
      const { error: insertErr } = await svc.from('dsb_breakdown_items').insert(rows)
      if (insertErr) throw new Error('insert breakdown rows failed: ' + insertErr.message)
    }

    // ----- 9. Patch case metadata -----
    const { error: patchErr } = await svc
      .from('dsb_cases')
      .update(updateBody)
      .eq('id', case_id)
      .eq('tenant_id', tenant_id)
    if (patchErr) throw new Error('patch case failed: ' + patchErr.message)

    // ----- 10. Audit log -----
    const linkedKeys = Object.keys(linkPatch.patch)
    const auditNotes =
      `AI extracted ${rows.length} sections` +
      (chunkCount > 1 ? ` (split into ${chunkCount} chunks)` : '') +
      (autofilledKeys.length > 0 ? `; autofilled: ${autofilledKeys.join(',')}` : '') +
      (linkedKeys.length > 0 ? `; linked: ${linkedKeys.join(',')}` : '') +
      (linkPatch.notes.length > 0 ? ` [${linkPatch.notes.join(' | ')}]` : '')
    await svc.from('dsb_audit_log').insert({
      tenant_id,
      case_id,
      event: 'ai_breakdown_complete',
      notes: auditNotes,
      occurred_at: new Date().toISOString(),
    })

    // ----- 11. Auto-trigger the compliance review (skipped in relink mode) -----
    // Fire-and-forget — kicks off /api/dsb-ai-review as a separate serverless
    // invocation so it can spend its own ~30s on the Claude call without
    // blocking our response here. The checklist will be pre-populated by the
    // time the user opens the case page (or shortly after, if they open it
    // immediately). The on-demand "مراجعة آلية" button still works for
    // re-runs. Suppressed in relink mode so a backfill doesn't
    // regenerate the checklist for every case being re-processed.
    if (!skipSections) {
      fireDsbAiReviewWebhook({ case_id, tenant_id }).catch((e) =>
        console.error('[dsb-extract] auto-review trigger failed', e),
      )
    }

    return NextResponse.json({
      ok: true,
      sections: rows.length,
      autofilled: autofilledKeys,
      linked: linkPatch.patch,          // { unit_id?, sale_id?, contract_id? }
      link_notes: linkPatch.notes,      // human-readable trail: what matched / what didn't
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

// ---------------------------------------------------------------------------
// autoLinkCaseFromExtracted
// ---------------------------------------------------------------------------
// After Claude returns the extracted_fields blob, try to link the case to
// (a) a unit in the project, (b) the active sale for that unit — which
// carries the buyer info inline — and (c) a contract PDF associated with
// that unit.
//
// Never overwrites existing links (owner may have set them manually).
// Silent on failure — a missing match just means no link is written and
// the case still saves cleanly.
//
// Matching rules:
//   unit_id     — normalize unit_number → exact match on
//                 dsb_project_units(project_id, unit_number).
//   sale_id     — prefer the sale whose contract_number matches the
//                 extracted contract_number; else the most recent
//                 sale_status='active' sale for the unit.
//   contract_id — if a dsb_unit_contracts row exists for the matched
//                 sale_id, use that; else fall back to the newest
//                 contract linked to the unit.
// ---------------------------------------------------------------------------
type LinkPatch = {
  patch: {
    unit_id?: string
    sale_id?: string
    contract_id?: string
    // paid_from_account_id is written even when the unit didn't match —
    // the escrow OUT computation only needs the account link, so we
    // populate it independently of the unit/sale chain.
    paid_from_account_id?: string
  }
  notes: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function autoLinkCaseFromExtracted(args: {
  svc: any
  tenantId: string
  caseProjectId: string | null
  existingUnitId: string | null
  existingSaleId: string | null
  existingContractId: string | null
  // Existing paid_from — don't overwrite if operator already picked one.
  existingPaidFromAccountId: string | null
  extracted: Record<string, unknown> | null
  // When migration 057 hasn't been applied yet the sale_id + contract_id
  // columns don't exist on dsb_cases. In that mode we still compute the
  // unit_id (available since migration 056) but skip writing the other two.
  writeSaleAndContract?: boolean
}): Promise<LinkPatch> {
  const patch: LinkPatch['patch'] = {}
  const notes: string[] = []
  const {
    svc,
    tenantId,
    caseProjectId,
    existingUnitId,
    existingSaleId,
    existingContractId,
    existingPaidFromAccountId,
    extracted,
    writeSaleAndContract = true,
  } = args

  if (!extracted || !caseProjectId) return { patch, notes }

  // ------------------------- paid_from_account_id -------------------------
  // Runs regardless of whether the unit matched — the escrow report needs
  // this link for OUT accounting even when the voucher isn't tied to a
  // specific unit (project-wide construction/admin/marketing spend).
  if (!existingPaidFromAccountId) {
    const acctLabelRaw =
      (typeof extracted.paid_from_account_label === 'string' && extracted.paid_from_account_label.trim())
        ? extracted.paid_from_account_label.trim()
        : null
    if (acctLabelRaw) {
      const { data: acctRows } = await svc
        .from('dsb_project_accounts')
        .select('id, label')
        .eq('tenant_id', tenantId)
        .eq('project_id', caseProjectId)
      const accounts = (acctRows ?? []) as Array<{ id: string; label: string | null }>
      const normalize = (s: string): string =>
        s.replace(/[\sـ]+/g, '').toLowerCase()
      const needle = normalize(acctLabelRaw)
      const hit = accounts.find(
        (a) => a.label && normalize(a.label) === needle,
      )
      if (hit) {
        patch.paid_from_account_id = hit.id
        notes.push(`account "${acctLabelRaw}" → matched`)
      } else {
        notes.push(`account "${acctLabelRaw}": no matching project account`)
      }
    }
  }

  // Extract candidate identifiers from the AI JSON blob. Each is defensively
  // coerced — the AI is instructed to output nulls but sometimes returns
  // empty strings or numbers.
  const asTrimmedString = (v: unknown): string | null => {
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
    return null
  }
  const unitNumberRaw = asTrimmedString(extracted.unit_number)
    ?? asTrimmedString((extracted as Record<string, unknown>).unit_no)
  const contractNumberRaw = asTrimmedString(extracted.contract_number)
    ?? asTrimmedString(extracted.invoice_number) // some vouchers reuse invoice_number = contract ref

  // ------------------------- unit_id -------------------------
  let matchedUnitId: string | null = existingUnitId
  if (!existingUnitId && unitNumberRaw) {
    // Case-insensitive exact match; also strip common Arabic tatweel /
    // whitespace variations. Real files might store "V-101", "v101", "١٠١" —
    // we try the raw form first, then a normalized form.
    const cleaned = unitNumberRaw.replace(/[\sـ]+/g, '').trim()
    const { data: unitRows } = await svc
      .from('dsb_project_units')
      .select('id, unit_number')
      .eq('tenant_id', tenantId)
      .eq('project_id', caseProjectId)
    const candidates = (unitRows ?? []) as Array<{ id: string; unit_number: string | null }>
    const exact = candidates.find(
      (u) => (u.unit_number ?? '').trim().toLowerCase() === unitNumberRaw.toLowerCase(),
    )
    const looseMatch =
      exact ??
      candidates.find(
        (u) =>
          (u.unit_number ?? '').replace(/[\sـ]+/g, '').toLowerCase() ===
          cleaned.toLowerCase(),
      )
    if (looseMatch) {
      patch.unit_id = looseMatch.id
      matchedUnitId = looseMatch.id
      notes.push(`unit ${unitNumberRaw} → ${looseMatch.unit_number ?? '?'}`)
    } else {
      notes.push(`unit ${unitNumberRaw}: no match in project`)
    }
  }

  // ------------------------- sale_id -------------------------
  // Only try if we now have a unit_id (either pre-set or freshly matched)
  // AND the case doesn't already have a sale_id.
  let matchedSaleId: string | null = existingSaleId
  if (!existingSaleId && matchedUnitId) {
    const { data: saleRows } = await svc
      .from('dsb_unit_sales')
      .select('id, contract_number, sale_status, created_at')
      .eq('tenant_id', tenantId)
      .eq('unit_id', matchedUnitId)
      .order('created_at', { ascending: false })
    const sales = (saleRows ?? []) as Array<{
      id: string
      contract_number: string | null
      sale_status: string | null
      created_at: string | null
    }>
    let picked: (typeof sales)[number] | null = null
    if (contractNumberRaw) {
      picked =
        sales.find(
          (s) =>
            (s.contract_number ?? '').trim().toLowerCase() ===
            contractNumberRaw.toLowerCase(),
        ) ?? null
    }
    if (!picked) {
      picked = sales.find((s) => s.sale_status === 'active') ?? sales[0] ?? null
    }
    if (picked) {
      if (writeSaleAndContract) patch.sale_id = picked.id
      matchedSaleId = picked.id
      notes.push(
        (contractNumberRaw && picked.contract_number === contractNumberRaw
          ? `sale by contract ${contractNumberRaw}`
          : `sale (active/newest) for unit`) +
          (writeSaleAndContract ? '' : ' [mig 057 pending, not written]'),
      )
    }
  }

  // ------------------------- contract_id -------------------------
  if (!existingContractId && matchedUnitId && writeSaleAndContract) {
    // Try sale-scoped first, then unit-scoped.
    let contractHit: { id: string } | null = null
    if (matchedSaleId) {
      const { data: contractsBySale } = await svc
        .from('dsb_unit_contracts')
        .select('id, uploaded_at')
        .eq('tenant_id', tenantId)
        .eq('sale_id', matchedSaleId)
        .order('uploaded_at', { ascending: false })
        .limit(1)
      contractHit = ((contractsBySale ?? []) as Array<{ id: string }>)[0] ?? null
    }
    if (!contractHit) {
      const { data: contractsByUnit } = await svc
        .from('dsb_unit_contracts')
        .select('id, uploaded_at')
        .eq('tenant_id', tenantId)
        .eq('unit_id', matchedUnitId)
        .order('uploaded_at', { ascending: false })
        .limit(1)
      contractHit = ((contractsByUnit ?? []) as Array<{ id: string }>)[0] ?? null
    }
    if (contractHit) {
      patch.contract_id = contractHit.id
      notes.push('contract PDF linked')
    }
  }

  return { patch, notes }
}
