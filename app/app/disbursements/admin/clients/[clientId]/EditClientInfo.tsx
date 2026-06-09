'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { updateClient } from '../../edit-actions'

type Client = {
  id: string
  company_name_ar: string
  contact_name: string | null
  contact_email: string
  notes: string | null
  status: string | null
  bank_name?: string | null
  bank_account?: string | null
  bank_iban?: string | null
}

const STATUS_OPTIONS: Array<{ value: 'active' | 'archived' | 'inactive'; label: string }> = [
  { value: 'active',   label: 'نشط' },
  { value: 'archived', label: 'مؤرشف' },
  { value: 'inactive', label: 'غير نشط' },
]

/**
 * Inline edit panel for a client. Click "تعديل البيانات" → the info section
 * swaps to editable inputs → Save persists via updateClient, Cancel restores.
 */
export function EditClientInfo({ client }: { client: Client }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState(client.company_name_ar)
  const [contactName, setContactName] = useState(client.contact_name ?? '')
  const [contactEmail, setContactEmail] = useState(client.contact_email)
  const [notes, setNotes] = useState(client.notes ?? '')
  const [status, setStatus] = useState<'active' | 'archived' | 'inactive'>(
    (client.status as 'active' | 'archived' | 'inactive') ?? 'active',
  )
  const [bankName, setBankName] = useState(client.bank_name ?? '')
  const [bankAccount, setBankAccount] = useState(client.bank_account ?? '')
  const [bankIban, setBankIban] = useState(client.bank_iban ?? '')

  function reset() {
    setCompanyName(client.company_name_ar)
    setContactName(client.contact_name ?? '')
    setContactEmail(client.contact_email)
    setNotes(client.notes ?? '')
    setStatus((client.status as 'active' | 'archived' | 'inactive') ?? 'active')
    setBankName(client.bank_name ?? '')
    setBankAccount(client.bank_account ?? '')
    setBankIban(client.bank_iban ?? '')
    setError(null)
  }

  async function onSave() {
    setError(null)
    setSaving(true)
    const res = await updateClient({
      client_id: client.id,
      company_name_ar: companyName,
      contact_name: contactName || null,
      contact_email: contactEmail,
      notes: notes || null,
      status,
      bank_name: bankName || null,
      bank_account: bankAccount || null,
      bank_iban: bankIban || null,
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    startTransition(() => router.refresh())
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
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
    <section className="bg-white border border-teal-200 rounded-xl shadow-sm p-5 space-y-3">
      <h3 className="serif font-bold text-base text-slate-900">تعديل بيانات العميل</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">اسم الشركة *</label>
          <input className={inputCls} value={companyName} onChange={(e) => setCompanyName(e.target.value)} disabled={saving} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">جهة الاتصال</label>
          <input className={inputCls} value={contactName} onChange={(e) => setContactName(e.target.value)} disabled={saving} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">البريد الإلكتروني *</label>
          <input type="email" className={inputCls} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} disabled={saving} dir="ltr" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 mb-1 block">الحالة</label>
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'archived' | 'inactive')} disabled={saving}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-semibold text-slate-500 mb-1 block">ملاحظات</label>
          <textarea rows={3} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} />
        </div>
      </div>

      <div className="pt-3 border-t border-slate-100 space-y-2">
        <h4 className="serif font-bold text-sm text-slate-900">بنك المطور (الجهة الدافعة)</h4>
        <p className="text-[11px] text-slate-500">معلومات الحساب الذي يتم الصرف منه. هذه بيانات تخص العميل، وليست بيانات المستفيد المستخرجة من كل سند.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">اسم البنك</label>
            <input className={inputCls} value={bankName} onChange={(e) => setBankName(e.target.value)} disabled={saving} placeholder="مثلاً: بنك البلاد" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">رقم الحساب</label>
            <input className={inputCls} value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} disabled={saving} dir="ltr" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-slate-500 mb-1 block">الآيبان</label>
            <input className={inputCls} value={bankIban} onChange={(e) => setBankIban(e.target.value.toUpperCase())} disabled={saving} dir="ltr" placeholder="SA__ ____ ____ ____ ____ ____" />
          </div>
        </div>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <button type="button" onClick={onSave} disabled={saving} className="inline-flex items-center px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50">
          {saving ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
        <button type="button" onClick={() => { reset(); setOpen(false) }} disabled={saving} className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50">
          إلغاء
        </button>
      </div>
    </section>
  )
}
