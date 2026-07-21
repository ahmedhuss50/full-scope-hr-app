'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Loader2, CheckCircle2, AlertTriangle, X, Wand2 } from 'lucide-react'
import {
  bulkImportUnitsFromRows,
  type BulkImportUnitRow,
} from '../units/actions'

export type ProjectLite = { id: string; name_ar: string; developer_id: string | null }

// -----------------------------------------------------------------------------
// Parsed row shape — one row per source-sheet line, before it's sent to the
// server action. `projectRaw` is preserved so the owner can see the original
// spelling from the file even if the fuzzy match points at a differently-
// worded project name in dsb_projects.
// -----------------------------------------------------------------------------

type SheetSource = 'active' | 'cancelled_resold' | 'cancelled' | 'completed'

type ParsedRow = {
  sheetKey: SheetSource
  sheetName: string
  rowNumber: number
  projectRaw: string
  matchedProjectId: string | null
  selectedProjectId: string     // empty = "skip"

  // Fields we hand to the server action.
  unit_number: string
  zone_number: string | null
  block_number: string | null
  unit_type: 'villa' | 'apartment' | 'other' | null
  area_m2: number | null
  district: string | null
  city: string | null
  region: string | null

  sale_count: number | null
  buyer_name_ar: string | null
  buyer_id_type: 'national' | 'residency' | 'passport' | null
  buyer_id_number: string | null
  buyer_nationality: string | null
  buyer_residency_type: string | null
  buyer_phone: string | null
  contract_number: string | null
  contract_type: string | null
  financing_type: string | null
  financing_bank: string | null
  sale_date: string | null
  price_before_tax_sar: number | null
  vat_sar: number | null
  price_with_vat_sar: number | null
  delivery_status: 'delivered' | 'pending' | 'other' | null
  delivery_date: string | null
}

type Mode =
  | 'idle'
  | 'parsing'   // reading file locally
  | 'mapping'   // Claude figuring out columns
  | 'manualMap' // AI failed, owner picks columns by hand
  | 'preview'
  | 'importing'
  | 'done'

// -----------------------------------------------------------------------------
// AI mapping types — mirror the /api/dsb-units-map-columns response.
// -----------------------------------------------------------------------------

const MAPPING_FIELDS = [
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

type MappingField = (typeof MAPPING_FIELDS)[number]

interface ColumnMap {
  header_row_index: number
  columns: Record<MappingField, number | null>
  notes_ar: string
}

// Arabic labels shown in the mapping strip + manual-mapping UI. Keep in sync
// with MAPPING_FIELDS — one entry per key.
const FIELD_LABELS_AR: Record<MappingField, string> = {
  unit_number: 'رقم الوحدة',
  block_number: 'رقم البلوك',
  zone_number: 'رقم المنطقة (ZONE)',
  unit_type: 'نوع الوحدة',
  area_m2: 'المساحة',
  district: 'الحي',
  city: 'المدينة',
  region: 'المنطقة',
  project_name: 'اسم المشروع',
  buyer_name: 'اسم العميل',
  buyer_id_type: 'نوع الهوية',
  buyer_id_number: 'رقم الهوية',
  buyer_nationality: 'الجنسية',
  buyer_phone: 'رقم الجوال',
  contract_number: 'رقم العقد',
  contract_type: 'نوع العقد',
  financing_type: 'نوع التمويل',
  financing_bank: 'الجهة التمويلية',
  sale_date: 'تاريخ البيع',
  price_before_tax_sar: 'السعر قبل الضريبة',
  vat_sar: 'ضريبة القيمة المضافة',
  price_with_vat_sar: 'السعر شامل الضريبة',
  delivery_status: 'حالة التسليم',
  delivery_date: 'تاريخ التسليم',
  sale_count: 'عدد مرات البيع',
}

// One entry per sheet after step 1. Preserved through preview so we can
// re-run the parser if the owner tweaks a mapping manually.
interface SheetPack {
  name: string
  key: SheetSource
  aoa: unknown[][]
  mapping: ColumnMap | null   // null while awaiting AI or after AI failure
  aiError: string | null
  aiCostUsd: number | null
  aiModel: string | null
}

// -----------------------------------------------------------------------------
// Helpers — Arabic normalization + cell coercion
// -----------------------------------------------------------------------------

function normAr(s: string): string {
  return s
    .replace(/ـ/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/[يى]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = String(v).replace(/[,\s]/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Convert whatever the cell holds into a YYYY-MM-DD string, or null.
 *
 * Accepts:
 *   - JS Date (SheetJS can hand these back with { cellDates:true })
 *   - Excel serial number (days since 1900-01-01, minus the 1900 leap bug)
 *   - Human strings we can loosely parse
 *   - Placeholder Arabic text ("حسب نظام سكني…") — treated as null
 */
function toIsoDateOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10)
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Excel epoch: 1899-12-30 works around the 1900 leap-year bug.
    const epoch = Date.UTC(1899, 11, 30)
    const ms = epoch + v * 86_400_000
    const d = new Date(ms)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return null
  }
  const s = String(v).trim()
  if (!s) return null
  // Placeholder / free-text unusable as a date.
  if (/[؀-ۿ]/.test(s) && !/\d{4}-\d{2}-\d{2}/.test(s)) return null
  // ISO first.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  // Common local formats: dd/mm/yyyy, dd-mm-yyyy
  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(s)
  if (dmy) {
    const dd = dmy[1].padStart(2, '0')
    const mm = dmy[2].padStart(2, '0')
    return `${dmy[3]}-${mm}-${dd}`
  }
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

/**
 * Map the Arabic "نوع الوحدة" cell to our enum. Keeps unknown values as 'other'
 * rather than dropping them entirely — the raw value is discarded either way.
 */
function toUnitType(v: unknown): 'villa' | 'apartment' | 'other' | null {
  const s = toStr(v)
  if (!s) return null
  const n = normAr(s)
  if (n.includes('فيلا') || n.includes('فله')) return 'villa'
  if (n.includes('شقه') || n.includes('شقة') || n.includes('شقق')) return 'apartment'
  return 'other'
}

/**
 * Map "نوع الـ ID" to our enum. Covers common Saudi variants: هوية وطنية,
 * إقامة, جواز. Anything else → null.
 */
function toIdType(v: unknown): 'national' | 'residency' | 'passport' | null {
  const s = toStr(v)
  if (!s) return null
  const n = normAr(s)
  if (n.includes('هويه') || n.includes('وطني') || n.includes('national')) return 'national'
  if (n.includes('اقامه') || n.includes('اقاما') || n.includes('residen') || n.includes('iqama')) return 'residency'
  if (n.includes('جواز') || n.includes('passport')) return 'passport'
  return null
}

/**
 * Map "حالة التسليم" to a short token. Anything that looks like "تم/سُلّم"
 * → delivered; "لم/قيد/بانتظار" → pending; otherwise "other".
 */
function toDeliveryStatus(v: unknown): 'delivered' | 'pending' | 'other' | null {
  const s = toStr(v)
  if (!s) return null
  const n = normAr(s)
  if (n.includes('تم') || n.includes('سلم') || n.includes('deliver')) return 'delivered'
  if (n.includes('لم') || n.includes('قيد') || n.includes('انتظار') || n.includes('pend')) return 'pending'
  return 'other'
}

/**
 * Guess the sale-status bucket from an Arabic sheet name. Defaults to
 * `active` if nothing matches — the owner can always re-tag rows in preview.
 *
 * Order matters: `cancelled_resold` must be checked BEFORE `cancelled` so a
 * name containing both "ملغية" and "معاد بيعها" doesn't get labelled as
 * plain cancelled.
 */
function sheetKeyFromName(sheetName: string): SheetSource {
  const n = normAr(sheetName)
  // Resold first — most specific.
  if ((n.includes('ملغ') || n.includes('لغيه') || n.includes('لغيت')) &&
      (n.includes('معاد') || n.includes('بيعها') || n.includes('اعاد'))) {
    return 'cancelled_resold'
  }
  if (n.includes('ملغ') || n.includes('لغيه') || n.includes('لغيت')) {
    return 'cancelled'
  }
  if (n.includes('منجز') || n.includes('مسلم') || n.includes('مسلمه')) {
    return 'completed'
  }
  return 'active'
}

// Convert 0-based column index to Excel letters (0 → A, 25 → Z, 26 → AA…).
function colIndexToLetter(i: number): string {
  let n = i
  let s = ''
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

// -----------------------------------------------------------------------------
// Row builder — pure function of (aoa, mapping, sheetKey). Kept outside the
// component so the manual-mapping UI can call it too.
// -----------------------------------------------------------------------------

function buildRowsFromMapping(pack: SheetPack): ParsedRow[] {
  if (!pack.mapping) return []
  const { header_row_index, columns } = pack.mapping
  const aoa = pack.aoa
  const at = (row: unknown[], idx: number | null): unknown =>
    idx === null || idx < 0 ? '' : row[idx]

  const out: ParsedRow[] = []
  for (let i = header_row_index + 1; i < aoa.length; i++) {
    const row = (aoa[i] ?? []) as unknown[]

    const buyerName = toStr(at(row, columns.buyer_name))
    const unitNumber = toStr(at(row, columns.unit_number))

    // Template / placeholder rows: skip if both key fields empty.
    if (!buyerName && !unitNumber) continue
    // Rows with no unit_number are almost always subtotal rows; skip.
    if (!unitNumber) continue

    const projectRaw = toStr(at(row, columns.project_name))

    out.push({
      sheetKey: pack.key,
      sheetName: pack.name,
      rowNumber: i + 1,
      projectRaw,
      matchedProjectId: null,
      selectedProjectId: '',

      unit_number: unitNumber,
      zone_number: toStr(at(row, columns.zone_number)) || null,
      block_number: toStr(at(row, columns.block_number)) || null,
      unit_type: toUnitType(at(row, columns.unit_type)),
      area_m2: toNumOrNull(at(row, columns.area_m2)),
      district: toStr(at(row, columns.district)) || null,
      city: toStr(at(row, columns.city)) || null,
      region: toStr(at(row, columns.region)) || null,

      sale_count: toNumOrNull(at(row, columns.sale_count)) ?? 1,
      buyer_name_ar: buyerName || null,
      buyer_id_type: toIdType(at(row, columns.buyer_id_type)),
      buyer_id_number: toStr(at(row, columns.buyer_id_number)) || null,
      buyer_nationality: toStr(at(row, columns.buyer_nationality)) || null,
      // No dedicated AI field for residency subtype — the older layout stored
      // it in a separate column; new layouts merge it into id_type. Left null
      // and the owner can add it manually if required downstream.
      buyer_residency_type: null,
      buyer_phone: toStr(at(row, columns.buyer_phone)) || null,
      contract_number: toStr(at(row, columns.contract_number)) || null,
      contract_type: toStr(at(row, columns.contract_type)) || null,
      financing_type: toStr(at(row, columns.financing_type)) || null,
      financing_bank: toStr(at(row, columns.financing_bank)) || null,
      sale_date: toIsoDateOrNull(at(row, columns.sale_date)),
      price_before_tax_sar: toNumOrNull(at(row, columns.price_before_tax_sar)),
      vat_sar: toNumOrNull(at(row, columns.vat_sar)),
      price_with_vat_sar: toNumOrNull(at(row, columns.price_with_vat_sar)),
      delivery_status: toDeliveryStatus(at(row, columns.delivery_status)),
      delivery_date: toIsoDateOrNull(at(row, columns.delivery_date)),
    })
  }
  return out
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export function UnitsImporter({ projects }: { projects: ProjectLite[] }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('idle')
  const [packs, setPacks] = useState<SheetPack[]>([])
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [doneStats, setDoneStats] = useState<
    | { units: number; sales: number }
    | null
  >(null)
  const [totalAiCostUsd, setTotalAiCostUsd] = useState<number>(0)

  const projectByNorm = useMemo(() => {
    const m = new Map<string, ProjectLite>()
    for (const p of projects) m.set(normAr(p.name_ar), p)
    return m
  }, [projects])

  async function handleFile(file: File) {
    setError(null)
    setWarnings([])
    setDoneStats(null)
    setRows([])
    setPacks([])
    setTotalAiCostUsd(0)
    setMode('parsing')

    let aoaPacks: SheetPack[] = []
    try {
      // Dynamic import — Next.js statically picks this up and bundles xlsx
      // as an async chunk. Using a non-literal specifier here breaks
      // webpack's static analysis and causes "Cannot find module 'xlsx'"
      // at runtime.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const XLSX: any = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })

      for (const name of wb.SheetNames as string[]) {
        const sheet = wb.Sheets[name]
        const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: '',
          raw: false,
          blankrows: false,
        })
        if (!aoa || aoa.length === 0) continue
        aoaPacks.push({
          name,
          key: sheetKeyFromName(name),
          aoa,
          mapping: null,
          aiError: null,
          aiCostUsd: null,
          aiModel: null,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل قراءة الملف.')
      setMode('idle')
      return
    }

    if (aoaPacks.length === 0) {
      setError('لم نعثر على أي صفحات تحتوي على بيانات.')
      setMode('idle')
      return
    }

    // ----- Step 1: ask Claude for the column mapping of each sheet -----
    setMode('mapping')
    const nextPacks: SheetPack[] = []
    let costRunning = 0
    for (const pack of aoaPacks) {
      // Send at most the first 10 rows — enough for the header + a couple of
      // data rows so Claude can double-check its guess.
      const sample = pack.aoa.slice(0, 10)
      try {
        const resp = await fetch('/api/dsb-units-map-columns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sample_rows: sample, sheet_name: pack.name }),
        })
        const json = (await resp.json()) as
          | { ok: true; mapping: ColumnMap; cost_usd: number; model: string }
          | { ok: false; error: string }
        if (!resp.ok || !json.ok) {
          const errMsg = !json.ok ? json.error : `HTTP ${resp.status}`
          nextPacks.push({ ...pack, aiError: errMsg })
          continue
        }
        costRunning += json.cost_usd || 0
        nextPacks.push({
          ...pack,
          mapping: json.mapping,
          aiCostUsd: json.cost_usd,
          aiModel: json.model,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        nextPacks.push({ ...pack, aiError: msg })
      }
    }

    setPacks(nextPacks)
    setTotalAiCostUsd(costRunning)

    // If EVERY sheet failed the AI call, drop to manual-mapping mode so the
    // owner isn't stuck. (Individual per-sheet failures also route through
    // the same UI but only for the affected sheet.)
    const anyOk = nextPacks.some((p) => p.mapping !== null)
    if (!anyOk) {
      setMode('manualMap')
      setError(
        'تعذّر تحليل بنية الملف بالذكاء الاصطناعي. راجع أعمدة الملف يدويًا.',
      )
      return
    }

    // Any partial failures produce warnings; only sheets with a mapping are
    // parsed. The manual-mapping UI is available from the preview screen if
    // the owner wants to fix a partial failure.
    finalizePreview(nextPacks)
  }

  /**
   * Build ParsedRow[] from every pack that has a mapping, auto-match project
   * names, and land on the preview screen. Called on both the happy path and
   * after the owner completes a manual mapping.
   */
  function finalizePreview(packList: SheetPack[]) {
    const warns: string[] = []
    const collected: ParsedRow[] = []
    for (const pack of packList) {
      if (!pack.mapping) {
        warns.push(
          `تعذّر تحليل صفحة «${pack.name}» بالذكاء الاصطناعي — تم تخطّيها.` +
            (pack.aiError ? ` (${pack.aiError})` : ''),
        )
        continue
      }
      try {
        const built = buildRowsFromMapping(pack)
        if (built.length === 0) {
          warns.push(`صفحة «${pack.name}» لم تُنتِج أي صفوف صالحة.`)
        }
        collected.push(...built)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        warns.push(`فشل تحويل صفحة «${pack.name}»: ${msg}`)
      }
    }

    if (collected.length === 0) {
      setWarnings(warns)
      setError('لم نعثر على صفوف صالحة بعد تحليل الأعمدة.')
      setMode('idle')
      return
    }

    // Auto-match every row's project.
    const matched = collected.map((r) => {
      if (!r.projectRaw) return r
      const proj = projectByNorm.get(normAr(r.projectRaw))
      if (!proj) return r
      return { ...r, matchedProjectId: proj.id, selectedProjectId: proj.id }
    })

    setRows(matched)
    setWarnings(warns)
    setMode('preview')
  }

  async function confirmImport() {
    setError(null)
    const toImport: BulkImportUnitRow[] = []
    for (const r of rows) {
      if (!r.selectedProjectId) continue
      toImport.push({
        project_id: r.selectedProjectId,
        unit_number: r.unit_number,
        zone_number: r.zone_number,
        block_number: r.block_number,
        unit_type: r.unit_type,
        area_m2: r.area_m2,
        district: r.district,
        city: r.city,
        region: r.region,

        sale_status: r.sheetKey,
        sale_count: r.sale_count,
        buyer_name_ar: r.buyer_name_ar,
        buyer_id_type: r.buyer_id_type,
        buyer_id_number: r.buyer_id_number,
        buyer_nationality: r.buyer_nationality,
        buyer_residency_type: r.buyer_residency_type,
        buyer_phone: r.buyer_phone,
        contract_number: r.contract_number,
        contract_type: r.contract_type,
        financing_type: r.financing_type,
        financing_bank: r.financing_bank,
        sale_date: r.sale_date,
        price_before_tax_sar: r.price_before_tax_sar,
        vat_sar: r.vat_sar,
        price_with_vat_sar: r.price_with_vat_sar,
        delivery_status: r.delivery_status,
        delivery_date: r.delivery_date,
      })
    }
    if (toImport.length === 0) {
      setError('لم تختر أي صف للاستيراد. يجب تحديد المشروع لكل صف على الأقل.')
      return
    }
    setMode('importing')
    const res = await bulkImportUnitsFromRows({ rows: toImport })
    if (!res.ok) {
      setError(res.error)
      setMode('preview')
      return
    }
    setDoneStats({ units: res.units_upserted, sales: res.sales_inserted })
    setMode('done')
    router.refresh()
  }

  function reset() {
    setRows([])
    setPacks([])
    setError(null)
    setWarnings([])
    setDoneStats(null)
    setTotalAiCostUsd(0)
    setMode('idle')
  }

  const matchedCount = rows.filter((r) => !!r.matchedProjectId).length
  const willImportCount = rows.filter((r) => !!r.selectedProjectId).length

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {warnings.length > 0 && (
        <ul
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1 list-disc ms-5"
        >
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {mode === 'idle' && (
        <label className="block">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition cursor-pointer">
            <Upload className="w-4 h-4" aria-hidden="true" />
            اختر ملف Excel
          </span>
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void handleFile(f)
            }}
          />
        </label>
      )}

      {mode === 'parsing' && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          جاري قراءة الملف…
        </div>
      )}

      {mode === 'mapping' && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <Wand2 className="w-4 h-4 text-teal-600" aria-hidden="true" />
          جاري تحليل بنية الملف بالذكاء الاصطناعي…
        </div>
      )}

      {mode === 'manualMap' && (
        <ManualMappingPanel
          packs={packs}
          onCancel={reset}
          onDone={(updated) => {
            setPacks(updated)
            finalizePreview(updated)
          }}
        />
      )}

      {mode === 'preview' && (
        <>
          <MappingSummary
            packs={packs}
            totalAiCostUsd={totalAiCostUsd}
            onRemap={() => setMode('manualMap')}
          />

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-slate-700">
              <span className="font-semibold">{rows.length}</span> صف ·{' '}
              <span className="text-emerald-700 font-semibold mx-1">{matchedCount}</span>{' '}
              مُطابَقة تلقائيًا ·{' '}
              <span className="text-slate-900 font-semibold mx-1">{willImportCount}</span>{' '}
              ستُستورد
            </div>
            <div className="inline-flex items-center gap-2">
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
                إلغاء
              </button>
              <button
                type="button"
                onClick={confirmImport}
                disabled={willImportCount === 0}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold shadow-sm hover:bg-emerald-700 transition disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                استيراد {willImportCount} صف
              </button>
            </div>
          </div>

          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-y border-slate-200">
                <tr className="text-right">
                  <Th>الحالة</Th>
                  <Th>الصفحة</Th>
                  <Th>رقم الوحدة</Th>
                  <Th>العميل</Th>
                  <Th>رقم العقد</Th>
                  <Th>المشروع (من الملف)</Th>
                  <Th>المشروع المُطابَق</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, idx) => {
                  const status = !r.selectedProjectId
                    ? r.matchedProjectId === null
                      ? {
                          cls: 'bg-amber-50 text-amber-800 ring-amber-200',
                          label: 'لا توجد مطابقة',
                          Icon: AlertTriangle,
                        }
                      : {
                          cls: 'bg-slate-100 text-slate-600 ring-slate-200',
                          label: 'تخطّي',
                          Icon: X,
                        }
                    : r.matchedProjectId === r.selectedProjectId
                    ? {
                        cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
                        label: 'مُطابَقة',
                        Icon: CheckCircle2,
                      }
                    : {
                        cls: 'bg-teal-50 text-teal-700 ring-teal-200',
                        label: 'تعديل يدوي',
                        Icon: CheckCircle2,
                      }
                  return (
                    <tr
                      key={`${r.sheetKey}-${r.rowNumber}-${idx}`}
                      className="hover:bg-slate-50/60"
                    >
                      <Td>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${status.cls}`}
                        >
                          <status.Icon className="w-3 h-3" aria-hidden="true" />
                          {status.label}
                        </span>
                      </Td>
                      <Td>
                        <SheetChip sheet={r.sheetKey} />
                      </Td>
                      <Td className="font-mono text-xs">{r.unit_number || '—'}</Td>
                      <Td className="max-w-[14rem] truncate">{r.buyer_name_ar || '—'}</Td>
                      <Td className="font-mono text-xs">{r.contract_number || '—'}</Td>
                      <Td className="max-w-[12rem] truncate">{r.projectRaw || '—'}</Td>
                      <Td>
                        <select
                          value={r.selectedProjectId}
                          onChange={(e) => {
                            const v = e.target.value
                            setRows((prev) =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, selectedProjectId: v } : row,
                              ),
                            )
                          }}
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        >
                          <option value="">— تخطّي —</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name_ar}
                            </option>
                          ))}
                        </select>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {mode === 'importing' && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          جاري الاستيراد…
        </div>
      )}

      {mode === 'done' && doneStats && (
        <div className="space-y-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <div className="font-semibold inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              تم الاستيراد بنجاح
            </div>
            <div className="mt-1 text-xs text-emerald-700">
              حُدِّثت <span className="font-mono font-bold">{doneStats.units}</span> وحدة ·{' '}
              أُدرِجت <span className="font-mono font-bold">{doneStats.sales}</span> عملية بيع.
            </div>
          </div>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            استيراد ملف آخر
          </button>
        </div>
      )}
    </section>
  )
}

// -----------------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------------

/**
 * Compact per-sheet strip showing which fields the AI mapped and to which
 * Excel column. Also surfaces the ~cost so the owner can eyeball spend.
 * A "تعديل يدوي" button drops back into the manual-mapping UI to override.
 */
function MappingSummary({
  packs,
  totalAiCostUsd,
  onRemap,
}: {
  packs: SheetPack[]
  totalAiCostUsd: number
  onRemap: () => void
}) {
  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-900">
          <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
          تحليل الذكاء الاصطناعي لأعمدة الملف
          <span className="mx-1 text-[10px] font-mono text-teal-700">
            (${totalAiCostUsd.toFixed(4)})
          </span>
        </div>
        <button
          type="button"
          onClick={onRemap}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-teal-200 bg-white text-[11px] font-semibold text-teal-800 hover:bg-teal-50 transition"
        >
          تعديل يدوي
        </button>
      </div>
      <ul className="space-y-1.5">
        {packs.map((p) => (
          <li key={p.name} className="text-[11px] text-slate-700">
            <div className="font-semibold text-slate-900 mb-0.5">
              «{p.name}»
              {p.mapping && (
                <span className="ms-1 font-normal text-slate-500">
                  · الرأس على الصف {p.mapping.header_row_index + 1}
                </span>
              )}
            </div>
            {p.mapping ? (
              <div className="flex flex-wrap gap-1">
                {MAPPING_FIELDS.map((f) => {
                  const idx = p.mapping!.columns[f]
                  const label = FIELD_LABELS_AR[f]
                  return (
                    <span
                      key={f}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ring-1 ring-inset ${
                        idx === null
                          ? 'bg-slate-100 text-slate-500 ring-slate-200'
                          : 'bg-white text-teal-800 ring-teal-200'
                      }`}
                      title={idx === null ? 'غير موجود' : `العمود ${colIndexToLetter(idx)} (${idx})`}
                    >
                      {label}
                      <span className="font-mono text-[10px] text-slate-500">
                        {idx === null ? 'غير موجود' : colIndexToLetter(idx)}
                      </span>
                    </span>
                  )
                })}
              </div>
            ) : (
              <div className="text-red-700">
                فشل التحليل الآلي{p.aiError ? ` — ${p.aiError}` : ''}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Manual-mapping fallback. For each sheet the owner picks the header row and
 * a column index for every field via dropdowns. On "استمرار" we commit the
 * mapping back onto each pack and rebuild the preview.
 */
function ManualMappingPanel({
  packs,
  onCancel,
  onDone,
}: {
  packs: SheetPack[]
  onCancel: () => void
  onDone: (updated: SheetPack[]) => void
}) {
  // Local editable copy of each pack's mapping. Start from AI's mapping when
  // available, otherwise seed with header_row_index=0 and all nulls.
  const [draft, setDraft] = useState<SheetPack[]>(() =>
    packs.map((p) => ({
      ...p,
      mapping:
        p.mapping ??
        ({
          header_row_index: 0,
          columns: MAPPING_FIELDS.reduce(
            (acc, k) => {
              acc[k] = null
              return acc
            },
            {} as Record<MappingField, number | null>,
          ),
          notes_ar: '',
        } as ColumnMap),
    })),
  )

  function updatePack(name: string, mut: (m: ColumnMap) => ColumnMap) {
    setDraft((prev) =>
      prev.map((p) => (p.name === name && p.mapping ? { ...p, mapping: mut(p.mapping) } : p)),
    )
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 space-y-4">
      <div className="text-sm text-amber-900 font-semibold">
        مطابقة أعمدة يدوية — اختر رقم العمود لكل حقل، ثم اضغط «استمرار».
      </div>
      {draft.map((p) => {
        const mapping = p.mapping!
        const headerRow = (p.aoa[mapping.header_row_index] ?? []) as unknown[]
        // Build a "column N — first-value preview" list to help the owner
        // pick the right column even when the label is ambiguous.
        const colOptions = headerRow.map((cell, i) => {
          const label = toStr(cell) || '(فارغ)'
          return { i, label: `${colIndexToLetter(i)} · ${label}` }
        })

        // If the header row the AI (or the seed) picked is way past the AOA,
        // fall back to using the first row so the dropdowns aren't empty.
        const usableColOptions =
          colOptions.length > 0
            ? colOptions
            : ((p.aoa[0] ?? []) as unknown[]).map((cell, i) => ({
                i,
                label: `${colIndexToLetter(i)} · ${toStr(cell) || '(فارغ)'}`,
              }))

        return (
          <div key={p.name} className="rounded-md border border-amber-200 bg-white p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs font-semibold text-slate-900">«{p.name}»</div>
              <label className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                صف رأس الجدول (0-based):
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, p.aoa.length - 1)}
                  value={mapping.header_row_index}
                  onChange={(e) => {
                    const v = Math.max(0, Number(e.target.value) || 0)
                    updatePack(p.name, (m) => ({ ...m, header_row_index: v }))
                  }}
                  className="w-16 px-1.5 py-0.5 rounded border border-slate-200 text-xs"
                />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-1.5">
              {MAPPING_FIELDS.map((f) => {
                const val = mapping.columns[f]
                return (
                  <label key={f} className="flex items-center gap-2 text-[11px]">
                    <span className="min-w-[9rem] text-slate-700">{FIELD_LABELS_AR[f]}</span>
                    <select
                      value={val === null ? '' : String(val)}
                      onChange={(e) => {
                        const raw = e.target.value
                        const next = raw === '' ? null : Number(raw)
                        updatePack(p.name, (m) => ({
                          ...m,
                          columns: { ...m.columns, [f]: next },
                        }))
                      }}
                      className="flex-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px]"
                    >
                      <option value="">— غير موجود —</option>
                      {usableColOptions.map((o) => (
                        <option key={o.i} value={o.i}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          إلغاء
        </button>
        <button
          type="button"
          onClick={() => onDone(draft)}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition"
        >
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          استمرار
        </button>
      </div>
    </div>
  )
}

function SheetChip({ sheet }: { sheet: SheetSource }) {
  const map: Record<SheetSource, { cls: string; label: string }> = {
    active: { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'قائمة' },
    cancelled_resold: {
      cls: 'bg-amber-50 text-amber-800 ring-amber-200',
      label: 'ملغاة/معاد',
    },
    cancelled: { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'ملغاة' },
    completed: { cls: 'bg-blue-50 text-blue-700 ring-blue-200', label: 'منجزة' },
  }
  const s = map[sheet]
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${s.cls}`}
    >
      {s.label}
    </span>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  )
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 text-sm text-slate-700 align-top ${className ?? ''}`}>
      {children}
    </td>
  )
}
