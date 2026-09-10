'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check } from 'lucide-react'
import { updateUnitCompletion } from '../../../units/actions'

/**
 * Inline completion editor for a unit row: dropdown (منجزة / غير منجزة) plus
 * an editable date field that appears when the row is marked completed. One
 * atomic call to updateUnitCompletion so status + date stay consistent.
 */
export function CompletionToggle({
  unitId,
  initialCompleted,
  initialDate,
  canEdit,
}: {
  unitId: string
  initialCompleted: boolean
  initialDate: string | null   // 'YYYY-MM-DD' or null
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [completed, setCompleted] = useState(initialCompleted)
  const [date, setDate] = useState<string>(initialDate ?? '')
  const [busy, setBusy] = useState(false)
  const [savedTick, setSavedTick] = useState(0)

  async function save(nextCompleted: boolean, nextDate: string) {
    if (!canEdit) return
    setBusy(true)
    const prevCompleted = completed
    const prevDate = date
    setCompleted(nextCompleted)
    setDate(nextDate)
    const res = await updateUnitCompletion({
      unit_id: unitId,
      completed: nextCompleted,
      completion_date: nextDate || null,
    })
    setBusy(false)
    if (!res.ok) {
      setCompleted(prevCompleted)
      setDate(prevDate)
      alert(res.error)
      return
    }
    setSavedTick((n) => n + 1)
    startTransition(() => router.refresh())
  }

  function onStatusChange(v: string) {
    const nowCompleted = v === 'completed'
    const nextDate = nowCompleted
      ? date || new Date().toISOString().slice(0, 10)
      : ''
    void save(nowCompleted, nextDate)
  }

  function onDateChange(v: string) {
    // Typing a date implies "completed"
    void save(true, v)
  }

  return (
    <div className="flex flex-col gap-1 min-w-[8.5rem]">
      <div className="flex items-center gap-1">
        <select
          value={completed ? 'completed' : 'not_completed'}
          onChange={(e) => onStatusChange(e.target.value)}
          disabled={!canEdit || busy}
          className={`rounded-md text-[11px] font-bold px-1.5 py-0.5 ring-1 ring-inset focus:outline-none focus:ring-2 disabled:cursor-not-allowed ${
            completed
              ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 focus:ring-emerald-500'
              : 'bg-amber-50 text-amber-800 ring-amber-200 focus:ring-amber-500'
          }`}
        >
          <option value="not_completed">غير منجزة</option>
          <option value="completed">منجزة</option>
        </select>
        {busy && <Loader2 className="w-3 h-3 animate-spin text-teal-600" aria-hidden="true" />}
        {!busy && savedTick > 0 && <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />}
      </div>
      {completed && (
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          disabled={!canEdit || busy}
          dir="ltr"
          className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-slate-100"
        />
      )}
    </div>
  )
}
