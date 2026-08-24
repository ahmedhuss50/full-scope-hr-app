'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check } from 'lucide-react'
import { updateDepositCategory, type DepositCategory } from './actions'

/**
 * Inline dropdown for classifying a deposit into one of the five categories.
 * Autosaves on change with optimistic UI + rollback on error.
 *
 * Same UX pattern as DeliveryToggle (buyer-contracts): single-click flip,
 * green tick briefly after save, loader while pending.
 */
const OPTIONS: Array<{ value: DepositCategory; label: string; tone: string }> = [
  { value: 'buyer_collection', label: 'تحصيل مشتري', tone: 'bg-teal-50 text-teal-800 ring-teal-200 focus:ring-teal-500' },
  { value: 'wrong_transfer',   label: 'حوالة خاطئة', tone: 'bg-red-50 text-red-800 ring-red-200 focus:ring-red-500' },
  { value: 'self_financing',   label: 'تمويل ذاتي',   tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200 focus:ring-emerald-500' },
  { value: 'bank_financing',   label: 'تمويل بنكي',   tone: 'bg-indigo-50 text-indigo-800 ring-indigo-200 focus:ring-indigo-500' },
  { value: 'other',            label: 'أخرى',          tone: 'bg-slate-50 text-slate-800 ring-slate-200 focus:ring-slate-500' },
]

const TONE_BY_VALUE = new Map(OPTIONS.map((o) => [o.value, o.tone]))

export function DepositCategoryPicker({
  paymentId,
  initial,
  canEdit,
}: {
  paymentId: string
  initial: DepositCategory
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [value, setValue] = useState<DepositCategory>(initial)
  const [busy, setBusy] = useState(false)
  const [savedTick, setSavedTick] = useState(0)

  async function save(next: DepositCategory) {
    if (!canEdit) return
    const prev = value
    setValue(next)
    setBusy(true)
    const res = await updateDepositCategory({ payment_id: paymentId, category: next })
    setBusy(false)
    if (!res.ok) {
      setValue(prev)
      alert(res.error)
      return
    }
    setSavedTick((n) => n + 1)
    startTransition(() => router.refresh())
  }

  const tone = TONE_BY_VALUE.get(value) ?? OPTIONS[0].tone

  return (
    <div className="flex items-center gap-1 min-w-[9rem]">
      <select
        value={value}
        onChange={(e) => save(e.target.value as DepositCategory)}
        disabled={!canEdit || busy}
        className={`rounded-md text-[11px] font-bold px-1.5 py-0.5 ring-1 ring-inset focus:outline-none focus:ring-2 disabled:cursor-not-allowed ${tone}`}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {busy && <Loader2 className="w-3 h-3 animate-spin text-teal-600" aria-hidden="true" />}
      {!busy && savedTick > 0 && <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />}
    </div>
  )
}

// Reusable in the page for the tab strip.
export const DEPOSIT_CATEGORY_LABELS: Record<DepositCategory, string> = {
  buyer_collection: 'تحصيل مشتري',
  wrong_transfer:   'حوالة خاطئة',
  self_financing:   'تمويل ذاتي',
  bank_financing:   'تمويل بنكي',
  other:            'أخرى',
}
