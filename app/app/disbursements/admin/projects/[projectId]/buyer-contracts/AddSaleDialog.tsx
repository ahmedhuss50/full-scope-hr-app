'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Loader2 } from 'lucide-react'
import { createSingleSale } from '../../../units/actions'

type SaleStatus = 'active' | 'cancelled' | 'cancelled_resold' | 'completed'

/**
 * Minimal inline "add a contract" form. unit_number_raw is optional —
 * matches the AI linker's flow: create the sale first, link to a unit
 * later (either manually via the linker or on the units page).
 */
export function AddSaleDialog({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [unitNumber, setUnitNumber]         = useState('')
  const [buyerName, setBuyerName]           = useState('')
  const [buyerIdType, setBuyerIdType]       = useState<'national' | 'residency' | 'passport' | ''>('')
  const [buyerIdNumber, setBuyerIdNumber]   = useState('')
  const [buyerNationality, setBuyerNat]     = useState('')
  const [buyerPhone, setBuyerPhone]         = useState('')
  const [contractNumber, setContractNumber] = useState('')
  const [contractType, setContractType]     = useState('')
  const [financingType, setFinancingType]   = useState('')
  const [financingBank, setFinancingBank]   = useState('')
  const [saleDate, setSaleDate]             = useState('')
  const [priceBeforeTax, setPriceBeforeTax] = useState('')
  const [saleStatus, setSaleStatus]         = useState<SaleStatus>('active')

  function reset() {
    setUnitNumber(''); setBuyerName(''); setBuyerIdType(''); setBuyerIdNumber('')
    setBuyerNat(''); setBuyerPhone(''); setContractNumber(''); setContractType('')
    setFinancingType(''); setFinancingBank(''); setSaleDate(''); setPriceBeforeTax('')
    setSaleStatus('active'); setError(null)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    alert('[1] onSubmit fired — projectId=' + projectId + ', buyer=' + buyerName)
    setError(null); setBusy(true)
    try {
      const res = await createSingleSale({
        project_id: projectId,
        unit_number_raw: unitNumber.trim() || null,
        sale_status: saleStatus,
        buyer_name_ar: buyerName.trim() || null,
        buyer_id_type: buyerIdType || null,
        buyer_id_number: buyerIdNumber.trim() || null,
        buyer_nationality: buyerNationality.trim() || null,
        buyer_phone: buyerPhone.trim() || null,
        contract_number: contractNumber.trim() || null,
        contract_type: contractType.trim() || null,
        financing_type: financingType.trim() || null,
        financing_bank: financingBank.trim() || null,
        sale_date: saleDate || null,
        price_before_tax_sar: priceBeforeTax ? Number(priceBeforeTax) : null,
      })
      setBusy(false)
      alert('[2] server returned: ' + JSON.stringify(res))
      if (!res.ok) {
        setError(res.error)
        return
      }
      reset(); setOpen(false)
      startTransition(() => router.refresh())
    } catch (err) {
      setBusy(false)
      alert('[X] EXCEPTION: ' + String(err))
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
      >
        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        إضافة عقد
      </button>
    )
  }

  const inputCls = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'
  const labelCls = 'text-xs font-semibold text-slate-600 mb-1 block'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 py-8 px-4" dir="rtl">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-slate-200">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="serif font-bold text-lg text-slate-900">إضافة عقد جديد</h3>
          <button type="button" onClick={() => { reset(); setOpen(false) }} className="text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>حالة العقد</label>
              <select className={inputCls} value={saleStatus} onChange={(e) => setSaleStatus(e.target.value as SaleStatus)} disabled={busy}>
                <option value="active">ساري</option>
                <option value="completed">منجز</option>
                <option value="cancelled">ملغي</option>
              </select>
            </div>
            <div><label className={labelCls}>رقم الوحدة (ربط لاحق إن ترك فارغ)</label><input className={inputCls} value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} disabled={busy} /></div>
          </div>

          <div><label className={labelCls}>اسم المشتري</label><input className={inputCls} value={buyerName} onChange={(e) => setBuyerName(e.target.value)} disabled={busy} autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>نوع الهوية</label>
              <select className={inputCls} value={buyerIdType} onChange={(e) => setBuyerIdType(e.target.value as typeof buyerIdType)} disabled={busy}>
                <option value="">—</option>
                <option value="national">أحوال وطنية</option>
                <option value="residency">إقامة</option>
                <option value="passport">جواز</option>
              </select>
            </div>
            <div><label className={labelCls}>رقم الهوية</label><input className={inputCls} value={buyerIdNumber} onChange={(e) => setBuyerIdNumber(e.target.value)} disabled={busy} /></div>
            <div><label className={labelCls}>الجنسية</label><input className={inputCls} value={buyerNationality} onChange={(e) => setBuyerNat(e.target.value)} disabled={busy} /></div>
            <div><label className={labelCls}>رقم الجوال</label><input className={inputCls} value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} disabled={busy} dir="ltr" /></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>رقم العقد</label><input className={inputCls} value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} disabled={busy} /></div>
            <div><label className={labelCls}>نوع العقد</label><input className={inputCls} value={contractType} onChange={(e) => setContractType(e.target.value)} disabled={busy} /></div>
            <div><label className={labelCls}>نوع التمويل</label><input className={inputCls} value={financingType} onChange={(e) => setFinancingType(e.target.value)} disabled={busy} placeholder="بيع / تمويل" /></div>
            <div><label className={labelCls}>الجهة التمويلية</label><input className={inputCls} value={financingBank} onChange={(e) => setFinancingBank(e.target.value)} disabled={busy} /></div>
            <div><label className={labelCls}>تاريخ البيع</label><input className={inputCls} value={saleDate} onChange={(e) => setSaleDate(e.target.value)} disabled={busy} type="date" dir="ltr" /></div>
            <div><label className={labelCls}>السعر قبل الضريبة</label><input className={inputCls} value={priceBeforeTax} onChange={(e) => setPriceBeforeTax(e.target.value)} disabled={busy} type="number" step="0.01" /></div>
          </div>

          {error && (<div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>)}
          <div className="flex items-center gap-2 pt-2">
            <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:opacity-50">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {busy ? 'جارٍ الحفظ…' : 'حفظ العقد'}
            </button>
            <button type="button" onClick={() => { reset(); setOpen(false) }} disabled={busy} className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
