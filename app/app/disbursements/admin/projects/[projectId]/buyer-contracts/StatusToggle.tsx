'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check } from 'lucide-react'
import { updateSale } from '../../../units/actions'

type SaleStatus = 'active' | 'cancelled' | 'cancelled_resold' | 'completed'

/**
 * Inline sale-status editor for a contract row. Three options that drive
 * the four-state unit derivation on قائمة الوحدات:
 *   ساري  → active     (in progress → unit shows "قيد البيع")
 *   منجز  → completed  (sale went through → unit shows "مباعة" or "أعيد بيعها")
 *   ملغي  → cancelled  (unit reverts to "متاحة" unless a completed sale exists)
 *
 * The legacy `cancelled_resold` value still renders correctly if any row
 * carries it from the pre-migration data, but it's not offered as a
 * picker option — the unit-level derivation now handles "resold" from
 * the presence of a completed sale after a cancellation.
 */
export function StatusToggle({
  saleId,
  initial,
  canEdit,
}: {
  saleId: string
  initial: SaleStatus
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [status, setStatus] = useState<SaleStatus>(initial)
  const [busy, setBusy] = useState(false)
  const [savedTick, setSavedTick] = useState(0)

  async function save(next: SaleStatus) {
    if (!canEdit || next === status) return
    setBusy(true)
    const prev = status
    setStatus(next)
    const res = await updateSale({ id: saleId, patch: { sale_status: next } })
    setBusy(false)
    if (!res.ok) {
      setStatus(prev)
      alert(res.error)
      return
    }
    setSavedTick((n) => n + 1)
    startTransition(() => router.refresh())
  }

  const cls =
    status === 'active'           ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 focus:ring-emerald-500' :
    status === 'completed'        ? 'bg-blue-50 text-blue-800 ring-blue-200 focus:ring-blue-500' :
    status === 'cancelled'        ? 'bg-red-50 text-red-800 ring-red-200 focus:ring-red-500' :
    status === 'cancelled_resold' ? 'bg-amber-50 text-amber-800 ring-amber-200 focus:ring-amber-500' :
                                    'bg-slate-50 text-slate-800 ring-slate-200 focus:ring-slate-500'

  return (
    <div className="flex items-center gap-1 min-w-[6rem]">
      <select
        value={status}
        onChange={(e) => void save(e.target.value as SaleStatus)}
        disabled={!canEdit || busy}
        className={`rounded-md text-[11px] font-bold px-1.5 py-0.5 ring-1 ring-inset focus:outline-none focus:ring-2 disabled:cursor-not-allowed ${cls}`}
      >
        <option value="active">ساري</option>
        <option value="completed">منجز</option>
        <option value="cancelled">ملغي</option>
        {status === 'cancelled_resold' && <option value="cancelled_resold">مباع (قديم)</option>}
      </select>
      {busy && <Loader2 className="w-3 h-3 animate-spin text-teal-600" aria-hidden="true" />}
      {!busy && savedTick > 0 && <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />}
    </div>
  )
}
