'use client'

/**
 * DisbursementTypesUnified — one card that manages BOTH main and sub types.
 *
 * Top block: chips for each main type (add, rename inline, delete/restore).
 * Bottom block: table of sub-types, each row shows:
 *   [name (inline-editable)]  [main-type dropdown]  [restore]  [delete]
 * Plus an add-new-sub-type row at the top of the table.
 *
 * Replaces the previous split of "أنواع الصرف الفرعية" (LabelListEditor) +
 * "أنواع الصرف الرئيسية" (this component's earlier two-block layout).
 * Everything you need for the two-tier hierarchy in one place.
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
  createCustomLabel,
  renameLabel,
  deleteCustomLabel,
  restoreDefaultLabel,
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
  isCustom: boolean          // custom_* sub-code
  isHidden: boolean          // shipped default that was hidden
  currentMain: string | null // main-type code currently assigned
}

export function MainTypesEditor({
  mainTypes,
  hiddenMainTypes,
  subTypes,
  hiddenSubTypes,
}: {
  mainTypes: MainTypeRow[]         // visible main types
  hiddenMainTypes: MainTypeRow[]   // hidden shipped-default main types
  subTypes: SubTypeRow[]            // visible sub-types
  hiddenSubTypes: SubTypeRow[]      // hidden shipped-default sub-types
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [savedTick, setSavedTick] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)

  // Add-new inputs
  const [newMainLabel, setNewMainLabel] = useState('')
  const [newSubLabel, setNewSubLabel] = useState('')

  // Inline rename state
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')

  function tick(key: string) {
    setSavedTick((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }))
  }

  // ---- Main-type actions -------------------------------------------------

  async function onAddMain() {
    const label = newMainLabel.trim()
    if (!label) { setError('اسم النوع الرئيسي مطلوب.'); return }
    setError(null); setBusyKey('__addMain')
    const res = await addMainDisbursementType({ label_ar: label })
    setBusyKey(null)
    if (!res.ok) { setError(res.error); return }
    setNewMainLabel('')
    tick('__addMain')
    startTransition(() => router.refresh())
  }

  async function onRenameMain(code: string) {
    const label = editingLabel.trim()
    if (!label) { setError('الاسم مطلوب.'); return }
    setError(null); setBusyKey(`main:${code}`)
    const res = await renameMainDisbursementType({ code, label_ar: label })
    setBusyKey(null)
    if (!res.ok) { setError(res.error); return }
    setEditingCode(null); setEditingLabel('')
    tick(`main:${code}`)
    startTransition(() => router.refresh())
  }

  async function onDeleteMain(code: string, label: string) {
    if (!confirm(`حذف النوع الرئيسي «${label}»؟\nكل السندات المصنفة تحته ستُعاد تلقائيًا إلى «أخرى».`)) return
    setError(null); setBusyKey(`main:${code}`)
    const res = await deleteMainDisbursementType({ code })
    setBusyKey(null)
    if (!res.ok) { setError(res.error); return }
    tick(`main:${code}`)
    startTransition(() => router.refresh())
  }

  async function onRestoreMain(code: string) {
    setError(null); setBusyKey(`main:${code}`)
    const res = await restoreMainDisbursementType({ code })
    setBusyKey(null)
    if (!res.ok) { setError(res.error); return }
    tick(`main:${code}`)
    startTransition(() => router.refresh())
  }

  // ---- Sub-type actions --------------------------------------------------

  async function onAddSub() {
    const label = newSubLabel.trim()
    if (!label) { setError('اسم النوع الفرعي مطلوب.'); return }
    setError(null); setBusyKey('__addSub')
    const res = await createCustomLabel({ kind: 'disbursement', label_ar: label })
    setBusyKey(null)
    if (!res.ok) { setError(res.error); return }
    setNewSubLabel('')
    tick('__addSub')
    startTransition(() => router.refresh())
  }

  async function onRenameSub(code: string) {
    const label = editingLabel.trim()
    if (!label) { setError('الاسم مطلوب.'); return }
    setError(null); setBusyKey(`sub:${code}`)
    const res = await renameLabel({ kind: 'disbursement', code, label_ar: label })
    setBusyKey(null)
    if (!res.ok) { setError(res.error); return }
    setEditingCode(null); setEditingLabel('')
    tick(`sub:${code}`)
    startTransition(() => router.refresh())
  }

  async function onDeleteSub(code: string, label: string, isCustom: boolean) {
    const msg = isCustom
      ? `حذف النوع الفرعي «${label}»؟`
      : `إخفاء النوع الفرعي «${label}» من القوائم؟ يمكن استعادته لاحقًا.`
    if (!confirm(msg)) return
    setError(null); setBusyKey(`sub:${code}`)
    const res = await deleteCustomLabel({ kind: 'disbursement', code })
    setBusyKey(null)
    if (!res.ok) { setError(res.error); return }
    tick(`sub:${code}`)
    startTransition(() => router.refresh())
  }

  async function onRestoreSub(code: string) {
    setError(null); setBusyKey(`sub:${code}`)
    const res = await restoreDefaultLabel({ kind: 'disbursement', code })
    setBusyKey(null)
    if (!res.ok) { setError(res.error); return }
    tick(`sub:${code}`)
    startTransition(() => router.refresh())
  }

  async function onAssignMain(subCode: string, mainCode: string) {
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
    <div className="space-y-6" dir="rtl">
      {/* ============================================================ */}
      {/*   MAIN TYPES — compact chip row                              */}
      {/* ============================================================ */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-bold text-slate-800">الأنواع الرئيسية</h3>
          <span className="text-[11px] text-slate-500">تظهر في عمود «البند» بتقرير المحاسب القانوني</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {mainTypes.map((row) => {
            const key = `main:${row.code}`
            const isEditing = editingCode === row.code
            const busy = busyKey === key
            const saved = (savedTick[key] ?? 0) > 0 && !busy
            return (
              <div key={row.code} className={`inline-flex items-center gap-1 rounded-full ring-1 pl-1 pr-3 py-1 text-xs font-semibold transition ${
                row.isCustom
                  ? 'bg-purple-50 text-purple-800 ring-purple-200'
                  : 'bg-teal-50 text-teal-800 ring-teal-200'
              }`}>
                {isEditing ? (
                  <input
                    value={editingLabel}
                    onChange={(e) => setEditingLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); onRenameMain(row.code) }
                      if (e.key === 'Escape') { setEditingCode(null); setEditingLabel('') }
                    }}
                    autoFocus
                    disabled={busy}
                    className="w-32 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-900"
                  />
                ) : (
                  <span>{row.label}</span>
                )}
                {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                {saved && <Check className="w-3 h-3 text-emerald-600" />}
                {isEditing ? (
                  <>
                    <button type="button" onClick={() => onRenameMain(row.code)} title="حفظ"
                      className="w-5 h-5 rounded-full bg-white/70 hover:bg-white inline-flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </button>
                    <button type="button" onClick={() => { setEditingCode(null); setEditingLabel('') }} title="إلغاء"
                      className="w-5 h-5 rounded-full bg-white/70 hover:bg-white inline-flex items-center justify-center">
                      <X className="w-3 h-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => { setEditingCode(row.code); setEditingLabel(row.label) }} title="تعديل"
                      className="w-5 h-5 rounded-full bg-white/70 hover:bg-white inline-flex items-center justify-center">
                      <Pencil className="w-3 h-3" />
                    </button>
                    {row.code !== 'main_other' && (
                      <button type="button" onClick={() => onDeleteMain(row.code, row.label)} title="حذف"
                        className="w-5 h-5 rounded-full bg-white/70 hover:bg-red-50 hover:text-red-700 inline-flex items-center justify-center">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </>
                )}
              </div>
            )
          })}
          {hiddenMainTypes.map((row) => (
            <button key={row.code} type="button" onClick={() => onRestoreMain(row.code)}
              disabled={busyKey === `main:${row.code}`}
              className="inline-flex items-center gap-1 rounded-full ring-1 ring-amber-200 bg-amber-50 pl-1 pr-3 py-1 text-xs font-semibold text-amber-800 line-through hover:bg-amber-100">
              <RotateCcw className="w-3 h-3" />
              {row.label}
            </button>
          ))}
          {/* Add main-type input */}
          <div className="inline-flex items-center gap-1">
            <input
              type="text"
              value={newMainLabel}
              onChange={(e) => setNewMainLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddMain() } }}
              placeholder="+ نوع رئيسي جديد"
              disabled={busyKey === '__addMain'}
              className="w-44 rounded-full border border-dashed border-slate-300 bg-white px-3 py-1 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            />
            {newMainLabel.trim() && (
              <button type="button" onClick={onAddMain} disabled={busyKey === '__addMain'}
                className="w-6 h-6 rounded-full bg-teal-600 text-white hover:bg-teal-700 inline-flex items-center justify-center">
                {busyKey === '__addMain' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/*   SUB-TYPES — table with name / main dropdown / actions       */}
      {/* ============================================================ */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-3 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-bold text-slate-800">الأنواع الفرعية (نوع الصرف)</h3>
            <span className="text-[11px] text-slate-500">القائمة التي يستخدمها الذكاء الاصطناعي لتصنيف السندات تلقائيًا</span>
          </div>
          {/* Add-new-sub-type row */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={newSubLabel}
              onChange={(e) => setNewSubLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddSub() } }}
              placeholder="اسم النوع الفرعي الجديد"
              disabled={busyKey === '__addSub'}
              className="flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <button
              type="button"
              onClick={onAddSub}
              disabled={busyKey === '__addSub' || !newSubLabel.trim()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:opacity-50"
            >
              {busyKey === '__addSub' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              إضافة نوع فرعي
            </button>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs">
            <tr className="text-right">
              <th className="px-3 py-2 font-semibold text-slate-500">النوع الفرعي</th>
              <th className="px-3 py-2 font-semibold text-slate-500 w-56">النوع الرئيسي</th>
              <th className="px-3 py-2 font-semibold text-slate-500 w-28 text-left">إجراء</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {subTypes.map((row) => {
              const subKey = `sub:${row.code}`
              const assignKey = `assign:${row.code}`
              const isEditing = editingCode === row.code
              const busy = busyKey === subKey
              const assignBusy = busyKey === assignKey
              return (
                <tr key={row.code} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <input
                        value={editingLabel}
                        onChange={(e) => setEditingLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); onRenameSub(row.code) }
                          if (e.key === 'Escape') { setEditingCode(null); setEditingLabel('') }
                        }}
                        autoFocus
                        disabled={busy}
                        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900"
                      />
                    ) : (
                      <>
                        <span className="text-slate-900">{row.label}</span>
                        <span className="font-mono text-[10px] text-slate-400 mr-2">{row.code}</span>
                        {row.isCustom && (
                          <span className="inline-flex items-center rounded-md bg-purple-50 text-purple-800 ring-1 ring-inset ring-purple-200 px-1.5 py-0.5 text-[10px] font-bold mr-1">مضاف</span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={row.currentMain ?? ''}
                        onChange={(e) => onAssignMain(row.code, e.target.value)}
                        disabled={assignBusy}
                        className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
                      >
                        {mainTypes.map((mt) => (
                          <option key={mt.code} value={mt.code}>{mt.label}</option>
                        ))}
                      </select>
                      {assignBusy && <Loader2 className="w-3 h-3 animate-spin text-teal-600" />}
                      {!assignBusy && (savedTick[assignKey] ?? 0) > 0 && <Check className="w-3 h-3 text-emerald-600" />}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-left">
                    <div className="inline-flex items-center gap-1">
                      {busy && <Loader2 className="w-3 h-3 animate-spin text-teal-600" />}
                      {!busy && (savedTick[subKey] ?? 0) > 0 && <Check className="w-3 h-3 text-emerald-600" />}
                      {isEditing ? (
                        <>
                          <button type="button" onClick={() => onRenameSub(row.code)} title="حفظ"
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
                          <button type="button" onClick={() => onDeleteSub(row.code, row.label, row.isCustom)}
                            title={row.isCustom ? 'حذف' : 'إخفاء'}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-red-700 hover:bg-red-50">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {hiddenSubTypes.map((row) => (
              <tr key={row.code} className="bg-amber-50/40">
                <td className="px-3 py-2 text-slate-400 line-through" colSpan={2}>
                  {row.label}
                  <span className="font-mono text-[10px] text-slate-400 mr-2">{row.code}</span>
                  <span className="inline-flex items-center rounded-md bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200 px-1.5 py-0.5 text-[10px] font-bold mr-1">مخفي</span>
                </td>
                <td className="px-3 py-2 text-left">
                  <button type="button" onClick={() => onRestoreSub(row.code)}
                    disabled={busyKey === `sub:${row.code}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-amber-300 bg-white text-xs font-semibold text-amber-800 hover:bg-amber-50">
                    {busyKey === `sub:${row.code}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                    استعادة
                  </button>
                </td>
              </tr>
            ))}
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
