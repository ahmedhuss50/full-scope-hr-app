'use client'

/**
 * LabelListEditor — compact add/edit/delete UI for the deposit-category
 * and disbursement-type lists, matching VendorCategoriesEditor's shape.
 *
 * Row rules:
 *  - Fixed enum row (buyer_collection, construction, …): rename inline;
 *    NO delete (the code is baked into DB / importer / AI prompt).
 *  - Custom row (`custom_*`): rename inline AND delete.
 *
 * Empty rename on a fixed row reverts to the shipped default. Empty rename
 * on a custom row is rejected — use the trash button instead.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Check, X, Pencil, RotateCcw } from 'lucide-react'
import {
  createCustomLabel,
  deleteCustomLabel,
  renameLabel,
  type LabelKind,
} from './actions'

export type LabelRow = {
  code: string
  defaultLabel: string
  description?: string
  toneCls?: string
  isCustom?: boolean
}

export function LabelListEditor({
  kind,
  rows: initialRows,
  overrides,
}: {
  kind: LabelKind
  rows: LabelRow[]
  overrides: Record<string, string> | null | undefined
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  // Snapshot of the currently-persisted label for every row (default OR
  // override). Used both to render and to figure out whether a rename
  // actually differs from what's saved.
  const [labels, setLabels] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const r of initialRows) init[r.code] = overrides?.[r.code] ?? r.defaultLabel
    return init
  })
  const [rows, setRows] = useState<LabelRow[]>(initialRows)

  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')

  async function onAdd() {
    setErr(null)
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    const res = await createCustomLabel({ kind, label_ar: name })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    setRows((prev) => [...prev, { code: res.code, defaultLabel: name, isCustom: true }])
    setLabels((prev) => ({ ...prev, [res.code]: name }))
    setNewName('')
    startTransition(() => router.refresh())
  }

  async function onSaveRename(code: string) {
    setErr(null)
    const value = editingValue.trim()
    const row = rows.find((r) => r.code === code)
    if (!row) return
    // No-op if unchanged from current
    if (value === (labels[code] ?? '')) { setEditingCode(null); return }
    setBusy(true)
    const res = await renameLabel({ kind, code, label_ar: value })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    // Empty label on a fixed row → revert to the row's default
    const nextLabel = !value && !row.isCustom ? row.defaultLabel : value
    setLabels((prev) => ({ ...prev, [code]: nextLabel }))
    setEditingCode(null)
    startTransition(() => router.refresh())
  }

  async function onDelete(code: string) {
    if (!code.startsWith('custom_')) return
    if (!confirm('حذف هذا التصنيف؟ لا يمكن التراجع.')) return
    setErr(null); setBusy(true)
    const res = await deleteCustomLabel({ kind, code })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    setRows((prev) => prev.filter((r) => r.code !== code))
    setLabels((prev) => {
      const { [code]: _drop, ...rest } = prev
      return rest
    })
    startTransition(() => router.refresh())
  }

  async function onResetToDefault(code: string, defaultLabel: string) {
    setErr(null); setBusy(true)
    const res = await renameLabel({ kind, code, label_ar: '' })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    setLabels((prev) => ({ ...prev, [code]: defaultLabel }))
    startTransition(() => router.refresh())
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

  return (
    <div className="space-y-3">
      {/* Add row */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          className={inputCls + ' flex-1'}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void onAdd() } }}
          disabled={busy}
          placeholder="اسم التصنيف الجديد"
          maxLength={120}
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={busy || !newName.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          إضافة
        </button>
      </div>
      {err && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {/* List */}
      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
        {rows.map((r) => {
          const value = labels[r.code] ?? r.defaultLabel
          const isRenamed = !r.isCustom && value !== r.defaultLabel
          const isEditing = editingCode === r.code
          return (
            <li key={r.code} className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-slate-50/50">
              {isEditing ? (
                <>
                  <input
                    autoFocus
                    className={inputCls + ' flex-1'}
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void onSaveRename(r.code) }
                      if (e.key === 'Escape') setEditingCode(null)
                    }}
                    disabled={busy}
                    maxLength={120}
                  />
                  <button
                    type="button"
                    onClick={() => onSaveRename(r.code)}
                    disabled={busy}
                    title="حفظ"
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md text-emerald-700 hover:bg-emerald-50"
                  >
                    <Check className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingCode(null)}
                    disabled={busy}
                    title="إلغاء"
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:bg-slate-100"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </>
              ) : (
                <>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    {r.toneCls ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ring-1 ring-inset ${r.toneCls}`}>
                        {value}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-800 truncate">{value}</span>
                    )}
                    {r.isCustom && (
                      <span className="text-[10px] font-semibold text-purple-700 bg-purple-50 ring-1 ring-inset ring-purple-200 rounded-full px-1.5 py-0.5">
                        مضاف
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-slate-400 truncate" dir="ltr">{r.code}</span>
                  </div>
                  {isRenamed && (
                    <button
                      type="button"
                      onClick={() => onResetToDefault(r.code, r.defaultLabel)}
                      disabled={busy}
                      title={`استرجاع الافتراضي (${r.defaultLabel})`}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:bg-slate-100"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setEditingCode(r.code); setEditingValue(value) }}
                    title="تعديل"
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-600 hover:bg-slate-100"
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  {r.isCustom ? (
                    <button
                      type="button"
                      onClick={() => onDelete(r.code)}
                      title="حذف"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  ) : (
                    // Reserve the space so rows align visually.
                    <span className="w-8 h-8 inline-block" aria-hidden="true" />
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
