'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Check, X, Loader2, Trash2, Paperclip } from 'lucide-react'
import {
  addVendor,
  requestVendorContractUploadUrl,
  attachContractPdf,
  requestVendorDocUploadUrl,
  attachVendorDoc,
} from './actions'

/**
 * Inline contract draft — one row in the contracts table inside the
 * AddVendorForm. Sent as part of the addVendor payload; server inserts
 * them into dsb_vendor_contracts after the vendor row lands.
 */
type ContractDraft = {
  contract_number:        string
  disbursement_nature:    string
  amount_before_tax_sar:  string
  vat_sar:                string
  start_date:             string
  end_date:               string
}
const emptyContract: ContractDraft = {
  contract_number: '', disbursement_nature: '',
  amount_before_tax_sar: '', vat_sar: '',
  start_date: '', end_date: '',
}

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
  bank_name: string
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
  bank_name: '',
  references_text: '',
  contact_person_name: '',
  contact_person_phone: '',
  notes: '',
}

export function AddVendorForm({
  projectId,
  categoryOptions,
}: {
  projectId: string
  // Tenant-managed list from /admin/settings/lists. When empty the picker
  // falls back to free-text entry so we don't block the form.
  categoryOptions: string[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<FormState>(emptyForm)
  // Inline contracts — start with a single empty row so the table renders
  // ready to fill. Owners can add more or delete unused rows.
  const [contracts, setContracts] = useState<ContractDraft[]>([{ ...emptyContract }])
  // Files kept separately from ContractDraft (File isn't serializable and
  // we send drafts to a server action). Array is index-aligned with
  // `contracts` — file[i] belongs to contracts[i]. Null when no file picked.
  const [contractFiles, setContractFiles] = useState<Array<File | null>>([null])
  // Per-vendor document attachments (migration 072). Uploaded via the same
  // signed-URL flow as contract PDFs after the vendor lands.
  const [vatCertFile,       setVatCertFile]       = useState<File | null>(null)
  const [crFile,            setCrFile]            = useState<File | null>(null)
  const [ibanOwnershipFile, setIbanOwnershipFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setState(emptyForm)
    setContracts([{ ...emptyContract }])
    setContractFiles([null])
    setVatCertFile(null)
    setCrFile(null)
    setIbanOwnershipFile(null)
    setError(null)
    setUploadStatus(null)
  }
  function updateContract(idx: number, patch: Partial<ContractDraft>) {
    setContracts((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  }
  function addContractRow() {
    setContracts((prev) => [...prev, { ...emptyContract }])
    setContractFiles((prev) => [...prev, null])
  }
  function removeContractRow(idx: number) {
    setContracts((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)))
    setContractFiles((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)))
  }
  function setContractFile(idx: number, file: File | null) {
    setContractFiles((prev) => prev.map((f, i) => (i === idx ? file : f)))
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
      bank_name: state.bank_name || null,
      references_text: state.references_text || null,
      contact_person_name: state.contact_person_name || null,
      contact_person_phone: state.contact_person_phone || null,
      notes: state.notes || null,
      // Numeric fields go through Number() and get nulled when blank/NaN.
      contracts: contracts.map((c) => ({
        contract_number:       c.contract_number.trim()     || null,
        disbursement_nature:   c.disbursement_nature.trim() || null,
        amount_before_tax_sar: c.amount_before_tax_sar.trim() && Number.isFinite(Number(c.amount_before_tax_sar))
          ? Number(c.amount_before_tax_sar) : null,
        vat_sar: c.vat_sar.trim() && Number.isFinite(Number(c.vat_sar))
          ? Number(c.vat_sar) : null,
        start_date: c.start_date || null,
        end_date:   c.end_date   || null,
      })),
    })
    if (!res.ok) {
      setSaving(false)
      setError(res.error)
      return
    }

    // Upload any attached contract PDFs. Loop is sequential — a handful of
    // contracts per vendor is normal, and failed uploads shouldn't block
    // successful ones. Errors are collected and shown but don't undo the
    // vendor create.
    const uploadErrors: string[] = []
    const filesToUpload = contractFiles
      .map((file, i) => ({ file, contractId: res.contract_ids[i] ?? null, i }))
      .filter((x) => x.file && x.contractId)
    for (let n = 0; n < filesToUpload.length; n++) {
      const { file, contractId, i } = filesToUpload[n]!
      if (!file || !contractId) continue
      setUploadStatus(`جارٍ رفع ملف العقد ${n + 1} من ${filesToUpload.length}…`)
      try {
        const urlRes = await requestVendorContractUploadUrl({
          vendor_id: res.id,
          filename: file.name,
          size: file.size,
        })
        if (!urlRes.ok) { uploadErrors.push(`صف ${i + 1}: ${urlRes.error}`); continue }
        const putRes = await fetch(urlRes.signed_url, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/pdf' },
        })
        if (!putRes.ok) { uploadErrors.push(`صف ${i + 1}: فشل رفع الملف (${putRes.status}).`); continue }
        const attachRes = await attachContractPdf({
          contract_id: contractId,
          storage_path: urlRes.storage_path,
          filename: file.name,
          size: file.size,
        })
        if (!attachRes.ok) uploadErrors.push(`صف ${i + 1}: ${attachRes.error}`)
      } catch (e) {
        uploadErrors.push(`صف ${i + 1}: خطأ غير متوقع (${(e as Error).message}).`)
      }
    }
    // Per-vendor doc uploads (VAT cert + Commercial Registration).
    for (const [kind, file, label] of [
      ['vat',            vatCertFile,       'الشهادة الضريبية'],
      ['cr',             crFile,             'السجل التجاري'],
      ['iban_ownership', ibanOwnershipFile,  'شهادة ملكية IBAN'],
    ] as const) {
      if (!file) continue
      setUploadStatus(`جارٍ رفع ${label}…`)
      try {
        const urlRes = await requestVendorDocUploadUrl({
          vendor_id: res.id,
          kind,
          filename: file.name,
          size:     file.size,
        })
        if (!urlRes.ok) { uploadErrors.push(`${label}: ${urlRes.error}`); continue }
        const putRes = await fetch(urlRes.signed_url, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/pdf' },
        })
        if (!putRes.ok) { uploadErrors.push(`${label}: فشل رفع الملف (${putRes.status}).`); continue }
        const attachRes = await attachVendorDoc({
          vendor_id: res.id,
          kind,
          storage_path: urlRes.storage_path,
          filename: file.name,
          size: file.size,
        })
        if (!attachRes.ok) uploadErrors.push(`${label}: ${attachRes.error}`)
      } catch (e) {
        uploadErrors.push(`${label}: خطأ غير متوقع (${(e as Error).message}).`)
      }
    }

    setSaving(false)
    setUploadStatus(null)
    if (uploadErrors.length > 0) {
      // Vendor + contract rows landed; only the file uploads had issues.
      // Surface the details but don't wipe the form so the owner can retry.
      setError(`تم إنشاء المورد لكن هناك مشاكل في رفع الملفات:\n${uploadErrors.join('\n')}`)
      startTransition(() => router.refresh())
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
          {categoryOptions.length > 0 ? (
            // Dropdown sourced from القوائم والنسب. Include a blank option
            // so the field stays optional, and if the vendor's current
            // category isn't in the list (legacy free-text value) we still
            // render it as an option so it doesn't disappear on save.
            <select
              className={inputCls}
              value={state.service_category}
              onChange={(e) => setState({ ...state, service_category: e.target.value })}
              disabled={saving}
            >
              <option value="">— بدون —</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              {state.service_category && !categoryOptions.includes(state.service_category) && (
                <option value={state.service_category}>{state.service_category} (قديم)</option>
              )}
            </select>
          ) : (
            // Fallback when the tenant hasn't added any categories yet —
            // keeps the form usable and lets legacy free-text stay.
            <input
              className={inputCls}
              value={state.service_category}
              onChange={(e) => setState({ ...state, service_category: e.target.value })}
              disabled={saving}
              placeholder="أضِف تصنيفات من القوائم والنسب لتظهر كقائمة منسدلة"
            />
          )}
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
        <Field label="إرفاق الشهادة الضريبية (PDF)">
          <DocFileInput
            file={vatCertFile}
            onChange={setVatCertFile}
            disabled={saving}
            placeholder="اختر ملف شهادة الضريبة"
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
        <Field label="إرفاق السجل التجاري (PDF)">
          <DocFileInput
            file={crFile}
            onChange={setCrFile}
            disabled={saving}
            placeholder="اختر ملف السجل التجاري"
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
        <Field label="اسم البنك">
          <input
            className={inputCls}
            value={state.bank_name}
            onChange={(e) => setState({ ...state, bank_name: e.target.value })}
            disabled={saving}
            placeholder="مثلاً: بنك الرياض"
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
        <Field label="إرفاق شهادة ملكية IBAN (PDF)">
          <DocFileInput
            file={ibanOwnershipFile}
            onChange={setIbanOwnershipFile}
            disabled={saving}
            placeholder="اختر ملف شهادة ملكية IBAN"
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

      {/* العقود — inline table. Owner can add multiple contracts as part of
          creating the vendor. Blank rows are dropped server-side; if a row
          has any value it's saved with the server computing total = before +
          vat automatically. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="serif font-bold text-sm text-slate-900">العقود</h3>
          <button
            type="button"
            onClick={addContractRow}
            disabled={saving}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-teal-200 bg-teal-50 text-teal-800 text-[11px] font-semibold hover:bg-teal-100 transition disabled:opacity-50"
          >
            <Plus className="w-3 h-3" aria-hidden="true" />
            إضافة عقد
          </button>
        </div>
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-right">
              <tr>
                <th className="px-2 py-2 font-semibold text-slate-500">العقد</th>
                <th className="px-2 py-2 font-semibold text-slate-500">طبيعة المصروف</th>
                <th className="px-2 py-2 font-semibold text-slate-500">إجمالي قيمة العقد قبل الضريبة</th>
                <th className="px-2 py-2 font-semibold text-slate-500">الضريبة</th>
                <th className="px-2 py-2 font-semibold text-slate-500">تاريخ البداية</th>
                <th className="px-2 py-2 font-semibold text-slate-500">تاريخ الانتهاء</th>
                <th className="px-2 py-2 font-semibold text-slate-500">إرفاق العقد</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contracts.map((c, i) => (
                <tr key={i} className="align-top">
                  <td className="p-1">
                    <input
                      className={inputCls}
                      value={c.contract_number}
                      onChange={(e) => updateContract(i, { contract_number: e.target.value })}
                      disabled={saving}
                      placeholder="رقم العقد"
                    />
                  </td>
                  <td className="p-1">
                    <input
                      className={inputCls}
                      value={c.disbursement_nature}
                      onChange={(e) => updateContract(i, { disbursement_nature: e.target.value })}
                      disabled={saving}
                      placeholder="مثال: مقاولات إنشائية"
                    />
                  </td>
                  <td className="p-1">
                    <input
                      className={inputCls}
                      type="number"
                      step="0.01"
                      value={c.amount_before_tax_sar}
                      onChange={(e) => updateContract(i, { amount_before_tax_sar: e.target.value })}
                      disabled={saving}
                      dir="ltr"
                      placeholder="0.00"
                    />
                  </td>
                  <td className="p-1">
                    <input
                      className={inputCls}
                      type="number"
                      step="0.01"
                      value={c.vat_sar}
                      onChange={(e) => updateContract(i, { vat_sar: e.target.value })}
                      disabled={saving}
                      dir="ltr"
                      placeholder="0.00"
                    />
                  </td>
                  <td className="p-1">
                    <input
                      className={inputCls}
                      type="date"
                      value={c.start_date}
                      onChange={(e) => updateContract(i, { start_date: e.target.value })}
                      disabled={saving}
                      dir="ltr"
                    />
                  </td>
                  <td className="p-1">
                    <input
                      className={inputCls}
                      type="date"
                      value={c.end_date}
                      onChange={(e) => updateContract(i, { end_date: e.target.value })}
                      disabled={saving}
                      dir="ltr"
                    />
                  </td>
                  <td className="p-1">
                    {/* Contract PDF attach — uploaded to storage AFTER the
                        vendor + contracts land, using the existing
                        signed-URL flow scoped to the new vendor. */}
                    <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-700 hover:text-teal-700">
                      <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />
                      <span className="truncate max-w-[8rem]">
                        {contractFiles[i]?.name ?? 'اختر ملفًا'}
                      </span>
                      <input
                        type="file"
                        accept=".pdf,application/pdf"
                        className="sr-only"
                        onChange={(e) => setContractFile(i, e.target.files?.[0] ?? null)}
                        disabled={saving}
                      />
                    </label>
                    {contractFiles[i] && (
                      <button
                        type="button"
                        onClick={() => setContractFile(i, null)}
                        disabled={saving}
                        title="إزالة الملف"
                        className="ms-1 text-red-600 hover:text-red-800 text-[11px]"
                      >
                        <X className="w-3 h-3 inline" aria-hidden="true" />
                      </button>
                    )}
                  </td>
                  <td className="p-1 text-center">
                    <button
                      type="button"
                      onClick={() => removeContractRow(i)}
                      disabled={saving || contracts.length === 1}
                      title="حذف الصف"
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500">
          الصفوف الفارغة تُتَجاهل عند الحفظ. المجموع مع الضريبة يُحسَب تلقائيًا (قبل الضريبة + الضريبة).
        </p>
      </div>

      {uploadStatus && (
        <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800 inline-flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
          {uploadStatus}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 whitespace-pre-line">
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

/**
 * DocFileInput — small helper for the two per-vendor doc attachments
 * (VAT cert, commercial registration). Visually matches the other Field
 * inputs so the row heights line up.
 */
function DocFileInput({
  file,
  onChange,
  disabled,
  placeholder,
}: {
  file: File | null
  onChange: (f: File | null) => void
  disabled: boolean
  placeholder: string
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex-1 inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50 disabled:bg-slate-50 truncate">
        <Paperclip className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
        <span className="truncate">{file?.name ?? placeholder}</span>
        <input
          type="file"
          accept=".pdf,application/pdf"
          className="sr-only"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          disabled={disabled}
        />
      </label>
      {file && (
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          title="إزالة الملف"
          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-red-600 hover:bg-red-50 shrink-0"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
