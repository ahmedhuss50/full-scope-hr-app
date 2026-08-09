'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Upload,
  Wand2,
  X,
} from 'lucide-react'
import {
  bulkImportUnitsFromRows,
  type BulkImportUnitRow,
} from '../../units/actions'
import {
  MAPPING_FIELDS,
  normAr,
  sheetKeyFromName,
  toDeliveryStatus,
  toIdType,
  toIntOrNull,
  toIsoDateOrNull,
  toNumOrNull,
  toPercentOrNull,
  toStr,
  toUnitType,
  type ColumnMap,
  type ProjectLite,
  type SheetPack,
  type SheetSource,
} from '../_shared/shared-mapping'
import { ManualMappingPanel, MappingSummary } from '../_shared/MappingPanels'

// -----------------------------------------------------------------------------
// Master importer — combined units + buyers + contracts flow from the
// original UnitsImporter, moved to /admin/imports/master and refactored to
// share parsing helpers + mapping panels with the three focused importers.
//
// Multi-sheet semantics (each sheet is tagged with a sale_status) are
// specific to this flow, so it doesn't use BaseImporter.
// -----------------------------------------------------------------------------

interface ParsedRow {
  sheetKey: SheetSource
  sheetName: string
  rowNumber: number
  projectRaw: string
  matchedProjectId: string | null
  selectedProjectId: string       // '' = skip

  unit_number: string
  zone_number: string | null
  block_number: string | null
  // Widened to string — parser now preserves whatever the Excel says (e.g.
  // "شقة تجارية", "دوبلكس", "استوديو") instead of forcing to a 3-value enum.
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
  delivery_status: 'delivered' | 'pending' | 'other' | null
  delivery_date: string | null

  // Financial tracking (migration 055).
  retention_percentage: number | null
  installment_number: number | null
  total_collected_before_tax_sar: number | null
  total_collected_with_tax_sar: number | null
  remaining_amount_sar: number | null
  collection_percentage: number | null
  price_per_meter_sar: number | null
}

type Mode = 'idle' | 'parsing' | 'mapping' | 'manualMap' | 'preview' | 'importing' | 'done'

// -----------------------------------------------------------------------------
// Pure row builder — one row per source-sheet line.
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

    // Skip templated / placeholder rows and subtotal-only rows.
    if (!buyerName && !unitNumber) continue
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
      // Residency subtype has no dedicated AI field in the current schema —
      // legacy layouts stored it separately, new layouts merge it into
      // id_type. Left null; can be filled manually downstream.
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

      // Financial tracking (055). Percentage columns are stored as-is
      // ("35" or "0.35" depending on the source workbook); the display
      // layer normalizes when rendering.
      retention_percentage: toPercentOrNull(at(row, columns.retention_percentage)),
      installment_number: toIntOrNull(at(row, columns.installment_number)),
      total_collected_before_tax_sar: toNumOrNull(
        at(row, columns.total_collected_before_tax_sar),
      ),
      total_collected_with_tax_sar: toNumOrNull(
        at(row, columns.total_collected_with_tax_sar),
      ),
      remaining_amount_sar: toNumOrNull(at(row, columns.remaining_amount_sar)),
      collection_percentage: toPercentOrNull(at(row, columns.collection_percentage)),
      price_per_meter_sar: toNumOrNull(at(row, columns.price_per_meter_sar)),
    })
  }
  return out
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export function MasterImporter({ projects }: { projects: ProjectLite[] }) {
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

    setMode('mapping')
    const nextPacks: SheetPack[] = []
    let costRunning = 0
    for (const pack of aoaPacks) {
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

    const anyOk = nextPacks.some((p) => p.mapping !== null)
    if (!anyOk) {
      setMode('manualMap')
      setError(
        'تعذّر تحليل بنية الملف بالذكاء الاصطناعي. راجع أعمدة الملف يدويًا.',
      )
      return
    }

    finalizePreview(nextPacks)
  }

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
        retention_percentage: r.retention_percentage,
        installment_number: r.installment_number,
        total_collected_before_tax_sar: r.total_collected_before_tax_sar,
        total_collected_with_tax_sar: r.total_collected_with_tax_sar,
        remaining_amount_sar: r.remaining_amount_sar,
        collection_percentage: r.collection_percentage,
        price_per_meter_sar: r.price_per_meter_sar,
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
          relevantFields={MAPPING_FIELDS}
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
            relevantFields={MAPPING_FIELDS}
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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
