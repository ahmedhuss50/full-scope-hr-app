'use client'

/**
 * VendorCategoriesEditor — inline CRUD for تصنيفات الموردين ومقدمي الخدمات.
 *
 * Owner-only. One row per category with inline rename + delete. New
 * category adds via a small form at the top. Deletion is guarded on the
 * server: if any vendor row still references the category (via
 * dsb_vendors.service_category text match), the server refuses and we
 * surface the message.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Check, X, Pencil } from 'lucide-react'
import {
  createVendorCategory,
  renameVendorCategory,
  deleteVendorCategory,
} from './actions'

export type VendorCategory = { id: string; name_ar: string }

export function VendorCategoriesEditor({
  initial,
}: {
  initial: VendorCategory[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [rows, setRows] = useState<VendorCategory[]>(initial)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  async function onAdd() {
    setErr(null)
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    const res = await createVendorCategory({ name_ar: name })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    setRows((prev) => [...prev, { id: res.id, name_ar: name }].sort((a, b) => a.name_ar.localeCompare(b.name_ar)))
    setNewName('')
    startTransition(() => router.refresh())
  }

  async function onSaveRename(id: string) {
    setErr(null)
    const name = editingName.trim()
    if (!name) { setEditingId(null); return }
    setBusy(true)
    const res = await renameVendorCategory({ id, name_ar: name })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    setRows((prev) =>
      prev
        .map((r) => (r.id === id ? { ...r, name_ar: name } : r))
        .sort((a, b) => a.name_ar.localeCompare(b.name_ar)),
    )
    setEditingId(null)
    startTransition(() => router.refresh())
  }

  async function onDelete(id: string) {
    setErr(null)
    if (!confirm('حذف هذا التصنيف؟')) return
    setBusy(true)
    const res = await deleteVendorCategory({ id })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    setRows((prev) => prev.filter((r) => r.id !== id))
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
          placeholder="اسم التصنيف الجديد (مثال: كهرباء، سباكة، مقاول رئيسي)"
          maxLength={80}
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
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 italic">
          لم يُضَف أي تصنيف بعد.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-slate-50/50">
              {editingId === r.id ? (
                <>
                  <input
                    autoFocus
                    className={inputCls + ' flex-1'}
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void onSaveRename(r.id) }
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    disabled={busy}
                    maxLength={80}
                  />
                  <button
                    type="button"
                    onClick={() => onSaveRename(r.id)}
                    disabled={busy}
                    title="حفظ"
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md text-emerald-700 hover:bg-emerald-50"
                  >
                    <Check className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    disabled={busy}
                    title="إلغاء"
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:bg-slate-100"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-slate-800 truncate">{r.name_ar}</span>
                  <button
                    type="button"
                    onClick={() => { setEditingId(r.id); setEditingName(r.name_ar) }}
                    title="تعديل"
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-600 hover:bg-slate-100"
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(r.id)}
                    title="حذف"
                    className="inline-flex items-center justify-center w-8 h-8 rounded-md text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
