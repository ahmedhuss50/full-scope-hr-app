'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Check, X, Loader2 } from 'lucide-react'
import { updateVendor } from './actions'
import type { VendorRow } from './page'

const inputCls =
  'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

/**
 * Toggles between a view render (passed in as `renderView`) and an inline
 * edit form. Only exposes the edit button when `canEdit` is true.
 *
 * Lives in the Name column of the vendor table row so both label + contact
 * meta can be edited in one place.
 */
export function EditVendorRow({
  vendor,
  canEdit,
  renderView,
}: {
  vendor: VendorRow
  canEdit: boolean
  renderView: () => React.ReactNode
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState({
    name_ar: vendor.name_ar,
    service_category: vendor.service_category ?? '',
    tax_number: vendor.tax_number ?? '',
    commercial_registration: vendor.commercial_registration ?? '',
    phone: vendor.phone ?? '',
    email: vendor.email ?? '',
    iban: vendor.iban ?? '',
    references_text: vendor.references_text ?? '',
    contact_person_name: vendor.contact_person_name ?? '',
    contact_person_phone: vendor.contact_person_phone ?? '',
    notes: vendor.notes ?? '',
  })

  async function save() {
    setError(null)
    setSaving(true)
    const res = await updateVendor({
      id: vendor.id,
      patch: {
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
      },
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setEditing(false)
    startTransition(() => router.refresh())
  }

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{renderView()}</div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="تعديل"
            className="inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-md text-slate-400 hover:text-teal-700 hover:bg-teal-50 transition"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label="اسم المورد *">
          <input
            className={inputCls}
            value={state.name_ar}
            onChange={(e) => setState({ ...state, name_ar: e.target.value })}
            disabled={saving}
          />
        </Field>
        <Field label="فئة الخدمة">
          <input
            className={inputCls}
            value={state.service_category}
            onChange={(e) => setState({ ...state, service_category: e.target.value })}
            disabled={saving}
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
        <Field label="المراجع" wide>
          <textarea
            className={inputCls + ' min-h-[50px]'}
            value={state.references_text}
            onChange={(e) => setState({ ...state, references_text: e.target.value })}
            disabled={saving}
            rows={2}
          />
        </Field>
        <Field label="ملاحظات" wide>
          <textarea
            className={inputCls + ' min-h-[50px]'}
            value={state.notes}
            onChange={(e) => setState({ ...state, notes: e.target.value })}
            disabled={saving}
            rows={2}
          />
        </Field>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-teal-600 text-white text-[11px] font-semibold hover:bg-teal-700 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="w-3 h-3" aria-hidden="true" />
          )}
          {saving ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false)
            setError(null)
          }}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <X className="w-3 h-3" aria-hidden="true" />
          إلغاء
        </button>
      </div>
    </div>
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
    <div className={wide ? 'sm:col-span-2' : ''}>
      <label className="text-[10px] font-semibold text-slate-500 mb-0.5 block">{label}</label>
      {children}
    </div>
  )
}
