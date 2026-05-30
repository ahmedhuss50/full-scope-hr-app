'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
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

type RowState = {
  status: ChecklistStatus
  notes: string
  saving: boolean
  saved_at: number | null
  error: string | null
}

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

  // Index responses by item_id for quick lookup.
  const responseByItemId = useMemo(() => {
    const m = new Map<string, ChecklistResponse>()
    for (const r of responses) m.set(r.checklist_item_id, r)
    return m
  }, [responses])

  // Initial per-item state.
  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const initial: Record<string, RowState> = {}
    for (const it of items) {
      const r = responseByItemId.get(it.id)
      initial[it.id] = {
        status: (r?.status as ChecklistStatus) ?? 'pending',
        notes: r?.notes ?? '',
        saving: false,
        saved_at: null,
        error: null,
      }
    }
    return initial
  })

  // Debounce timer handle per-item for autosave on dropdown change.
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({})

  const answeredCount = useMemo(
    () => Object.values(rows).filter((r) => r.status !== 'pending').length,
    [rows],
  )

  async function persist(itemId: string) {
    const cur = rows[itemId]
    if (!cur) return
    setRows((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId]!, saving: true, error: null },
    }))
    const res = await upsertChecklistResponse({
      case_id: caseId,
      checklist_item_id: itemId,
      status: cur.status,
      notes: cur.notes.trim() ? cur.notes.trim() : null,
    })
    setRows((prev) => {
      const row = prev[itemId]
      if (!row) return prev
      return {
        ...prev,
        [itemId]: {
          ...row,
          saving: false,
          saved_at: res.ok ? Date.now() : row.saved_at,
          error: res.ok ? null : res.error,
        },
      }
    })
    if (res.ok) {
      startTransition(() => router.refresh())
    }
  }

  function scheduleAutoSave(itemId: string, delayMs = 500) {
    const existing = timersRef.current[itemId]
    if (existing) clearTimeout(existing)
    timersRef.current[itemId] = setTimeout(() => {
      timersRef.current[itemId] = null
      persist(itemId)
    }, delayMs)
  }

  function onStatusChange(itemId: string, status: ChecklistStatus) {
    setRows((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId]!, status, error: null },
    }))
    if (canEdit) scheduleAutoSave(itemId, 500)
  }

  function onNotesChange(itemId: string, notes: string) {
    setRows((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId]!, notes, error: null },
    }))
  }

  function onSaveClick(itemId: string) {
    const existing = timersRef.current[itemId]
    if (existing) {
      clearTimeout(existing)
      timersRef.current[itemId] = null
    }
    persist(itemId)
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
          </p>
        </div>
        {!canEdit && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ring-inset bg-slate-100 text-slate-600 ring-slate-200">
            للعرض فقط — دورك يسمح بالعرض دون التعديل
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs font-semibold text-slate-500 border-b border-slate-200">
              <th className="text-start py-2 px-2 w-10">#</th>
              <th className="text-start py-2 px-2">البند</th>
              <th className="text-start py-2 px-2 w-36">اقتراح الذكاء الاصطناعي</th>
              <th className="text-start py-2 px-2 w-40">الحالة النهائية</th>
              <th className="text-start py-2 px-2 w-56">ملاحظات</th>
              <th className="text-start py-2 px-2 w-24">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const row = rows[it.id] ?? {
                status: 'pending' as ChecklistStatus,
                notes: '',
                saving: false,
                saved_at: null,
                error: null,
              }
              const aiSuggestion = responseByItemId.get(it.id)?.ai_suggested_status ?? null
              return (
                <tr key={it.id} className="border-b border-slate-100 align-top">
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
                        disabled={!canEdit || row.saving}
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
                    <input
                      type="text"
                      disabled={!canEdit || row.saving}
                      className={inputCls}
                      placeholder="ملاحظة قصيرة"
                      value={row.notes}
                      onChange={(e) => onNotesChange(it.id, e.target.value)}
                    />
                  </td>
                  <td className="py-2 px-2">
                    {canEdit ? (
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          disabled={row.saving}
                          onClick={() => onSaveClick(it.id)}
                          className="inline-flex items-center justify-center px-2 py-1 rounded-md bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition disabled:opacity-50"
                        >
                          {row.saving ? 'جارٍ الحفظ…' : 'حفظ'}
                        </button>
                        {row.error && (
                          <div className="text-[10px] text-red-600">{row.error}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
function toArabicDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)] ?? d)
}
