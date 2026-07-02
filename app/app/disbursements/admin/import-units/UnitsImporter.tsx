'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Loader2, CheckCircle2, AlertTriangle, X } from 'lucide-react'
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
  rowNumber: number
  projectRaw: string
  matchedProjectId: string | null
  selectedProjectId: string     // empty = "skip"

  // Fields we hand to the server action.
  unit_number: string
  zone_number: string | null
  block_number: string | null
  unit_type: string | null
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
  delivery_status: string | null
  delivery_date: string | null
}

type Mode = 'idle' | 'parsing' | 'preview' | 'importing' | 'done'

// -----------------------------------------------------------------------------
// Helpers
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

// -----------------------------------------------------------------------------
// Per-sheet column maps.
//
// Sheet 1 layout (from spec, header on row 7 → index 6):
//   0:م  1:اسم العميل  2:نوع الـ ID  3:رقم الهوية  4:الجنسية
//   5:نوع الإقامة  6:رقم الجوال  7:اسم المشروع  8:المنطقة  9:المدينة
//   10:الحي  11:المساحة  12:نوع الوحدة  13:رقم المنطقة (ZONE)
//   14:رقم الوحدة  15:عدد مرات بيع الوحدة  16:رقم البلوك  17:رقم العقد
//   18:نوع العقد  19:نوع التمويل  20:اسم الجهة التمويلية
//   21:تاريخ بيع الوحدة  22:سعر الوحدة قبل ضريبة  23:حالة التسليم
//   24:تاريخ التسليم  25:VAT  26:سعر شامل ضريبة
//
// Sheets 2–4 use a similar layout but WITHOUT the "رقم المنطقة (ZONE)" column,
// so every index from 13 onwards shifts LEFT by 1.
// -----------------------------------------------------------------------------

interface ColumnMap {
  buyer_name_ar: number
  buyer_id_type: number
  buyer_id_number: number
  buyer_nationality: number
  buyer_residency_type: number
  buyer_phone: number
  project_name: number
  region: number
  city: number
  district: number
  area_m2: number
  unit_type: number
  zone_number: number | null // sheet 1 only
  unit_number: number
  sale_count: number
  block_number: number
  contract_number: number
  contract_type: number
  financing_type: number
  financing_bank: number
  sale_date: number
  price_before_tax_sar: number
  delivery_status: number
  delivery_date: number
  vat_sar: number
  price_with_vat_sar: number
}

const SHEET1_MAP: ColumnMap = {
  buyer_name_ar: 1,
  buyer_id_type: 2,
  buyer_id_number: 3,
  buyer_nationality: 4,
  buyer_residency_type: 5,
  buyer_phone: 6,
  project_name: 7,
  region: 8,
  city: 9,
  district: 10,
  area_m2: 11,
  unit_type: 12,
  zone_number: 13,
  unit_number: 14,
  sale_count: 15,
  block_number: 16,
  contract_number: 17,
  contract_type: 18,
  financing_type: 19,
  financing_bank: 20,
  sale_date: 21,
  price_before_tax_sar: 22,
  delivery_status: 23,
  delivery_date: 24,
  vat_sar: 25,
  price_with_vat_sar: 26,
}

// Sheets 2–4 — same order minus the ZONE column (was index 13). Every index
// from 14 onwards shifts down by 1.
const SHEET_NO_ZONE_MAP: ColumnMap = {
  buyer_name_ar: 1,
  buyer_id_type: 2,
  buyer_id_number: 3,
  buyer_nationality: 4,
  buyer_residency_type: 5,
  buyer_phone: 6,
  project_name: 7,
  region: 8,
  city: 9,
  district: 10,
  area_m2: 11,
  unit_type: 12,
  zone_number: null,
  unit_number: 13,
  sale_count: 14,
  block_number: 15,
  contract_number: 16,
  contract_type: 17,
  financing_type: 18,
  financing_bank: 19,
  sale_date: 20,
  price_before_tax_sar: 21,
  delivery_status: 22,
  delivery_date: 23,
  vat_sar: 24,
  price_with_vat_sar: 25,
}

// -----------------------------------------------------------------------------
// Sheet-name matching. The user's workbook has fixed Arabic sheet titles;
// we normalize before comparing so trailing/leading whitespace or minor
// spelling variants don't break the router.
// -----------------------------------------------------------------------------

interface SheetPlan {
  key: SheetSource
  headerRowIndex: number // 0-based row where headers live
  columns: ColumnMap
  nameHints: string[]    // normalized Arabic tokens that identify this sheet
}

const SHEET_PLANS: SheetPlan[] = [
  {
    key: 'active',
    headerRowIndex: 6, // row 7 in spec (1-based)
    columns: SHEET1_MAP,
    nameHints: ['سجل المشترين وحدات قائمة', 'المشترين', 'قائمه'],
  },
  {
    key: 'cancelled_resold',
    headerRowIndex: 0,
    columns: SHEET_NO_ZONE_MAP,
    nameHints: ['الوحدات الملغيه والمعاد بيعها', 'المعاد بيعها', 'ملغيه والمعاد'],
  },
  {
    key: 'cancelled',
    headerRowIndex: 0,
    columns: SHEET_NO_ZONE_MAP,
    // "الوحدات الملغية" — must not match cancelled_resold; we pick the more
    // specific match first below.
    nameHints: ['الوحدات الملغيه', 'ملغيه'],
  },
  {
    key: 'completed',
    headerRowIndex: 0,
    columns: SHEET_NO_ZONE_MAP,
    nameHints: ['الوحدات المنجزه', 'منجزه', 'مسلمه'],
  },
]

function planForSheetName(sheetName: string): SheetPlan | null {
  const norm = normAr(sheetName)
  // Prefer plans whose most-specific hint (first in the list) is a substring.
  // Rank by the longest hint match to disambiguate "الملغية" vs
  // "الملغية والمعاد بيعها" (the resold one is longer).
  let best: { plan: SheetPlan; score: number } | null = null
  for (const plan of SHEET_PLANS) {
    for (const hint of plan.nameHints) {
      const h = normAr(hint)
      if (norm.includes(h)) {
        const score = h.length
        if (!best || score > best.score) best = { plan, score }
      }
    }
  }
  return best?.plan ?? null
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export function UnitsImporter({ projects }: { projects: ProjectLite[] }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('idle')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [doneStats, setDoneStats] = useState<
    | { units: number; sales: number }
    | null
  >(null)

  const projectByNorm = useMemo(() => {
    const m = new Map<string, ProjectLite>()
    for (const p of projects) m.set(normAr(p.name_ar), p)
    return m
  }, [projects])

  async function handleFile(file: File) {
    setError(null)
    setMode('parsing')
    try {
      // Dynamic import — Next.js statically picks this up and bundles xlsx
      // as an async chunk. Using a non-literal specifier here breaks
      // webpack's static analysis and causes "Cannot find module 'xlsx'"
      // at runtime.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const XLSX: any = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })

      const collected: ParsedRow[] = []
      for (const name of wb.SheetNames as string[]) {
        const plan = planForSheetName(name)
        if (!plan) continue // sheet we don't recognise
        const sheet = wb.Sheets[name]
        const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: '',
          raw: false,
          blankrows: false,
        })
        const parsedRows = parseSheet(aoa, plan, collected.length)
        collected.push(...parsedRows)
      }

      if (collected.length === 0) {
        setError('لم نعثر على صفوف صالحة. تأكد من أسماء الصفحات وترتيب الأعمدة.')
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
      setMode('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل قراءة الملف.')
      setMode('idle')
    }
  }

  /**
   * Turn a 2-D array of cells (from SheetJS) into ParsedRow[] using the
   * given per-sheet column map. Skips template placeholder rows (no buyer
   * name AND no unit number) and any rows above the header.
   */
  function parseSheet(
    aoa: unknown[][],
    plan: SheetPlan,
    idOffset: number,
  ): ParsedRow[] {
    const out: ParsedRow[] = []
    // Data starts on the row after the header.
    for (let i = plan.headerRowIndex + 1; i < aoa.length; i++) {
      const raw = aoa[i] ?? []
      const cells = raw as unknown[]
      const at = (idx: number | null): unknown => (idx === null ? '' : cells[idx])

      const buyerName = toStr(at(plan.columns.buyer_name_ar))
      const unitNumber = toStr(at(plan.columns.unit_number))

      // Template / placeholder rows: skip.
      if (!buyerName && !unitNumber) continue
      // Sheet 1 in particular has a "totals" row that has no unit; drop those
      // too, but only when unit is empty (buyer alone can be a real active
      // sale awaiting a unit assignment — keep for the owner to inspect).
      if (!unitNumber) continue

      const projectRaw = toStr(at(plan.columns.project_name))

      out.push({
        sheetKey: plan.key,
        rowNumber: i + 1,
        projectRaw,
        matchedProjectId: null,
        selectedProjectId: '',

        unit_number: unitNumber,
        zone_number: toStr(at(plan.columns.zone_number)) || null,
        block_number: toStr(at(plan.columns.block_number)) || null,
        unit_type: toUnitType(at(plan.columns.unit_type)),
        area_m2: toNumOrNull(at(plan.columns.area_m2)),
        district: toStr(at(plan.columns.district)) || null,
        city: toStr(at(plan.columns.city)) || null,
        region: toStr(at(plan.columns.region)) || null,

        sale_count: toNumOrNull(at(plan.columns.sale_count)) ?? 1,
        buyer_name_ar: buyerName || null,
        buyer_id_type: toIdType(at(plan.columns.buyer_id_type)),
        buyer_id_number: toStr(at(plan.columns.buyer_id_number)) || null,
        buyer_nationality: toStr(at(plan.columns.buyer_nationality)) || null,
        buyer_residency_type: toStr(at(plan.columns.buyer_residency_type)) || null,
        buyer_phone: toStr(at(plan.columns.buyer_phone)) || null,
        contract_number: toStr(at(plan.columns.contract_number)) || null,
        contract_type: toStr(at(plan.columns.contract_type)) || null,
        financing_type: toStr(at(plan.columns.financing_type)) || null,
        financing_bank: toStr(at(plan.columns.financing_bank)) || null,
        sale_date: toIsoDateOrNull(at(plan.columns.sale_date)),
        price_before_tax_sar: toNumOrNull(at(plan.columns.price_before_tax_sar)),
        vat_sar: toNumOrNull(at(plan.columns.vat_sar)),
        price_with_vat_sar: toNumOrNull(at(plan.columns.price_with_vat_sar)),
        delivery_status: toDeliveryStatus(at(plan.columns.delivery_status)),
        delivery_date: toIsoDateOrNull(at(plan.columns.delivery_date)),
      })
    }
    // idOffset is only for React keys later — no-op here.
    void idOffset
    return out
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
    setError(null)
    setDoneStats(null)
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

      {mode === 'preview' && (
        <>
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
