'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Star, Trash2 } from 'lucide-react'
import { createTemplate, renameTemplate, setDefaultTemplate, deleteTemplate } from './actions'

export type TemplateRow = {
  id: string
  name: string
  is_default: boolean
  total_items: number
  active_items: number
}

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
function toArabicDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)] ?? d)
}

export function TemplatesIndex({
  templates,
  isOwner,
}: {
  templates: TemplateRow[]
  isOwner: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIsDefault, setNewIsDefault] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  function refresh() {
    startTransition(() => router.refresh())
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const name = newName.trim()
    if (!name) {
      setError('اسم القائمة مطلوب.')
      return
    }
    setBusy(true)
    const res = await createTemplate({ name, is_default: newIsDefault })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setNewName('')
    setNewIsDefault(false)
    setCreating(false)
    refresh()
  }

  async function onRename(id: string) {
    setError(null)
    const name = editingName.trim()
    if (!name) {
      setError('اسم القائمة مطلوب.')
      return
    }
    setBusy(true)
    const res = await renameTemplate({ id, name })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setEditingId(null)
    setEditingName('')
    refresh()
  }

  async function onSetDefault(id: string) {
    setError(null)
    setBusy(true)
    const res = await setDefaultTemplate({ id })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    refresh()
  }

  async function onDelete(id: string, name: string) {
    setError(null)
    if (!window.confirm(`هل أنت متأكد من حذف القائمة «${name}»؟`)) return
    setBusy(true)
    const res = await deleteTemplate({ id })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    refresh()
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {isOwner && (
        <div className="flex items-center justify-end">
          {!creating ? (
            <button
              type="button"
              onClick={() => { setCreating(true); setError(null) }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              قائمة جديدة
            </button>
          ) : (
            <form onSubmit={onCreate} className="flex items-center gap-2 flex-wrap bg-white border border-teal-200 rounded-lg p-2 shadow-sm">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="اسم القائمة الجديدة"
                disabled={busy}
                className={inputCls + ' min-w-[14rem]'}
                maxLength={100}
              />
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={newIsDefault}
                  onChange={(e) => setNewIsDefault(e.target.checked)}
                  disabled={busy}
                  className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                افتراضية
              </label>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
              >
                {busy ? 'جارٍ الحفظ…' : 'حفظ'}
              </button>
              <button
                type="button"
                onClick={() => { setCreating(false); setNewName(''); setNewIsDefault(false); setError(null) }}
                disabled={busy}
                className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
              >
                إلغاء
              </button>
            </form>
          )}
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {templates.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            لا توجد قوائم بعد. ابدأ بإنشاء قائمة جديدة.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {templates.map((t) => {
              const isEditing = editingId === t.id
              return (
                <li key={t.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            disabled={busy}
                            className={inputCls + ' min-w-[14rem]'}
                            maxLength={100}
                          />
                          <button
                            type="button"
                            onClick={() => onRename(t.id)}
                            disabled={busy}
                            className="inline-flex items-center px-3 py-1 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
                          >
                            {busy ? '…' : 'حفظ'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEditingId(null); setEditingName('') }}
                            disabled={busy}
                            className="inline-flex items-center px-3 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
                          >
                            إلغاء
                          </button>
                        </div>
                      ) : (
                        <Link
                          href={`/app/disbursements/admin/checklist-templates/${t.id}`}
                          className="inline-flex items-center gap-2 group"
                        >
                          <span className="text-sm font-semibold text-slate-900 group-hover:text-teal-700 group-hover:underline">
                            {t.name}
                          </span>
                          {t.is_default && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ring-inset bg-amber-50 text-amber-800 ring-amber-200">
                              <Star className="w-3 h-3 ms-0.5 -mt-px" aria-hidden="true" />
                              افتراضية
                            </span>
                          )}
                        </Link>
                      )}
                      <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                        {toArabicDigits(t.active_items)} بند نشط
                        {t.total_items !== t.active_items && ` · ${toArabicDigits(t.total_items)} إجمالي`}
                      </div>
                    </div>
                    {isOwner && !isEditing && (
                      <div className="shrink-0 flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => { setEditingId(t.id); setEditingName(t.name); setError(null) }}
                          disabled={busy}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
                          title="إعادة تسمية"
                        >
                          <Pencil className="w-3 h-3" aria-hidden="true" />
                          تسمية
                        </button>
                        {!t.is_default && (
                          <button
                            type="button"
                            onClick={() => onSetDefault(t.id)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-amber-200 bg-amber-50 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition disabled:opacity-50"
                            title="تعيين كافتراضية"
                          >
                            <Star className="w-3 h-3" aria-hidden="true" />
                            افتراضية
                          </button>
                        )}
                        {!t.is_default && (
                          <button
                            type="button"
                            onClick={() => onDelete(t.id, t.name)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-red-200 bg-white text-xs font-semibold text-red-700 hover:bg-red-50 transition disabled:opacity-50"
                            title="حذف"
                          >
                            <Trash2 className="w-3 h-3" aria-hidden="true" />
                            حذف
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
