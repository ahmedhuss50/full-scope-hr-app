'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Loader2, Upload, Wand2, X } from 'lucide-react'
import {
  FIELD_LABELS_AR,
  MAPPING_FIELDS,
  normAr,
  sheetKeyFromName,
  toStr,
  type ColumnMap,
  type MappingField,
  type ProjectLite,
  type SheetPack,
} from './shared-mapping'
import { ManualMappingPanel, MappingSummary } from './MappingPanels'

// -----------------------------------------------------------------------------
// Reusable client-side importer for the three focused importers (units,
// buyers, contracts). Handles: file pick → AI column-map → preview →
// confirm. The master importer is deliberately kept separate — it has
// multi-sheet sale-status semantics that don't apply to the focused flows.
//
// A row here always carries `project_id` (resolved via the AI's project_name
// column + our fuzzy match) and `unit_number` (the match key). Extra target
// fields are pulled from the AI mapping by the caller's `parseRow`.
// -----------------------------------------------------------------------------

// Shape every parsed row must satisfy — the base rows the UI knows how to
// render + a payload the caller assembles for its server action.
export interface BaseParsedRow<TPayload> {
  sheetName: string
  rowNumber: number
  projectRaw: string
  matchedProjectId: string | null
  selectedProjectId: string        // empty = "skip"
  unit_number: string
  // Extra columns rendered in preview beyond the shared ones.
  previewCells: Record<string, string>
  // Rendered by the server action.
  payload: TPayload
  // Set once we know the unit doesn't exist yet in dsb_project_units.
  unitExists: boolean | null
}

// Per-column preview cell definition — extra columns beyond the shared
// (unit_number, project raw, project matched) that appear in the preview
// table.
export interface PreviewColumn {
  key: string
  label: string
}

export interface BaseImporterResult {
  ok: boolean
  message: ReactNode
  // Optional additional block to render inside the "done" panel (e.g. list
  // of unmatched rows).
  extra?: ReactNode
}

export interface BaseImporterProps<TPayload> {
  title: string
  subtitle: string
  projects: ProjectLite[]

  /** Fields the AI mapping cares about for this importer. Also drives which
   *  cells are visible in MappingSummary / ManualMappingPanel. */
  relevantFields: readonly MappingField[]

  /** Columns rendered in the preview table, in the order they should appear.
   *  Values come from BaseParsedRow.previewCells[key]. */
  previewColumns: readonly PreviewColumn[]

  /** Turn an already-mapped row into the shape the server action wants +
   *  populate previewCells. Return null to drop the row entirely (e.g. it's
   *  missing unit_number). */
  parseRow: (args: {
    rowValues: unknown[]
    columns: Record<MappingField, number | null>
    sheetName: string
    rowNumber: number
    projectRaw: string
  }) => Omit<BaseParsedRow<TPayload>, 'matchedProjectId' | 'selectedProjectId' | 'unitExists'> | null

  /** Called with the set of (project_id, unit_number) pairs the user is about
   *  to submit. Should return a Set of "project_id::unit_number" keys that
   *  DO exist in dsb_project_units. Used to flag unmatched rows in the
   *  preview. Optional — if omitted the preview shows no exists/missing
   *  status per row. */
  checkExisting?: (
    pairs: Array<{ project_id: string; unit_number: string }>,
  ) => Promise<Set<string>>

  /** Server action wrapper. Receives the final payload list and returns a
   *  presentable result. */
  onSubmit: (
    payloads: TPayload[],
    projectIds: string[],
  ) => Promise<BaseImporterResult>

  /** Inject the freshly-picked project id into each row's payload right
   *  before submission. parseRow runs at file-parse time, before the user
   *  has chosen a project, so the payload can't know its project_id up
   *  front. Default: return the payload unchanged. When `allowOrphan` is
   *  true this is also called for rows with no project (projectId = ""). */
  attachProjectId?: (payload: TPayload, projectId: string) => TPayload

  /** When true, rows without a selected project are ALSO submitted (with
   *  empty-string projectId flowing through attachProjectId). Used by the
   *  payments importer, where a payment row can legitimately be orphan
   *  (no matching project in the tenant's project list). Default: false —
   *  matches the original "you must pick a project" behavior all four
   *  earlier importers rely on. */
  allowOrphan?: boolean
}

type Mode =
  | 'idle'
  | 'parsing'
  | 'mapping'
  | 'manualMap'
  | 'checkingExisting'
  | 'preview'
  | 'importing'
  | 'done'

export function BaseImporter<TPayload>(props: BaseImporterProps<TPayload>) {
  const router = useRouter()
  const {
    title,
    subtitle,
    projects,
    relevantFields,
    previewColumns,
    parseRow,
    checkExisting,
    onSubmit,
    attachProjectId,
    allowOrphan,
  } = props

  const [mode, setMode] = useState<Mode>('idle')
  const [packs, setPacks] = useState<SheetPack[]>([])
  const [rows, setRows] = useState<BaseParsedRow<TPayload>[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [totalAiCostUsd, setTotalAiCostUsd] = useState<number>(0)
  const [doneResult, setDoneResult] = useState<BaseImporterResult | null>(null)

  const projectByNorm = useMemo(() => {
    const m = new Map<string, ProjectLite>()
    for (const p of projects) m.set(normAr(p.name_ar), p)
    return m
  }, [projects])

  async function handleFile(file: File) {
    setError(null)
    setWarnings([])
    setDoneResult(null)
    setRows([])
    setPacks([])
    setTotalAiCostUsd(0)
    setMode('parsing')

    let aoaPacks: SheetPack[] = []
    try {
      // Dynamic import so xlsx ends up in an async chunk. Non-literal
      // specifiers here break webpack's static analysis.
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

    // Step 1 — Claude column mapping per sheet.
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
      setError('تعذّر تحليل بنية الملف بالذكاء الاصطناعي. راجع أعمدة الملف يدويًا.')
      return
    }

    await finalizePreview(nextPacks)
  }

  async function finalizePreview(packList: SheetPack[]) {
    const warns: string[] = []
    const collected: BaseParsedRow<TPayload>[] = []
    for (const pack of packList) {
      if (!pack.mapping) {
        warns.push(
          `تعذّر تحليل صفحة «${pack.name}» بالذكاء الاصطناعي — تم تخطّيها.` +
            (pack.aiError ? ` (${pack.aiError})` : ''),
        )
        continue
      }
      try {
        const { header_row_index, columns } = pack.mapping
        const at = (row: unknown[], idx: number | null): unknown =>
          idx === null || idx < 0 ? '' : row[idx]

        for (let i = header_row_index + 1; i < pack.aoa.length; i++) {
          const row = (pack.aoa[i] ?? []) as unknown[]
          const projectRaw = toStr(at(row, columns.project_name))
          const built = parseRow({
            rowValues: row,
            columns,
            sheetName: pack.name,
            rowNumber: i + 1,
            projectRaw,
          })
          if (!built) continue
          collected.push({
            ...built,
            matchedProjectId: null,
            selectedProjectId: '',
            unitExists: null,
          })
        }
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

    // Auto-match project by normalized Arabic name.
    const matched = collected.map((r) => {
      if (!r.projectRaw) return r
      const proj = projectByNorm.get(normAr(r.projectRaw))
      if (!proj) return r
      return { ...r, matchedProjectId: proj.id, selectedProjectId: proj.id }
    })

    // If the importer wants to flag unmatched units, look them up now — one
    // round-trip via checkExisting to avoid N queries client-side.
    let checked = matched
    if (checkExisting) {
      setMode('checkingExisting')
      const pairs = matched
        .filter((r) => !!r.selectedProjectId && !!r.unit_number)
        .map((r) => ({ project_id: r.selectedProjectId, unit_number: r.unit_number }))
      let existSet = new Set<string>()
      try {
        existSet = await checkExisting(pairs)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        warns.push(`تعذّر التحقق من وجود الوحدات: ${msg}`)
      }
      checked = matched.map((r) => {
        if (!r.selectedProjectId || !r.unit_number) return { ...r, unitExists: null }
        const key = `${r.selectedProjectId}::${r.unit_number}`
        return { ...r, unitExists: existSet.has(key) }
      })
    }

    setRows(checked)
    setWarnings(warns)
    setMode('preview')
  }

  async function confirmImport() {
    setError(null)
    const payloads: TPayload[] = []
    const projectIds = new Set<string>()
    for (const r of rows) {
      // Skip only if the importer requires a project AND the user didn't
      // pick one. `allowOrphan` importers (e.g. payments) let orphan rows
      // through with an empty projectId.
      if (!r.selectedProjectId && !allowOrphan) continue
      const finalPayload = attachProjectId
        ? attachProjectId(r.payload, r.selectedProjectId)
        : r.payload
      payloads.push(finalPayload)
      if (r.selectedProjectId) projectIds.add(r.selectedProjectId)
    }
    if (payloads.length === 0) {
      setError(
        allowOrphan
          ? 'لا توجد صفوف صالحة للاستيراد.'
          : 'لم تختر أي صف للاستيراد. يجب تحديد المشروع لكل صف على الأقل.',
      )
      return
    }
    setMode('importing')
    const res = await onSubmit(payloads, Array.from(projectIds))
    setDoneResult(res)
    if (!res.ok) {
      setError(typeof res.message === 'string' ? res.message : 'فشل الاستيراد.')
      setMode('preview')
      return
    }
    setMode('done')
    router.refresh()
  }

  function reset() {
    setRows([])
    setPacks([])
    setError(null)
    setWarnings([])
    setDoneResult(null)
    setTotalAiCostUsd(0)
    setMode('idle')
  }

  // Update a row's project on the fly. Also re-check "unit exists" for that
  // row against the newly-picked project — a cheap lookup against the map
  // built at preview time isn't possible from here without extra state, so
  // we reset it to null which the UI reads as "unknown".
  function setRowProject(idx: number, projectId: string) {
    setRows((prev) =>
      prev.map((row, i) =>
        i === idx
          ? { ...row, selectedProjectId: projectId, unitExists: projectId ? null : row.unitExists }
          : row,
      ),
    )
  }

  const matchedCount = rows.filter((r) => !!r.matchedProjectId).length
  // When allowOrphan is on, EVERY parsed row counts toward the import — the
  // "no project" case is legitimate rather than "skip".
  const willImportCount = allowOrphan
    ? rows.length
    : rows.filter((r) => !!r.selectedProjectId).length
  const unmatchedUnitCount = rows.filter(
    (r) => !!r.selectedProjectId && r.unitExists === false,
  ).length

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-4">
      <header className="space-y-1">
        <h2 className="serif font-bold text-lg text-slate-900">{title}</h2>
        <p className="text-xs text-slate-600 max-w-3xl leading-relaxed">{subtitle}</p>
      </header>

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

      {mode === 'checkingExisting' && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          جاري التحقق من وجود الوحدات…
        </div>
      )}

      {mode === 'manualMap' && (
        <ManualMappingPanel
          packs={packs}
          relevantFields={relevantFields}
          onCancel={reset}
          onDone={(updated) => {
            setPacks(updated)
            void finalizePreview(updated)
          }}
        />
      )}

      {mode === 'preview' && (
        <>
          <MappingSummary
            packs={packs}
            totalAiCostUsd={totalAiCostUsd}
            relevantFields={relevantFields}
            onRemap={() => setMode('manualMap')}
          />

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-slate-700">
              <span className="font-semibold">{rows.length}</span> صف ·{' '}
              <span className="text-emerald-700 font-semibold mx-1">{matchedCount}</span>{' '}
              مُطابَقة تلقائيًا ·{' '}
              <span className="text-slate-900 font-semibold mx-1">{willImportCount}</span>{' '}
              ستُستورد
              {unmatchedUnitCount > 0 && (
                <>
                  {' · '}
                  <span className="text-amber-700 font-semibold">
                    {unmatchedUnitCount}
                  </span>{' '}
                  وحدات غير موجودة
                </>
              )}
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
                  <Th>رقم الوحدة</Th>
                  {previewColumns.map((c) => (
                    <Th key={c.key}>{c.label}</Th>
                  ))}
                  <Th>المشروع (من الملف)</Th>
                  <Th>المشروع المُطابَق</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, idx) => {
                  const status = computeStatus(r)
                  return (
                    <tr
                      key={`${r.sheetName}-${r.rowNumber}-${idx}`}
                      className={`hover:bg-slate-50/60 ${r.unitExists === false ? 'bg-amber-50/40' : ''}`}
                    >
                      <Td>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${status.cls}`}
                        >
                          <status.Icon className="w-3 h-3" aria-hidden="true" />
                          {status.label}
                        </span>
                        {r.unitExists === false && r.selectedProjectId && (
                          <div className="mt-1 text-[10px] text-amber-800">
                            الوحدة غير موجودة — أنشئها من قائمة الوحدات أولًا.
                          </div>
                        )}
                      </Td>
                      <Td className="font-mono text-xs">{r.unit_number || '—'}</Td>
                      {previewColumns.map((c) => (
                        <Td key={c.key} className="max-w-[14rem] truncate">
                          {r.previewCells[c.key] ?? '—'}
                        </Td>
                      ))}
                      <Td className="max-w-[12rem] truncate">{r.projectRaw || '—'}</Td>
                      <Td>
                        <select
                          value={r.selectedProjectId}
                          onChange={(e) => setRowProject(idx, e.target.value)}
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

      {mode === 'done' && doneResult && (
        <div className="space-y-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <div className="font-semibold inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              تم الاستيراد بنجاح
            </div>
            <div className="mt-1 text-xs text-emerald-700">{doneResult.message}</div>
            {doneResult.extra && <div className="mt-2">{doneResult.extra}</div>}
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

// Placeholder — re-exported so consumers can build MappingField-typed
// preview cells without pulling shared-mapping directly.
export { MAPPING_FIELDS, FIELD_LABELS_AR }

// ---------------------------------------------------------------------------
// Internal presentation helpers
// ---------------------------------------------------------------------------

function computeStatus<T>(r: BaseParsedRow<T>) {
  if (!r.selectedProjectId) {
    if (r.matchedProjectId === null) {
      return {
        cls: 'bg-amber-50 text-amber-800 ring-amber-200',
        label: 'لا توجد مطابقة',
        Icon: AlertTriangle,
      }
    }
    return {
      cls: 'bg-slate-100 text-slate-600 ring-slate-200',
      label: 'تخطّي',
      Icon: X,
    }
  }
  if (r.unitExists === false) {
    return {
      cls: 'bg-amber-50 text-amber-800 ring-amber-200',
      label: 'وحدة غير موجودة',
      Icon: AlertTriangle,
    }
  }
  if (r.matchedProjectId === r.selectedProjectId) {
    return {
      cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
      label: 'مُطابَقة',
      Icon: CheckCircle2,
    }
  }
  return {
    cls: 'bg-teal-50 text-teal-700 ring-teal-200',
    label: 'تعديل يدوي',
    Icon: CheckCircle2,
  }
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  )
}

function Td({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 text-sm text-slate-700 align-top ${className ?? ''}`}>
      {children}
    </td>
  )
}
