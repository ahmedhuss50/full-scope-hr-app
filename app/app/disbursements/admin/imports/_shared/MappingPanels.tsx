'use client'

import { useState } from 'react'
import { CheckCircle2, Wand2, X } from 'lucide-react'
import {
  colIndexToLetter,
  FIELD_LABELS_AR,
  MAPPING_FIELDS,
  toStr,
  type ColumnMap,
  type MappingField,
  type SheetPack,
} from './shared-mapping'

// -----------------------------------------------------------------------------
// MappingSummary — compact per-sheet strip showing which fields the AI mapped
// and to which Excel column, plus the cumulative cost. A "تعديل يدوي" button
// drops back into manual-mapping mode.
//
// The `relevantFields` prop lets each importer render only the fields it
// actually cares about (specs, buyers, or contracts) so the strip doesn't
// scream about missing columns the importer will ignore anyway.
// -----------------------------------------------------------------------------

export function MappingSummary({
  packs,
  totalAiCostUsd,
  onRemap,
  relevantFields = MAPPING_FIELDS,
}: {
  packs: SheetPack[]
  totalAiCostUsd: number
  onRemap: () => void
  relevantFields?: readonly MappingField[]
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
                {relevantFields.map((f) => {
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

// -----------------------------------------------------------------------------
// ManualMappingPanel — full fallback UI. For each sheet the owner picks the
// header row and a column index for every field via dropdowns. Only fields in
// `relevantFields` are shown, so the panel for a focused importer stays short.
// -----------------------------------------------------------------------------

export function ManualMappingPanel({
  packs,
  onCancel,
  onDone,
  relevantFields = MAPPING_FIELDS,
}: {
  packs: SheetPack[]
  onCancel: () => void
  onDone: (updated: SheetPack[]) => void
  relevantFields?: readonly MappingField[]
}) {
  // Local editable copy of each pack's mapping. Seed from AI when available;
  // otherwise start at header_row_index=0 with all-null column indices.
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
        const colOptions = headerRow.map((cell, i) => {
          const label = toStr(cell) || '(فارغ)'
          return { i, label: `${colIndexToLetter(i)} · ${label}` }
        })
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
              {relevantFields.map((f) => {
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
