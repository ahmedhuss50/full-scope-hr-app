'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Loader2 } from 'lucide-react'

type Category = 'buyer_collection' | 'wrong_transfer' | 'self_financing' | 'bank_financing' | 'other'

/**
 * Owner-only inline "add a single payment" dialog on سجل الدفعات.
 * Posts to /api/dsb-add-payment which delegates to createSinglePayment.
 */
export function AddPaymentDialog({
  projects,
  accounts,
}: {
  projects: Array<{ id: string; name_ar: string; code: string }>
  accounts: Array<{ id: string; label: string; project_id: string | null }>
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [projectId, setProjectId]           = useState('')
  const [accountId, setAccountId]           = useState('')
  const [paymentDate, setPaymentDate]       = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount]                 = useState('')
  const [vat, setVat]                       = useState('')
  const [category, setCategory]             = useState<Category>('buyer_collection')
  const [beneficiary, setBeneficiary]       = useState('')
  const [description, setDescription]       = useState('')
  const [referenceNo, setReferenceNo]       = useState('')
  const [paymentMethod, setPaymentMethod]   = useState('')
  const [contractNumber, setContractNumber] = useState('')

  function reset() {
    setProjectId(''); setAccountId(''); setPaymentDate(new Date().toISOString().slice(0, 10))
    setAmount(''); setVat(''); setCategory('buyer_collection')
    setBeneficiary(''); setDescription(''); setReferenceNo(''); setPaymentMethod(''); setContractNumber('')
    setError(null)
  }

  async function onSave() {
    setError(null)
    if (!projectId) { setError('اختر المشروع.'); return }
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setError('المبلغ يجب أن يكون أكبر من صفر.'); return }
    setBusy(true)
    try {
      const resp = await fetch('/api/dsb-add-payment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          account_id: accountId || null,
          payment_date: paymentDate,
          amount_sar: amt,
          vat_sar: vat ? Number(vat) : null,
          deposit_category: category,
          beneficiary_name: beneficiary.trim() || null,
          description: description.trim() || null,
          reference_number: referenceNo.trim() || null,
          payment_method: paymentMethod.trim() || null,
          contract_number: contractNumber.trim() || null,
        }),
      })
      const data = await resp.json().catch(() => ({ ok: false, error: 'استجابة غير صالحة من الخادم.' }))
      setBusy(false)
      if (!resp.ok || !data.ok) { setError(data.error ?? `خطأ ${resp.status}`); return }
      reset(); setOpen(false)
      startTransition(() => router.refresh())
    } catch (err) {
      setBusy(false)
      setError('خطأ في الشبكة: ' + String(err))
    }
  }

  // Filter accounts to those on the chosen project (or tenant-wide if project=='').
  const filteredAccounts = accountId && !projectId
    ? accounts
    : accounts.filter((a) => !a.project_id || a.project_id === projectId)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-bold shadow-sm hover:bg-teal-700"
      >
        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        إضافة دفعة
      </button>
    )
  }

  const inputCls = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'
  const labelCls = 'text-xs font-semibold text-slate-600 mb-1 block'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 py-8 px-4" dir="rtl">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-slate-200">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="serif font-bold text-lg text-slate-900">إضافة دفعة</h3>
          <button type="button" onClick={() => { reset(); setOpen(false) }} className="text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>المشروع <span className="text-red-500">*</span></label>
              <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={busy} autoFocus>
                <option value="">— اختر مشروعًا —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name_ar}{p.code ? ` · ${p.code}` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>الحساب البنكي</label>
              <select className={inputCls} value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={busy}>
                <option value="">— بدون تحديد —</option>
                {filteredAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>التصنيف</label>
              <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as Category)} disabled={busy}>
                <option value="buyer_collection">تحصيل مشتري</option>
                <option value="self_financing">تمويل ذاتي</option>
                <option value="bank_financing">تمويل بنكي</option>
                <option value="wrong_transfer">حوالة خاطئة</option>
                <option value="other">أخرى</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>تاريخ الدفعة <span className="text-red-500">*</span></label>
              <input className={inputCls} type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} disabled={busy} dir="ltr" />
            </div>
            <div>
              <label className={labelCls}>المبلغ (ر.س) <span className="text-red-500">*</span></label>
              <input className={inputCls} type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
            </div>
            <div>
              <label className={labelCls}>الضريبة (ر.س)</label>
              <input className={inputCls} type="number" step="0.01" min="0" value={vat} onChange={(e) => setVat(e.target.value)} disabled={busy} />
            </div>
            <div>
              <label className={labelCls}>اسم المشتري / المستفيد</label>
              <input className={inputCls} value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} disabled={busy} />
            </div>
            <div>
              <label className={labelCls}>رقم العقد (لربط بالعقد)</label>
              <input className={inputCls} value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} disabled={busy} placeholder="EAS…" />
            </div>
            <div>
              <label className={labelCls}>المرجع</label>
              <input className={inputCls} value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} disabled={busy} />
            </div>
            <div>
              <label className={labelCls}>طريقة الدفع</label>
              <input className={inputCls} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} disabled={busy} placeholder="تحويل / نقدي / شيك" />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>البيان</label>
              <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
            </div>
          </div>

          {error && (<div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 font-semibold">{error}</div>)}
          <div className="flex items-center gap-2 pt-2">
            <button type="button" onClick={onSave} disabled={busy} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:opacity-50">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {busy ? 'جارٍ الحفظ…' : 'حفظ الدفعة'}
            </button>
            <button type="button" onClick={() => { reset(); setOpen(false) }} disabled={busy} className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
