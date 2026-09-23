'use client'

/**
 * MainTypesEditor — owner-only CRUD for أنواع الصرف الرئيسية (main types)
 * plus the sub → main assignment table.
 *
 * Left card: the main-type list (add, rename, delete, restore hidden).
 * Right card: sub-type list with a dropdown per row assigning that sub-type
 * to one of the main types. Both feed the CPA report generator's Sheet 2
 * «البند» + Sheet 3 debit rows.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, Plus, Pencil, Trash2, X, RotateCcw } from 'lucide-react'
import {
  addMainDisbursementType,
  renameMainDisbursementType,
  deleteMainDisbursementType,
  restoreMainDisbursementType,
  assignSubToMainDisbursement,
} from './actions'

export type MainTypeRow = {
  code: string
  label: string
  isCustom: boolean   // custom_main_* codes; can be hard-deleted vs hidden
  isHidden: boolean   // shipped default that owner soft-deleted (still in DB)
}

export type SubTypeRow = {
  code: string
  label: string
  currentMain: string | null   // main-type code currently assigned, or null
}

export function MainTypesEditor({
  mainTypes,
  subTypes,
  hiddenMainTypes,
}: {
  mainTypes: MainTypeRow[]      // visible main types
  subTypes: SubTypeRow[]         // visible sub-types with their current main mapping
  hiddenMainTypes: MainTypeRow[] // deleted shipped defaults (can be restored)
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [savedTick, setSavedTick] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)

  // Add form
  const [newLabel, setNewLabel] = useState('')

  // Rename in-place
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')

  function tick(key: string) {
    setSavedTick((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }))
  }

  async function onAdd() {
    const label = newLabel.trim()
    if (!label) { setError('اسم النوع الرئيسي مطلوب.'); return }
    setError(null)
    setBusyKey('__add')
    const res = await addMainDisbursementType({ label_ar: label })
    setBusyKey(null)
    if (!res.ok) { setError(res.error); return }
    setNewLabel('')
    tick('__add')
    startTransition(() => router.refresh())
  }

  async function onRename(code: string) {
    const label = editingLabel.trim()
    if (!label) { setError('الاسم مطلوب.'); return }
    setError(null)
    setBusyKey(code)
    const res = await renameMainDisbursementType({ code, label_ar: label })
    setBusyKey(null)
    if (!res.ok) { setError(res.error); return }
    setEditingCode(null)
    setEditingLabel('')
    tick(code)
    startTransition(() => router.refresh())
  }

  async function onDelete(code: string, label: string) {
    if (!confirm(`حذف النوع الرئيسي «${label}»؟\nكل السندات المصنفة تحته ستُعاد تلقائيًا إلى «أخرى».`)) return
    setError(null)
    setBusyKey(code)
    const res = await deleteMainDisbursementType({ code })
    setBusyKey(null)
    if (!res.ok) { setError(res.error); return }
    tick(code)
    startTransition(() => router.refresh())
  }

  async function onRestore(code: string) {
    setError(null)
    setBusyKey(code)
    const res = await restoreMainDisbursementType({ code })
    setBusyKey(null)
    if (!res.ok) { setError(res.error); return }
    tick(code)
    startTransition(() => router.refresh())
  }

  async function onAssign(subCode: string, mainCode: string) {
    setError(null)
    const key = `assign:${subCode}`
    setBusyKey(key)
    const res = await assignSubToMainDisbursement({
      sub_code: subCode,
      main_code: mainCode || null,
    })
    setBusyKey(null)
    if (!res.ok) { setError(res.error); return }
    tick(key)
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Main types CRUD */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-3 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd() } }}
              placeholder="اسم النوع الرئيسي الجديد"
              disabled={busyKey === '__add'}
              className="flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <button
              type="button"
              onClick={onAdd}
              disabled={busyKey === '__add' || !newLabel.trim()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:opacity-50"
            >
              {busyKey === '__add' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              إضافة
            </button>
          </div>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {mainTypes.map((row) => (
              <tr key={row.code} className="hover:bg-slate-50">
                <td className="px-3 py-2 text-right">
                  {editingCode === row.code ? (
                    <input
                      value={editingLabel}
                      onChange={(e) => setEditingLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); onRename(row.code) }
                        if (e.key === 'Escape') { setEditingCode(null); setEditingLabel('') }
                      }}
                      autoFocus
                      disabled={busyKey === row.code}
                      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
                    />
                  ) : (
                    <span className="font-semibold text-slate-900">{row.label}</span>
                  )}
                  <span className="font-mono text-[10px] text-slate-400 mr-2">{row.code}</span>
                  {row.isCustom && (
                    <span className="inline-flex items-center rounded-md bg-purple-50 text-purple-800 ring-1 ring-inset ring-purple-200 px-1.5 py-0.5 text-[10px] font-bold mr-1">مضاف</span>
                  )}
                </td>
                <td className="px-3 py-2 w-32 text-left">
                  <div className="inline-flex items-center gap-1">
                    {busyKey === row.code && <Loader2 className="w-3 h-3 animate-spin text-teal-600" />}
                    {busyKey !== row.code && (savedTick[row.code] ?? 0) > 0 && <Check className="w-3 h-3 text-emerald-600" />}
                    {editingCode === row.code ? (
                      <>
                        <button type="button" onClick={() => onRename(row.code)} title="حفظ"
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-teal-600 text-white hover:bg-teal-700">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => { setEditingCode(null); setEditingLabel('') }} title="إلغاء"
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => { setEditingCode(row.code); setEditingLabel(row.label) }} title="تعديل"
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-teal-700 hover:bg-teal-50">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {row.code !== 'main_other' && (
                          <button type="button" onClick={() => onDelete(row.code, row.label)} title="حذف"
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-red-700 hover:bg-red-50">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {hiddenMainTypes.map((row) => (
              <tr key={row.code} className="bg-amber-50/40">
                <td className="px-3 py-2 text-right text-slate-400 line-through">
                  {row.label}
                  <span className="font-mono text-[10px] text-slate-400 mr-2">{row.code}</span>
                  <span className="inline-flex items-center rounded-md bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200 px-1.5 py-0.5 text-[10px] font-bold mr-1">محذوف</span>
                </td>
                <td className="px-3 py-2 w-32 text-left">
                  <button type="button" onClick={() => onRestore(row.code)} title="استعادة"
                    disabled={busyKey === row.code}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-amber-300 bg-white text-xs font-semibold text-amber-800 hover:bg-amber-50">
                    {busyKey === row.code ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                    استعادة
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sub → Main assignment table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-3 border-b border-slate-200 bg-slate-50">
          <h3 className="text-sm font-bold text-slate-800">ربط الأنواع الفرعية بالنوع الرئيسي</h3>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
            كل نوع فرعي (مثل «سداد تمويل بنكي») ينتمي إلى نوع رئيسي واحد.
            النوع الرئيسي هو ما يظهر في عمود «البند» بورقة (2) وثائق الصرف وفي أسطر «العمليات المالية»
            بورقة (3) من نموذج المحاسب القانوني.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs">
            <tr className="text-right">
              <th className="px-3 py-2 font-semibold text-slate-500">النوع الفرعي</th>
              <th className="px-3 py-2 font-semibold text-slate-500 w-64">النوع الرئيسي المرتبط به</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {subTypes.map((row) => {
              const key = `assign:${row.code}`
              return (
                <tr key={row.code} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-900">
                    {row.label}
                    <span className="font-mono text-[10px] text-slate-400 mr-2">{row.code}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={row.currentMain ?? ''}
                        onChange={(e) => onAssign(row.code, e.target.value)}
                        disabled={busyKey === key}
                        className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
                      >
                        {mainTypes.map((mt) => (
                          <option key={mt.code} value={mt.code}>{mt.label}</option>
                        ))}
                      </select>
                      {busyKey === key && <Loader2 className="w-3 h-3 animate-spin text-teal-600" />}
                      {busyKey !== key && (savedTick[key] ?? 0) > 0 && <Check className="w-3 h-3 text-emerald-600" />}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  )
}
