'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { updateCaseFields } from './actions'

type CaseFields = {
  id: string
  voucher_number_text: string | null
  voucher_date: string | null
  amount_sar: number | null
  delivery_date: string | null
  notes: string | null
}

/**
 * Inline edit for the case's top-level metadata. Workflow status, signer, and
 * extracted fields are NOT touched here — those have their own dedicated
 * flows. Any staff role can edit.
 */
export function EditCaseInfo({ kase, canEdit }: { kase: CaseFields; canEdit: boolean }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voucherNumber, setVoucherNumber] = useState(kase.voucher_number_text ?? '')
  const [voucherDate, setVoucherDate] = useState(kase.voucher_date ?? '')
  const [amount, setAmount] = useState<string>(kase.amount_sar != null ? String(kase.amount_sar) : '')
  const [deliveryDate, setDeliveryDate] = useState(kase.delivery_date ?? '')
  const [notes, setNotes] = useState(kase.notes ?? '')

  function reset() {
    setVoucherNumber(kase.voucher_number_text ?? '')
    setVoucherDate(kase.voucher_date ?? '')
    setAmount(kase.amount_sar != null ? String(kase.amount_sar) : '')
    setDeliveryDate(kase.delivery_date ?? '')
    setNotes(kase.notes ?? '')
    setError(null)
  }

  async function onSave() {
    setError(null)
    const amountNum = amount.trim() === '' ? null : Number(amount)
    if (amountNum !== null && (!Number.isFinite(amountNum) || amountNum < 0)) {
      setError('المبلغ غير صالح.')
      return
    }
    setSaving(true)
    const res = await updateCaseFields({
      case_id: kase.id,
      voucher_number_text: voucherNumber.trim() || null,
      voucher_date: voucherDate || null,
      amount_sar: amountNum,
      delivery_date: deliveryDate || null,
      notes: notes.trim() || null,
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    startTransition(() => router.refresh())
  }

  if (!canEdit) return null

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
      >
        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
        تعديل البيانات
      </button>
    )
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

  return (
    <div className="bg-teal-50/30 border border-teal-200 rounded-lg p-4 space-y-3">
      <h3 className="serif font-bold text-sm text-slate-900">تعديل بيانات الطلب</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">رقم السند</label>
          <input className={inputCls} value={voucherNumber} onChange={(e) => setVoucherNumber(e.target.value)} disabled={saving} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">تاريخ السند</label>
          <input type="date" className={inputCls} value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} disabled={saving} dir="ltr" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">المبلغ (ر.س)</label>
          <input type="number" min="0" step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={saving} dir="ltr" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">تاريخ التسليم</label>
          <input type="date" className={inputCls} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} disabled={saving} dir="ltr" />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-semibold text-slate-500 mb-1 block">ملاحظات</label>
          <textarea rows={3} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} />
        </div>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={onSave} disabled={saving} className="inline-flex items-center px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50">
          {saving ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
        <button type="button" onClick={() => { reset(); setOpen(false) }} disabled={saving} className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50">
          إلغاء
        </button>
      </div>
    </div>
  )
}
