'use client'

/**
 * LabelListEditor — inline rename of the fixed-enum lists.
 *
 * Underlying codes (buyer_collection, construction, …) stay hardcoded in
 * the DB, importer, and AI prompt. This editor lets the owner change the
 * ARABIC LABELS that appear on screen (payments tabs, category pickers,
 * generated reports). Overrides land in tenants.deposit_category_labels
 * or tenants.disbursement_type_labels (migration 070).
 *
 * Save button turns on when any label differs from the last-saved value.
 * "استرجاع الافتراضي" per row clears the override so the tenant re-inherits
 * the code-shipped default.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Save, RotateCcw } from 'lucide-react'
import { updateLabelOverrides, type LabelKind } from './actions'

export type LabelRow = {
  code: string
  defaultLabel: string
  description?: string
  toneCls?: string   // for the deposit-category color chips
}

export function LabelListEditor({
  kind,
  rows,
  overrides,
}: {
  kind: LabelKind
  rows: LabelRow[]
  overrides: Record<string, string> | null | undefined
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const r of rows) init[r.code] = overrides?.[r.code] ?? r.defaultLabel
    return init
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const dirty = rows.some((r) => {
    const current = values[r.code] ?? r.defaultLabel
    const saved   = overrides?.[r.code] ?? r.defaultLabel
    return current !== saved
  })

  async function onSave() {
    setError(null); setOk(false)
    setSaving(true)
    // Build the payload: only include entries that differ from the default.
    const payload: Record<string, string> = {}
    for (const r of rows) {
      const v = (values[r.code] ?? '').trim()
      if (v && v !== r.defaultLabel) payload[r.code] = v
    }
    const res = await updateLabelOverrides({ kind, labels: payload })
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setOk(true)
    startTransition(() => router.refresh())
    setTimeout(() => setOk(false), 2500)
  }

  function resetRow(code: string, defaultLabel: string) {
    setValues((prev) => ({ ...prev, [code]: defaultLabel }))
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rows.map((r) => {
          const value = values[r.code] ?? r.defaultLabel
          const isOverride = value !== r.defaultLabel
          return (
            <div key={r.code} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
              <div className="sm:col-span-4">
                {r.toneCls ? (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ring-1 ring-inset ${r.toneCls}`}>
                    {value}
                  </span>
                ) : (
                  <span className="text-sm text-slate-800">{value}</span>
                )}
                <div className="text-[10px] font-mono text-slate-400 mt-1" dir="ltr">{r.code}</div>
                {r.description && (
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{r.description}</div>
                )}
              </div>
              <div className="sm:col-span-7">
                <input
                  className={inputCls}
                  value={value}
                  onChange={(e) => setValues((prev) => ({ ...prev, [r.code]: e.target.value }))}
                  disabled={saving}
                  maxLength={120}
                />
              </div>
              <div className="sm:col-span-1 flex items-center justify-end">
                {isOverride && (
                  <button
                    type="button"
                    onClick={() => resetRow(r.code, r.defaultLabel)}
                    disabled={saving}
                    title="استرجاع الافتراضي"
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:bg-slate-100"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {ok && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          تم الحفظ. تنعكس الأسماء الجديدة على كل الشاشات فور إعادة تحميلها.
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" aria-hidden="true" />
          {saving ? 'جارٍ الحفظ…' : 'حفظ الأسماء'}
        </button>
      </div>
    </div>
  )
}
