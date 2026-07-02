/**
 * POST /api/dsb-contract-extract
 * ----------------------------------------------------------------------------
 * Extract identifying fields from a Saudi real-estate sale contract PDF using
 * Claude Vision, then link the contract row (dsb_unit_contracts) to the right
 * sale (dsb_unit_sales) + unit (dsb_project_units).
 *
 * Input  (JSON body): { contract_id: string, project_id?: string }
 * Auth   (header):    x-dsb-secret: <DSB_EXTRACT_SECRET>  (skipped if env unset)
 * Output (JSON):
 *   success → { ok: true, extraction_status, cost_usd, model, matched: {...} }
 *   error   → { ok: false, error: string }              (HTTP 4xx/5xx)
 *
 * Matching order:
 *   1. If Claude returned a contract_number → look up dsb_unit_sales.contract_number
 *      (tenant-scoped). If found: set sale_id + unit_id + status='matched'.
 *   2. Else if project_id is provided AND unit_number returned → look up
 *      dsb_project_units within that project. If found, pick the most-recent
 *      active sale.
 *   3. Otherwise → status='no_match' (owner attaches manually via
 *      attachContractToSale).
 *
 * Cost + tokens + model are always written back on the contract row, matching
 * the behaviour of /api/dsb-extract for dsb_cases.
 */

import { NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { pdfPageCount, splitPdfIntoChunks } from '@/lib/dsb/pdf-chunks'

export const runtime = 'nodejs'
export const maxDuration = 120

// ---------------------------------------------------------------------------
// System prompt — the contract PDFs are scanned (image-only) so Claude Vision
// must do OCR + field extraction in one pass. Fields lifted straight from the
// spec: contract_number, unit_number, buyer identifiers, sale metadata.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Extract Saudi real-estate sale contract fields from a scanned PDF. Output ONE JSON object only — no prose, no fences. Shape:
{
  "contract_number": string|null,
  "unit_number": string|null,
  "buyer_name_ar": string|null,
  "buyer_id_type": "national"|"residency"|"passport"|null,
  "buyer_id_number": string|null,
  "buyer_nationality": string|null,
  "buyer_phone": string|null,
  "sale_date": "YYYY-MM-DD"|null,
  "price_before_tax_sar": number|null,
  "financing_type": string|null,
  "financing_bank": string|null,
  "confidence": number
}

Rules:
- Missing field → null. Never guess.
- Preserve Arabic literally.
- Money: numeric only (720000, not "720,000 SAR").
- Dates: ISO YYYY-MM-DD. Convert Hijri or Arabic-numeral dates.
- contract_number is a short alphanumeric ref (e.g. "HV367", "AL-1234"). Case-preserve.
- buyer_id_type: هوية وطنية / سعودي → national; إقامة → residency; جواز → passport.
- confidence ∈ [0,1] — your certainty across all extracted fields.`

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

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

// Pricing table — keep in sync with the /api/dsb-extract sibling.
const PRICING: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-haiku-4-5-20251001': {
    input: 0.8,
    output: 4.0,
    cacheRead: 0.08,
    cacheWrite: 1.0,
  },
  'claude-sonnet-4-5-20250929': {
    input: 3.0,
    output: 15.0,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
}

// ---------------------------------------------------------------------------
// Diagnostic GET
// ---------------------------------------------------------------------------

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: '/api/dsb-contract-extract',
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
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  // Auth check — same shared-secret pattern as /api/dsb-extract.
  const expectedSecret = process.env.DSB_EXTRACT_SECRET
  if (expectedSecret) {
    const provided = req.headers.get('x-dsb-secret')
    if (provided !== expectedSecret) {
      return jsonError('unauthorized', 401)
    }
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError('invalid JSON body')
  }
  const { contract_id, project_id } = (body || {}) as {
    contract_id?: unknown
    project_id?: unknown
  }
  if (!isUuid(contract_id)) return jsonError('contract_id must be a UUID')
  if (project_id !== undefined && !isUuid(project_id)) {
    return jsonError('project_id must be a UUID or omitted')
  }

  const svc = createSupabaseService()

  try {
    // ---- 1. Load contract row ----
    const { data: contractRow, error: contractErr } = await svc
      .from('dsb_unit_contracts')
      .select(
        'id, tenant_id, storage_path, storage_bucket, filename, extraction_status',
      )
      .eq('id', contract_id)
      .maybeSingle()
    if (contractErr) throw new Error('contract fetch failed: ' + contractErr.message)
    if (!contractRow) return jsonError('contract not found', 404)

    const contract = contractRow as {
      id: string
      tenant_id: string
      storage_path: string
      storage_bucket: string | null
      filename: string | null
      extraction_status: string
    }
    const tenantId = contract.tenant_id
    const bucket = contract.storage_bucket || 'Document submission'

    // ---- 2. Sign URL + download PDF ----
    const { data: signed, error: signErr } = await svc.storage
      .from(bucket)
      .createSignedUrl(contract.storage_path, 600)
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

    // ---- 3. Chunking decision ----
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

    let totalPageCount: number
    try {
      totalPageCount = await pdfPageCount(pdfBuffer)
    } catch {
      totalPageCount = 0
    }

    interface Extracted {
      contract_number: string | null
      unit_number: string | null
      buyer_name_ar: string | null
      buyer_id_type: 'national' | 'residency' | 'passport' | null
      buyer_id_number: string | null
      buyer_nationality: string | null
      buyer_phone: string | null
      sale_date: string | null
      price_before_tax_sar: number | null
      financing_type: string | null
      financing_bank: string | null
      confidence: number | null
    }

    async function extractChunk(chunkBytes: Buffer): Promise<{
      raw: Extracted
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
        max_tokens: 1500,
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
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: chunkBase64,
                },
              },
              { type: 'text', text: 'Return JSON only.' },
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
        if (
          errBody.includes('maximum of 100 PDF pages') ||
          errBody.includes('PDF pages may be provided')
        ) {
          throw new Error(
            'الوثيقة تتجاوز الحد الأقصى المسموح به (١٠٠ صفحة) لمعالجة الذكاء الاصطناعي. يرجى تقسيم الوثيقة إلى ملفات أصغر.',
          )
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
      const firstText = (claudeJson.content || []).find(
        (b) => b.type === 'text' && typeof b.text === 'string',
      )
      const claudeText = firstText?.text || ''
      if (!claudeText) throw new Error('Claude returned no text content')

      const parsed = extractJson(claudeText) as Partial<Extracted>
      const raw: Extracted = {
        contract_number: typeof parsed.contract_number === 'string' ? parsed.contract_number.trim() : null,
        unit_number: typeof parsed.unit_number === 'string' ? parsed.unit_number.trim() : null,
        buyer_name_ar: typeof parsed.buyer_name_ar === 'string' ? parsed.buyer_name_ar.trim() : null,
        buyer_id_type:
          parsed.buyer_id_type === 'national' ||
          parsed.buyer_id_type === 'residency' ||
          parsed.buyer_id_type === 'passport'
            ? parsed.buyer_id_type
            : null,
        buyer_id_number: typeof parsed.buyer_id_number === 'string' ? parsed.buyer_id_number.trim() : null,
        buyer_nationality: typeof parsed.buyer_nationality === 'string' ? parsed.buyer_nationality.trim() : null,
        buyer_phone: typeof parsed.buyer_phone === 'string' ? parsed.buyer_phone.trim() : null,
        sale_date:
          typeof parsed.sale_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.sale_date)
            ? parsed.sale_date
            : null,
        price_before_tax_sar:
          typeof parsed.price_before_tax_sar === 'number' && Number.isFinite(parsed.price_before_tax_sar)
            ? parsed.price_before_tax_sar
            : null,
        financing_type: typeof parsed.financing_type === 'string' ? parsed.financing_type.trim() : null,
        financing_bank: typeof parsed.financing_bank === 'string' ? parsed.financing_bank.trim() : null,
        confidence:
          typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
            ? Math.max(0, Math.min(1, parsed.confidence))
            : null,
      }

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

      return {
        raw,
        model: usedModel,
        inputTok,
        outputTok,
        cacheReadTok,
        cacheWriteTok,
        costUsd,
      }
    }

    // ---- 4. Run extraction (single-shot or chunked) ----
    let extracted: Extracted
    let usedModel: string
    let inputTok = 0
    let outputTok = 0
    let cacheReadTok = 0
    let cacheWriteTok = 0
    let costUsd = 0
    const CHUNK_THRESHOLD = 50
    if (totalPageCount > 0 && totalPageCount > CHUNK_THRESHOLD) {
      const chunks = await splitPdfIntoChunks(pdfBuffer, CHUNK_THRESHOLD)
      let merged: Extracted | null = null
      let firstModel = ''
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!
        const out = await extractChunk(Buffer.from(chunk.bytes))
        if (i === 0) firstModel = out.model
        // First-non-null-wins merge — the identifying fields usually all live
        // on the cover page, but a resell contract sometimes trails signatures
        // across later pages.
        if (!merged) {
          merged = out.raw
        } else {
          for (const k of Object.keys(out.raw) as (keyof Extracted)[]) {
            if (merged[k] === null && out.raw[k] !== null) {
              ;(merged as unknown as Record<string, unknown>)[k] = out.raw[k] as unknown
            }
          }
        }
        inputTok += out.inputTok
        outputTok += out.outputTok
        cacheReadTok += out.cacheReadTok
        cacheWriteTok += out.cacheWriteTok
        costUsd += out.costUsd
      }
      extracted = merged ?? emptyExtracted()
      usedModel = firstModel
    } else {
      const out = await extractChunk(pdfBuffer)
      extracted = out.raw
      usedModel = out.model
      inputTok = out.inputTok
      outputTok = out.outputTok
      cacheReadTok = out.cacheReadTok
      cacheWriteTok = out.cacheWriteTok
      costUsd = out.costUsd
    }

    // ---- 5. Matching logic ----
    let matchedSaleId: string | null = null
    let matchedUnitId: string | null = null
    let extractionStatus: 'matched' | 'no_match' | 'failed' = 'no_match'
    let matchNote = ''

    if (extracted.contract_number) {
      const { data: saleByContract } = await svc
        .from('dsb_unit_sales')
        .select('id, unit_id')
        .eq('tenant_id', tenantId)
        .eq('contract_number', extracted.contract_number)
        .order('created_at', { ascending: false })
        .limit(1)
      const sale = (saleByContract ?? [])[0] as { id: string; unit_id: string } | undefined
      if (sale) {
        matchedSaleId = sale.id
        matchedUnitId = sale.unit_id
        extractionStatus = 'matched'
        matchNote = 'contract_number'
      }
    }

    if (extractionStatus !== 'matched' && extracted.unit_number && typeof project_id === 'string') {
      const { data: unitRows } = await svc
        .from('dsb_project_units')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('project_id', project_id)
        .eq('unit_number', extracted.unit_number)
        .limit(1)
      const unit = (unitRows ?? [])[0] as { id: string } | undefined
      if (unit) {
        matchedUnitId = unit.id
        // Pick the most recent ACTIVE sale for that unit; fall back to most
        // recent of any status if no active row.
        const { data: activeSales } = await svc
          .from('dsb_unit_sales')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('unit_id', unit.id)
          .eq('sale_status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
        let saleId = ((activeSales ?? [])[0] as { id: string } | undefined)?.id ?? null
        if (!saleId) {
          const { data: anySales } = await svc
            .from('dsb_unit_sales')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('unit_id', unit.id)
            .order('created_at', { ascending: false })
            .limit(1)
          saleId = ((anySales ?? [])[0] as { id: string } | undefined)?.id ?? null
        }
        if (saleId) {
          matchedSaleId = saleId
          extractionStatus = 'matched'
          matchNote = 'unit_number'
        }
      }
    }

    // ---- 6. Persist extraction + linkage ----
    const updateBody: Record<string, unknown> = {
      extracted_fields: extracted,
      extracted_at: new Date().toISOString(),
      extraction_status: extractionStatus,
      extraction_model: usedModel,
      extraction_cost_usd: Number(costUsd.toFixed(6)),
      matched_confidence: extracted.confidence ?? null,
    }
    if (matchedSaleId) updateBody.sale_id = matchedSaleId
    if (matchedUnitId) updateBody.unit_id = matchedUnitId

    const { error: updateErr } = await svc
      .from('dsb_unit_contracts')
      .update(updateBody)
      .eq('id', contract.id)
      .eq('tenant_id', tenantId)
    if (updateErr) throw new Error('contract update failed: ' + updateErr.message)

    return NextResponse.json({
      ok: true,
      extraction_status: extractionStatus,
      cost_usd: Number(costUsd.toFixed(6)),
      model: usedModel,
      tokens: {
        input: inputTok,
        output: outputTok,
        cache_read: cacheReadTok,
        cache_write: cacheWriteTok,
      },
      matched: matchedSaleId
        ? { sale_id: matchedSaleId, unit_id: matchedUnitId, by: matchNote }
        : null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[dsb-contract-extract] failed', { contract_id, error: message })

    // Best-effort mark the contract as failed so the UI can surface it.
    try {
      await svc
        .from('dsb_unit_contracts')
        .update({
          extraction_status: 'failed',
          extracted_at: new Date().toISOString(),
          extracted_fields: { error: message.slice(0, 500) },
        })
        .eq('id', contract_id as string)
    } catch (updateErr) {
      console.error('[dsb-contract-extract] failure-mark update failed', updateErr)
    }

    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

function emptyExtracted() {
  return {
    contract_number: null,
    unit_number: null,
    buyer_name_ar: null,
    buyer_id_type: null,
    buyer_id_number: null,
    buyer_nationality: null,
    buyer_phone: null,
    sale_date: null,
    price_before_tax_sar: null,
    financing_type: null,
    financing_bank: null,
    confidence: null,
  } as const
}
