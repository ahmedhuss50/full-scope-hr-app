'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { upsertChecklistResponse } from './actions'

export type ChecklistStatus =
  | 'pending'
  | 'verified'
  | 'issue'
  | 'not_mentioned'
  | 'not_attached'

export type ChecklistItem = {
  id: string
  code: string
  order_index: number
  prompt_ar: string
  prompt_en: string
}

export type ChecklistResponse = {
  id: string | null
  checklist_item_id: string
  status: ChecklistStatus
  notes: string | null
  ai_suggested_status: ChecklistStatus | null
}

const STATUS_LABEL: Record<ChecklistStatus, string> = {
  pending:       'بانتظار',
  verified:      'تم التحقق',
  issue:         'يوجد مشكلة',
  not_mentioned: 'لم يُذكر',
  not_attached:  'لم يُرفق',
}

const STATUS_OPTIONS: ChecklistStatus[] = [
  'pending',
  'verified',
  'issue',
  'not_mentioned',
  'not_attached',
]

function statusPillCls(status: ChecklistStatus): string {
  switch (status) {
    case 'verified':      return 'bg-green-50 text-green-700 ring-green-200'
    case 'issue':         return 'bg-red-50 text-red-700 ring-red-200'
    case 'not_mentioned': return 'bg-amber-50 text-amber-700 ring-amber-200'
    case 'not_attached':  return 'bg-amber-50 text-amber-700 ring-amber-200'
    case 'pending':
    default:              return 'bg-slate-100 text-slate-600 ring-slate-200'
  }
}

type Snapshot = { status: ChecklistStatus; notes: string }

export function ChecklistEditor({
  caseId,
  items,
  responses,
  canEdit,
}: {
  caseId: string
  items: ChecklistItem[]
  responses: ChecklistResponse[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const responseByItemId = useMemo(() => {
    const m = new Map<string, ChecklistResponse>()
    for (const r of responses) m.set(r.checklist_item_id, r)
    return m
  }, [responses])

  // Build the baseline (last-persisted) snapshot once per items/responses pair.
  // Any difference between `current[itemId]` and `baseline[itemId]` is an
  // unsaved change that the "save all" button will flush.
  const buildBaseline = (): Record<string, Snapshot> => {
    const out: Record<string, Snapshot> = {}
    for (const it of items) {
      const r = responseByItemId.get(it.id)
      out[it.id] = {
        status: (r?.status as ChecklistStatus) ?? 'pending',
        notes: r?.notes ?? '',
      }
    }
    return out
  }

  const [baseline, setBaseline] = useState<Record<string, Snapshot>>(buildBaseline)
  const [current, setCurrent] = useState<Record<string, Snapshot>>(buildBaseline)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  // Which item IDs have unsaved edits.
  const dirtyItemIds = useMemo(() => {
    const out: string[] = []
    for (const it of items) {
      const b = baseline[it.id]
      const c = current[it.id]
      if (!b || !c) continue
      if (b.status !== c.status || (b.notes ?? '').trim() !== (c.notes ?? '').trim()) {
        out.push(it.id)
      }
    }
    return out
  }, [items, baseline, current])

  const dirtyCount = dirtyItemIds.length
  const answeredCount = useMemo(
    () => Object.values(current).filter((r) => r.status !== 'pending').length,
    [current],
  )

  function onStatusChange(itemId: string, status: ChecklistStatus) {
    setError(null)
    setSavedFlash(false)
    setCurrent((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? { notes: '' }), status },
    }))
  }

  function onNotesChange(itemId: string, notes: string) {
    setError(null)
    setSavedFlash(false)
    setCurrent((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? { status: 'pending' as ChecklistStatus }), notes },
    }))
  }

  async function saveAll() {
    if (!canEdit) return
    if (dirtyCount === 0) return
    setSaving(true)
    setError(null)
    setSavedFlash(false)

    // Persist sequentially so a partial failure leaves us with a precise
    // error rather than a confusing race. The action itself is idempotent.
    let failedItemCode: string | null = null
    for (const itemId of dirtyItemIds) {
      const cur = current[itemId]!
      const res = await upsertChecklistResponse({
        case_id: caseId,
        checklist_item_id: itemId,
        status: cur.status,
        notes: cur.notes.trim() ? cur.notes.trim() : null,
      })
      if (!res.ok) {
        const item = items.find((it) => it.id === itemId)
        failedItemCode = item?.code ?? itemId
        setError(`${failedItemCode}: ${res.error}`)
        break
      }
    }

    setSaving(false)
    if (!failedItemCode) {
      // Promote current → baseline so dirty count resets to zero.
      setBaseline({ ...current })
      setSavedFlash(true)
      startTransition(() => router.refresh())
      // Auto-hide the "saved" pill after a few seconds.
      setTimeout(() => setSavedFlash(false), 2500)
    }
  }

  function discardChanges() {
    if (dirtyCount === 0) return
    setCurrent({ ...baseline })
    setError(null)
    setSavedFlash(false)
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50 disabled:text-slate-500'

  const total = items.length

  if (total === 0) {
    return (
      <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
        <h2 className="serif font-bold text-lg text-slate-900">قائمة المراجعة</h2>
        <div className="text-sm text-slate-500">لا توجد بنود في قائمة المراجعة بعد.</div>
      </section>
    )
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="serif font-bold text-lg text-slate-900">قائمة المراجعة</h2>
          <p className="text-xs text-slate-500 mt-1">
            {`${toArabicDigits(answeredCount)} من ${toArabicDigits(total)} تم الإجابة عليها`}
            {dirtyCount > 0 && (
              <span className="ms-2 text-amber-700 font-semibold">
                {`· ${toArabicDigits(dirtyCount)} غير محفوظة`}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!canEdit && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ring-inset bg-slate-100 text-slate-600 ring-slate-200">
              للعرض فقط — دورك يسمح بالعرض دون التعديل
            </span>
          )}
          {canEdit && (
            <>
              {dirtyCount > 0 && (
                <button
                  type="button"
                  onClick={discardChanges}
                  disabled={saving}
                  className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition disabled:opacity-50"
                >
                  تجاهل التغييرات
                </button>
              )}
              <button
                type="button"
                onClick={saveAll}
                disabled={saving || dirtyCount === 0}
                className="inline-flex items-center px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
              >
                {saving
                  ? 'جارٍ الحفظ…'
                  : dirtyCount > 0
                    ? `حفظ التغييرات (${toArabicDigits(dirtyCount)})`
                    : 'حفظ الكل'}
              </button>
              {savedFlash && (
                <span className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-semibold bg-green-50 text-green-700 ring-1 ring-inset ring-green-200">
                  ✓ تم الحفظ
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs font-semibold text-slate-500 border-b border-slate-200">
              <th className="text-start py-2 px-2 w-10">#</th>
              <th className="text-start py-2 px-2">البند</th>
              <th className="text-start py-2 px-2 w-36">اقتراح الذكاء الاصطناعي</th>
              <th className="text-start py-2 px-2 w-44">الحالة النهائية</th>
              <th className="text-start py-2 px-2 w-80">ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const row = current[it.id] ?? { status: 'pending' as ChecklistStatus, notes: '' }
              const aiSuggestion = responseByItemId.get(it.id)?.ai_suggested_status ?? null
              const isDirty = dirtyItemIds.includes(it.id)
              return (
                <tr
                  key={it.id}
                  className={`border-b border-slate-100 align-top ${
                    isDirty ? 'bg-amber-50/30' : ''
                  }`}
                >
                  <td className="py-2 px-2 text-xs text-slate-500 font-mono">
                    {toArabicDigits(idx + 1)}
                  </td>
                  <td className="py-2 px-2">
                    <div className="text-sm font-semibold text-slate-900 leading-snug">
                      {it.prompt_ar}
                    </div>
                    <div className="text-[11px] text-slate-500 leading-snug mt-0.5">
                      {it.prompt_en}
                    </div>
                    <div className="mt-1">
                      <span className="inline-block text-[10px] font-mono text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">
                        {it.code}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    {aiSuggestion ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${statusPillCls(aiSuggestion)}`}>
                        {STATUS_LABEL[aiSuggestion]}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex flex-col gap-1">
                      <select
                        disabled={!canEdit || saving}
                        className={inputCls}
                        value={row.status}
                        onChange={(e) => onStatusChange(it.id, e.target.value as ChecklistStatus)}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                        ))}
                      </select>
                      <span className={`self-start inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ring-inset ${statusPillCls(row.status)}`}>
                        {STATUS_LABEL[row.status]}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    <textarea
                      rows={4}
                      disabled={!canEdit || saving}
                      className={inputCls + ' resize-y min-h-[5rem] leading-snug'}
                      placeholder="اكتب ملاحظتك هنا…"
                      value={row.notes}
                      onChange={(e) => onNotesChange(it.id, e.target.value)}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {canEdit && dirtyCount > 0 && (
        <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2 flex-wrap">
          <button
            type="button"
            onClick={discardChanges}
            disabled={saving}
            className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition disabled:opacity-50"
          >
            تجاهل التغييرات
          </button>
          <button
            type="button"
            onClick={saveAll}
            disabled={saving}
            className="inline-flex items-center px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
          >
            {saving ? 'جارٍ الحفظ…' : `حفظ التغييرات (${toArabicDigits(dirtyCount)})`}
          </button>
        </div>
      )}
    </section>
  )
}

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
function toArabicDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)] ?? d)
}
