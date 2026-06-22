'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PackageCheck, X } from 'lucide-react'
import { deliverCase } from './actions'

/**
 * Mark a signed case as delivered to the recipient.
 *
 * Captures: recipient name (required), ID, phone, recipient notes,
 * delivery date/time (defaults to now), and free-form delivery notes.
 * Sets the case to 'delivered' which acts as the archival state — the case
 * leaves the active inbox and lives in the documents register only.
 *
 * Any staff role can deliver.
 */
function nowLocalForInput(): string {
  // Build a value compatible with <input type="datetime-local"> in the user's
  // local browser time. The form submits as local time and we convert to ISO
  // on the server.
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

export function DeliverDocumentButton({ caseId }: { caseId: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [recipientName, setRecipientName] = useState('')
  const [recipientId, setRecipientId] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [recipientNotes, setRecipientNotes] = useState('')
  const [deliveredAtLocal, setDeliveredAtLocal] = useState(nowLocalForInput())
  const [deliveryNotes, setDeliveryNotes] = useState('')

  function reset() {
    setRecipientName('')
    setRecipientId('')
    setRecipientPhone('')
    setRecipientNotes('')
    setDeliveredAtLocal(nowLocalForInput())
    setDeliveryNotes('')
    setError(null)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!recipientName.trim()) {
      setError('اسم المستلم مطلوب.')
      return
    }
    setBusy(true)
    // Convert local datetime to ISO so the server stores a proper UTC ts.
    const isoDelivered = deliveredAtLocal ? new Date(deliveredAtLocal).toISOString() : null
    const res = await deliverCase({
      case_id: caseId,
      delivered_at: isoDelivered,
      recipient_name: recipientName,
      recipient_id_number: recipientId || null,
      recipient_phone: recipientPhone || null,
      recipient_notes: recipientNotes || null,
      delivery_notes: deliveryNotes || null,
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    reset()
    startTransition(() => router.refresh())
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { reset(); setOpen(true) }}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold shadow-sm hover:bg-amber-700 transition"
      >
        <PackageCheck className="w-3.5 h-3.5" aria-hidden="true" />
        تسليم الوثيقة
      </button>
    )
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:bg-slate-50'
  const labelCls = 'text-[11px] font-semibold text-slate-500 mb-1 block'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl overflow-hidden"
        dir="rtl"
      >
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-slate-200">
          <h3 className="serif font-bold text-base text-slate-900 inline-flex items-center gap-2">
            <PackageCheck className="w-4 h-4 text-amber-600" aria-hidden="true" />
            تسليم الوثيقة
          </h3>
          <button
            type="button"
            onClick={() => { setOpen(false); reset() }}
            disabled={busy}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            سجّل بيانات الـمستلم ووقت التسليم. بعد الحفظ، يُؤرشف الطلب وينتقل إلى سجل الوثائق المسلَّمة.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className={labelCls}>اسم المستلم *</label>
              <input
                className={inputCls}
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                disabled={busy}
                required
                placeholder="مثلاً: محمد عبدالله السلمي"
              />
            </div>
            <div>
              <label className={labelCls}>رقم الهوية</label>
              <input
                className={inputCls}
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value)}
                disabled={busy}
                dir="ltr"
                placeholder="١٠٠٠٠٠٠٠٠٠"
              />
            </div>
            <div>
              <label className={labelCls}>رقم الجوال</label>
              <input
                className={inputCls}
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                disabled={busy}
                dir="ltr"
                placeholder="+9665XXXXXXXX"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>تاريخ ووقت التسليم</label>
              <input
                type="datetime-local"
                className={inputCls}
                value={deliveredAtLocal}
                onChange={(e) => setDeliveredAtLocal(e.target.value)}
                disabled={busy}
                dir="ltr"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>ملاحظات عن المستلم</label>
              <input
                className={inputCls}
                value={recipientNotes}
                onChange={(e) => setRecipientNotes(e.target.value)}
                disabled={busy}
                placeholder="مثلاً: ابن المالك، وكيل قانوني، إلخ"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>ملاحظات عن التسليم</label>
              <textarea
                rows={2}
                className={inputCls}
                value={deliveryNotes}
                onChange={(e) => setDeliveryNotes(e.target.value)}
                disabled={busy}
                placeholder="أي ملاحظات إضافية عن عملية التسليم نفسها"
              />
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => { setOpen(false); reset() }}
            disabled={busy}
            className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-semibold shadow-sm hover:bg-amber-700 disabled:opacity-50"
          >
            <PackageCheck className="w-4 h-4" aria-hidden="true" />
            {busy ? 'جاري التسليم…' : 'تأكيد التسليم'}
          </button>
        </div>
      </form>
    </div>
  )
}
