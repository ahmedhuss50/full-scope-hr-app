/**
 * POST /api/dsb-units-map-columns
 * ----------------------------------------------------------------------------
 * Given the first ~5-10 rows of a raw Excel sheet (values only, 2-D array),
 * ask Claude Haiku 4.5 which 0-based column index each master-list field
 * lives at and which row is the header row. Used by the units master-list
 * importer to avoid hardcoding column positions per sheet layout — different
 * developers/months ship different column orders.
 *
 * Input  (JSON body):
 *   {
 *     sample_rows: unknown[][],   // first ~5-10 rows of the sheet, values only
 *     sheet_name: string          // helps Claude infer sheet purpose
 *   }
 *
 * Auth: cookie session, must be tenant owner (dsb_role = 'owner'). No shared
 *       secret path — this is only ever user-triggered from the browser.
 *
 * Output (JSON):
 *   success → {
 *     ok: true,
 *     mapping: {
 *       header_row_index: number,
 *       columns: { [field]: number | null, ... },
 *       notes_ar: string
 *     },
 *     cost_usd: number,
 *     model: string,
 *     tokens: { input, output, cache_read, cache_write }
 *   }
 *   error   → { ok: false, error: string }
 *
 * Runtime: Node.js, maxDuration=30. Uses the same hand-rolled HTTP call
 * pattern as /api/dsb-extract (avoids the older SDK's missing document
 * content-block type).
 */

import { NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 30

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const FIELD_KEYS = [
  'unit_number',
  'block_number',
  'zone_number',
  'unit_type',
  'area_m2',
  'district',
  'city',
  'region',
  'project_name',
  'buyer_name',
  'buyer_id_type',
  'buyer_id_number',
  'buyer_nationality',
  'buyer_phone',
  'contract_number',
  'contract_type',
  'financing_type',
  'financing_bank',
  'sale_date',
  'price_before_tax_sar',
  'vat_sar',
  'price_with_vat_sar',
  'delivery_status',
  'delivery_date',
  'sale_count',
] as const

type FieldKey = (typeof FIELD_KEYS)[number]

// Cached via Anthropic prompt caching. The system prompt is stable; only the
// per-sheet user message changes, so the ~1 KB of instructions is billed at
// cache-read pricing (10% of input) after the first call in each session.
const SYSTEM_PROMPT = `You receive the first rows of an Arabic real-estate master-list Excel sheet. Determine which 0-based column index each field lives at, and which row index (0-based) is the header row.

Field targets — return null if the column isn't present in the sheet:
- unit_number, block_number, zone_number, unit_type, area_m2, district, city, region, project_name
- buyer_name, buyer_id_type, buyer_id_number, buyer_nationality, buyer_phone
- contract_number, contract_type, financing_type, financing_bank
- sale_date, price_before_tax_sar, vat_sar, price_with_vat_sar
- delivery_status, delivery_date, sale_count

Match by Arabic header semantics (not exact string). Examples:
  "رقم الوحدة" / "الوحدة" / "unit no" → unit_number
  "اسم العميل" / "اسم المشتري" / "المشتري" → buyer_name
  "نوع الـ ID" / "نوع الهوية" → buyer_id_type
  "رقم الهوية" / "رقم الإقامة" → buyer_id_number
  "الجنسية" → buyer_nationality
  "رقم الجوال" / "الجوال" / "الهاتف" → buyer_phone
  "اسم المشروع" / "المشروع" → project_name
  "المنطقة" (region-level) → region  ·  "رقم المنطقة" / "ZONE" → zone_number
  "المدينة" → city  ·  "الحي" → district
  "المساحة" / "area" → area_m2
  "نوع الوحدة" → unit_type
  "رقم البلوك" / "البلوك" → block_number
  "عدد مرات بيع الوحدة" / "عدد البيع" → sale_count
  "رقم العقد" → contract_number  ·  "نوع العقد" → contract_type
  "نوع التمويل" → financing_type  ·  "اسم الجهة التمويلية" / "الجهة الممولة" → financing_bank
  "تاريخ بيع الوحدة" / "تاريخ البيع" → sale_date
  "سعر الوحدة قبل ضريبة" / "السعر قبل" → price_before_tax_sar
  "VAT" / "ضريبة القيمة المضافة" → vat_sar
  "سعر شامل ضريبة" / "السعر شامل" → price_with_vat_sar
  "حالة التسليم" → delivery_status  ·  "تاريخ التسليم" → delivery_date

Rules:
- Column indices are 0-based (column A = 0). Header row index is 0-based (first row = 0).
- If a field is not present in the sheet, its column value must be null. Never guess.
- The "م" / serial-number column is NOT a mapped field — ignore it.
- If two columns could both match a field, pick the more specific one (e.g. "رقم المنطقة" → zone_number, not region).
- If the header spans two rows (merged label + subtitle), pick the row with the most non-empty cells.

Return ONE JSON object only — no prose, no fences:
{
  "header_row_index": int,
  "columns": {
    "unit_number": int|null, "block_number": int|null, "zone_number": int|null,
    "unit_type": int|null, "area_m2": int|null, "district": int|null,
    "city": int|null, "region": int|null, "project_name": int|null,
    "buyer_name": int|null, "buyer_id_type": int|null, "buyer_id_number": int|null,
    "buyer_nationality": int|null, "buyer_phone": int|null,
    "contract_number": int|null, "contract_type": int|null,
    "financing_type": int|null, "financing_bank": int|null,
    "sale_date": int|null, "price_before_tax_sar": int|null,
    "vat_sar": int|null, "price_with_vat_sar": int|null,
    "delivery_status": int|null, "delivery_date": int|null, "sale_count": int|null
  },
  "notes_ar": string
}`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status })
}

/**
 * Robust JSON extractor — same rules as /api/dsb-extract: handles raw JSON,
 * ```json ... ``` fences, and prose preambles by falling back to the
 * substring between the first '{' and last '}'.
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

/**
 * Trim/clip a value to a small integer index in [0, 200] or return null.
 * Anything else (negative, non-finite, string that isn't a clean integer)
 * → null. Guards against Claude occasionally returning e.g. "3" or 3.5.
 */
function toIndexOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  const floored = Math.trunc(n)
  if (floored < 0 || floored > 200) return null
  return floored
}

// ---------------------------------------------------------------------------
// Auth — cookie session, must be tenant owner.
// ---------------------------------------------------------------------------

async function requireOwner(): Promise<
  | { ok: true; tenantId: string }
  | { ok: false; status: number; error: string }
> {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, status: 401, error: 'لم يتم تسجيل الدخول.' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id, dsb_role')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) return { ok: false, status: 401, error: 'الحساب غير مرتبط بمستأجر.' }
  if ((profile.dsb_role as string | null) !== 'owner') {
    return { ok: false, status: 403, error: 'هذه العملية متاحة للمدير فقط.' }
  }
  return { ok: true, tenantId: profile.tenant_id as string }
}

// ---------------------------------------------------------------------------
// GET — lightweight diagnostic (mirrors /api/dsb-extract).
// ---------------------------------------------------------------------------

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: '/api/dsb-units-map-columns',
    runtime,
    env: {
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      SUPABASE_URL_set: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY_set: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    now: new Date().toISOString(),
  })
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  // ----- Auth -----
  const auth = await requireOwner()
  if (!auth.ok) return jsonError(auth.error, auth.status)

  // ----- Parse body -----
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError('invalid JSON body')
  }
  const { sample_rows, sheet_name } = (body || {}) as {
    sample_rows?: unknown
    sheet_name?: unknown
  }
  if (!Array.isArray(sample_rows) || sample_rows.length === 0) {
    return jsonError('sample_rows must be a non-empty array of arrays')
  }
  if (typeof sheet_name !== 'string' || !sheet_name.trim()) {
    return jsonError('sheet_name is required')
  }

  // Cap the sample we ship to Claude — we only need enough rows to spot the
  // header. Beyond ~15 rows the token cost grows without help.
  const capped = sample_rows.slice(0, 15).map((row) =>
    Array.isArray(row) ? row.slice(0, 60) : [],
  )

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return jsonError('ANTHROPIC_API_KEY is not set', 500)

  // Same Haiku 4.5 pricing table as /api/dsb-extract (dollars per 1M tokens).
  const PRICING = {
    input: 0.8,
    output: 4.0,
    cacheRead: 0.08,
    cacheWrite: 1.0,
  } as const

  const model = process.env.DSB_MAP_COLUMNS_MODEL || 'claude-haiku-4-5-20251001'

  // The user message is JSON-shaped so Claude sees the sample as tabular
  // rows rather than a wall of loose numbers. Kept small on purpose.
  const userText =
    `Sheet name: ${sheet_name.trim()}\n` +
    `Sample rows (2-D array, up to first 15 rows):\n` +
    JSON.stringify(capped)

  const claudeBody = {
    model,
    max_tokens: 800,
    temperature: 0,
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
        content: [{ type: 'text', text: userText }],
      },
    ],
  }

  let claudeResp: Response
  try {
    claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(claudeBody),
      signal: AbortSignal.timeout(25_000),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return jsonError('Claude request failed: ' + msg, 502)
  }

  if (!claudeResp.ok) {
    const errBody = await claudeResp.text().catch(() => '')
    return jsonError(`Claude API ${claudeResp.status}: ${errBody.slice(0, 300)}`, 502)
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
  if (!claudeText) return jsonError('Claude returned no text content', 502)

  let parsed: unknown
  try {
    parsed = extractJson(claudeText)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return jsonError('Failed to parse Claude JSON: ' + msg, 502)
  }

  if (!parsed || typeof parsed !== 'object') {
    return jsonError('Claude JSON was not an object', 502)
  }
  const p = parsed as {
    header_row_index?: unknown
    columns?: unknown
    notes_ar?: unknown
  }

  const headerRow = toIndexOrNull(p.header_row_index)
  if (headerRow === null) {
    return jsonError('Claude did not return a valid header_row_index', 502)
  }

  const columnsIn = (p.columns && typeof p.columns === 'object' ? p.columns : {}) as Record<
    string,
    unknown
  >
  const columnsOut: Record<FieldKey, number | null> = {} as Record<FieldKey, number | null>
  for (const k of FIELD_KEYS) {
    columnsOut[k] = toIndexOrNull(columnsIn[k])
  }

  const notesAr = typeof p.notes_ar === 'string' ? p.notes_ar.trim().slice(0, 400) : ''

  // ----- Cost + usage stats -----
  const u = claudeJson.usage ?? {}
  const inputTok = u.input_tokens ?? 0
  const outputTok = u.output_tokens ?? 0
  const cacheReadTok = u.cache_read_input_tokens ?? 0
  const cacheWriteTok = u.cache_creation_input_tokens ?? 0
  const usedModel = claudeJson.model || model
  const costUsd =
    (inputTok * PRICING.input +
      outputTok * PRICING.output +
      cacheReadTok * PRICING.cacheRead +
      cacheWriteTok * PRICING.cacheWrite) /
    1_000_000

  return NextResponse.json({
    ok: true,
    mapping: {
      header_row_index: headerRow,
      columns: columnsOut,
      notes_ar: notesAr,
    },
    cost_usd: Number(costUsd.toFixed(6)),
    model: usedModel,
    tokens: {
      input: inputTok,
      output: outputTok,
      cache_read: cacheReadTok,
      cache_write: cacheWriteTok,
    },
  })
}
