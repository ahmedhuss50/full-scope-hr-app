'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check } from 'lucide-react'
import { updateSaleDelivery } from '../../../units/actions'

/**
 * Inline delivery editor for a sale row: dropdown (مسلَّمة / غير مسلَّمة)
 * plus an editable date field that appears when the row is marked
 * delivered. Both auto-save on change — no separate save button.
 *
 * Written as one atomic call to updateSaleDelivery so the DB always sees a
 * consistent status + date pair (never "delivered with no date" or
 * "not delivered with a date").
 */
export function DeliveryToggle({
  saleId,
  initialDelivered,
  initialDate,
  canEdit,
}: {
  saleId: string
  initialDelivered: boolean
  initialDate: string | null   // 'YYYY-MM-DD' or null
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [delivered, setDelivered] = useState(initialDelivered)
  const [date, setDate] = useState<string>(initialDate ?? '')
  const [busy, setBusy] = useState(false)
  const [savedTick, setSavedTick] = useState(0)

  async function save(nextDelivered: boolean, nextDate: string) {
    if (!canEdit) return
    setBusy(true)
    const prevDelivered = delivered
    const prevDate = date
    setDelivered(nextDelivered)
    setDate(nextDate)
    const res = await updateSaleDelivery({
      sale_id: saleId,
      delivered: nextDelivered,
      delivery_date: nextDate || null,
    })
    setBusy(false)
    if (!res.ok) {
      // rollback
      setDelivered(prevDelivered)
      setDate(prevDate)
      alert(res.error)
      return
    }
    setSavedTick((n) => n + 1)
    startTransition(() => router.refresh())
  }

  function onStatusChange(v: string) {
    const nowDelivered = v === 'delivered'
    // When flipping ON: default the date to today if empty. When flipping
    // OFF: clear the date so the DB state stays consistent.
    const nextDate = nowDelivered
      ? date || new Date().toISOString().slice(0, 10)
      : ''
    void save(nowDelivered, nextDate)
  }

  function onDateChange(v: string) {
    // If the operator types a date while the row is "not delivered", that
    // implicitly means they're setting it as delivered.
    void save(true, v)
  }

  return (
    <div className="flex flex-col gap-1 min-w-[8.5rem]">
      <div className="flex items-center gap-1">
        <select
          value={delivered ? 'delivered' : 'pending'}
          onChange={(e) => onStatusChange(e.target.value)}
          disabled={!canEdit || busy}
          className={`rounded-md text-[11px] font-bold px-1.5 py-0.5 ring-1 ring-inset focus:outline-none focus:ring-2 disabled:cursor-not-allowed ${
            delivered
              ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 focus:ring-emerald-500'
              : 'bg-amber-50 text-amber-800 ring-amber-200 focus:ring-amber-500'
          }`}
        >
          <option value="pending">غير مُسلَّمة</option>
          <option value="delivered">مُسلَّمة</option>
        </select>
        {busy && <Loader2 className="w-3 h-3 animate-spin text-teal-600" aria-hidden="true" />}
        {!busy && savedTick > 0 && (
          <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />
        )}
      </div>
      {delivered && (
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
