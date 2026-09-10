'use client'

/**
 * LabelListEditor — inline rename of the fixed-enum lists + add/delete of
 * tenant-custom entries (migration 075).
 *
 * • Fixed enum codes (buyer_collection, construction, …) can be renamed but
 *   never removed — the underlying code is baked into the DB / importer /
 *   AI prompt and can't disappear.
 * • Custom entries (code starts with `custom_`) can be renamed via the
 *   same input AND deleted with a trash button — they live entirely in
 *   tenants.<column>_labels JSONB.
 * • "+ إضافة" opens an inline input at the bottom for creating a new
 *   custom entry.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Save, RotateCcw, Trash2, Plus } from 'lucide-react'
import {
  updateLabelOverrides,
  createCustomLabel,
  deleteCustomLabel,
  type LabelKind,
} from './actions'

export type LabelRow = {
  code: string
  defaultLabel: string
  description?: string
  toneCls?: string   // for the deposit-category color chips
  isCustom?: boolean // true → allow delete; hide "reset to default"
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

  // Add-row state
  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [creating, setCreating] = useState(false)

  const dirty = rows.some((r) => {
    const current = values[r.code] ?? r.defaultLabel
    const saved   = overrides?.[r.code] ?? r.defaultLabel
    return current !== saved
  })

  async function onSave() {
    setError(null); setOk(false)
    setSaving(true)
    // Build the payload: fixed rows only when the value differs from the
    // shipped default; custom rows are always included (their JSONB entry
    // IS the definition — dropping it would delete the row entirely).
    const payload: Record<string, string> = {}
    for (const r of rows) {
      const v = (values[r.code] ?? '').trim()
      if (!v) continue
      if (r.isCustom) {
        payload[r.code] = v
      } else if (v !== r.defaultLabel) {
        payload[r.code] = v
      }
    }
    const res = await updateLabelOverrides({ kind, labels: payload })
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setOk(true)
    startTransition(() => router.refresh())
    setTimeout(() => setOk(false), 2500)
  }

  async function onAdd() {
    setError(null); setOk(false)
    const label = newLabel.trim()
    if (!label) { setError('الاسم مطلوب.'); return }
    setCreating(true)
    const res = await createCustomLabel({ kind, label_ar: label })
    setCreating(false)
    if (!res.ok) { setError(res.error); return }
    setNewLabel('')
    setAdding(false)
    setOk(true)
    startTransition(() => router.refresh())
    setTimeout(() => setOk(false), 2500)
  }

  async function onDelete(code: string) {
    if (!code.startsWith('custom_')) return
    if (!confirm('حذف هذا التصنيف؟ لا يمكن التراجع.')) return
    setError(null); setOk(false)
    const res = await deleteCustomLabel({ kind, code })
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
          const isOverride = !r.isCustom && value !== r.defaultLabel
          return (
            <div key={r.code} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
              <div className="sm:col-span-4">
                {r.toneCls ? (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ring-1 ring-inset ${r.toneCls}`}>
                    {value}
                    {r.isCustom && <span className="mr-1 text-[9px] opacity-70">مضاف</span>}
                  </span>
                ) : (
                  <span className="text-sm text-slate-800">
                    {value}
                    {r.isCustom && <span className="mr-1 text-[10px] text-purple-700 font-semibold">(مضاف)</span>}
                  </span>
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
              <div className="sm:col-span-1 flex items-center justify-end gap-1">
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
                {r.isCustom && (
                  <button
                    type="button"
                    onClick={() => onDelete(r.code)}
                    disabled={saving}
                    title="حذف التصنيف"
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Inline add-new row */}
      {adding ? (
        <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3 flex items-center gap-2">
          <input
            className={inputCls}
            placeholder="اسم التصنيف الجديد…"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            disabled={creating}
            maxLength={120}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') void onAdd() }}
          />
          <button
            type="button"
            onClick={onAdd}
            disabled={creating || !newLabel.trim()}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:opacity-50"
          >
            {creating ? 'جارٍ…' : 'إضافة'}
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setNewLabel(''); setError(null) }}
            disabled={creating}
            className="inline-flex items-center px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            إلغاء
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setAdding(true); setError(null) }}
          className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> إضافة تصنيف جديد
        </button>
      )}

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
