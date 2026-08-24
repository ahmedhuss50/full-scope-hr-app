'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Check, X, Loader2 } from 'lucide-react'
import { addVendor } from './actions'

const inputCls =
  'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

type FormState = {
  name_ar: string
  service_category: string
  tax_number: string
  commercial_registration: string
  phone: string
  email: string
  iban: string
  references_text: string
  contact_person_name: string
  contact_person_phone: string
  notes: string
}

const emptyForm: FormState = {
  name_ar: '',
  service_category: '',
  tax_number: '',
  commercial_registration: '',
  phone: '',
  email: '',
  iban: '',
  references_text: '',
  contact_person_name: '',
  contact_person_phone: '',
  notes: '',
}

export function AddVendorForm({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setState(emptyForm)
    setError(null)
  }

  async function submit(closeAfter: boolean) {
    setError(null)
    setSaving(true)
    const res = await addVendor({
      project_id: projectId,
      name_ar: state.name_ar,
      service_category: state.service_category || null,
      tax_number: state.tax_number || null,
      commercial_registration: state.commercial_registration || null,
      phone: state.phone || null,
      email: state.email || null,
      iban: state.iban || null,
      references_text: state.references_text || null,
      contact_person_name: state.contact_person_name || null,
      contact_person_phone: state.contact_person_phone || null,
      notes: state.notes || null,
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    reset()
    if (closeAfter) setOpen(false)
    startTransition(() => router.refresh())
  }

  if (!open) {
    return (
      <div className="flex justify-start">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 text-xs font-bold shadow-sm transition"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          إضافة مورد
        </button>
      </div>
    )
  }

  return (
    <section className="bg-white border border-teal-200 rounded-xl shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="serif font-black text-lg text-slate-900">إضافة مورد جديد</h2>
        <button
          type="button"
          onClick={() => {
            reset()
            setOpen(false)
          }}
          disabled={saving}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          إغلاق
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Field label="اسم المورد *">
          <input
            className={inputCls}
            value={state.name_ar}
            onChange={(e) => setState({ ...state, name_ar: e.target.value })}
            disabled={saving}
            placeholder="مثلاً: مؤسسة الفجر للمقاولات"
          />
        </Field>
        <Field label="فئة الخدمة">
          <input
            className={inputCls}
            value={state.service_category}
            onChange={(e) => setState({ ...state, service_category: e.target.value })}
            disabled={saving}
            placeholder="مقاول رئيسي، كهرباء، تسويق…"
          />
        </Field>
        <Field label="الرقم الضريبي">
          <input
            className={inputCls}
            value={state.tax_number}
            onChange={(e) => setState({ ...state, tax_number: e.target.value })}
            disabled={saving}
            dir="ltr"
          />
        </Field>
        <Field label="السجل التجاري">
          <input
            className={inputCls}
            value={state.commercial_registration}
            onChange={(e) => setState({ ...state, commercial_registration: e.target.value })}
            disabled={saving}
            dir="ltr"
          />
        </Field>
        <Field label="الجوال">
          <input
            className={inputCls}
            value={state.phone}
            onChange={(e) => setState({ ...state, phone: e.target.value })}
            disabled={saving}
            dir="ltr"
          />
        </Field>
        <Field label="البريد الإلكتروني">
          <input
            className={inputCls}
            value={state.email}
            onChange={(e) => setState({ ...state, email: e.target.value })}
            disabled={saving}
            dir="ltr"
            type="email"
          />
        </Field>
        <Field label="IBAN">
          <input
            className={inputCls}
            value={state.iban}
            onChange={(e) => setState({ ...state, iban: e.target.value.toUpperCase() })}
            disabled={saving}
            dir="ltr"
            placeholder="SA__ ____ ____ ____ ____ ____"
          />
        </Field>
        <Field label="اسم مسؤول التواصل">
          <input
            className={inputCls}
            value={state.contact_person_name}
            onChange={(e) => setState({ ...state, contact_person_name: e.target.value })}
            disabled={saving}
          />
        </Field>
        <Field label="جوال مسؤول التواصل">
          <input
            className={inputCls}
            value={state.contact_person_phone}
            onChange={(e) => setState({ ...state, contact_person_phone: e.target.value })}
            disabled={saving}
            dir="ltr"
          />
        </Field>
        <Field label="المراجع (مشاريع سابقة)" wide>
          <textarea
            className={inputCls + ' min-h-[60px]'}
            value={state.references_text}
            onChange={(e) => setState({ ...state, references_text: e.target.value })}
            disabled={saving}
            rows={2}
          />
        </Field>
        <Field label="ملاحظات" wide>
          <textarea
            className={inputCls + ' min-h-[60px]'}
            value={state.notes}
            onChange={(e) => setState({ ...state, notes: e.target.value })}
            disabled={saving}
            rows={2}
          />
        </Field>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          {saving ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-teal-200 bg-teal-50 text-teal-800 text-xs font-semibold hover:bg-teal-100 transition disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          حفظ وإضافة مورد آخر
        </button>
        <button
          type="button"
          onClick={() => {
            reset()
            setOpen(false)
          }}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
        >
          إلغاء
        </button>
      </div>
    </section>
  )
}

function Field({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : ''}>
      <label className="text-[11px] font-semibold text-slate-500 mb-1 block">{label}</label>
      {children}
    </div>
  )
}
