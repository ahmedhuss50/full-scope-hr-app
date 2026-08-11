'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { updateSaleDelivery } from '../../../units/actions'

/**
 * Compact pill that toggles a sale's delivery status inline in the
 * buyer-contracts list. Click the pill → server action flips
 * dsb_unit_sales.delivery_status + delivery_date, page revalidates.
 *
 * Optimistic UI: the pill color updates immediately, then rolls back on
 * server error.
 */
export function DeliveryToggle({
  saleId,
  initialDelivered,
  canEdit,
}: {
  saleId: string
  initialDelivered: boolean
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [delivered, setDelivered] = useState(initialDelivered)
  const [busy, setBusy] = useState(false)

  async function toggle() {
    if (!canEdit || busy) return
    setBusy(true)
    const next = !delivered
    setDelivered(next) // optimistic
    const res = await updateSaleDelivery({ sale_id: saleId, delivered: next })
    setBusy(false)
    if (!res.ok) {
      setDelivered(!next) // rollback
      alert(res.error)
      return
    }
    startTransition(() => router.refresh())
  }

  const base =
    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ring-1 ring-inset transition select-none'
  const cls = delivered
    ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
    : 'bg-amber-50 text-amber-800 ring-amber-200'
  const clickable = canEdit ? 'cursor-pointer hover:opacity-80' : 'cursor-default'

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!canEdit || busy}
      className={`${base} ${cls} ${clickable}`}
      title={canEdit ? 'اضغط لتغيير حالة التسليم' : undefined}
    >
      {busy && <Loader2 className="w-2.5 h-2.5 animate-spin" aria-hidden="true" />}
      {delivered ? 'مُسلَّمة' : 'غير مُسلَّمة'}
    </button>
  )
}
