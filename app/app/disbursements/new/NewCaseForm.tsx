'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, X, Sparkles, PenLine } from 'lucide-react'
import {
  createCaseByStaff,
  requestUploadUrl,
  registerUpload,
  finalizeStaffUpload,
} from './actions'
import { BeneficiaryCapacityPicker } from '@/components/BeneficiaryCapacityPicker'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

export type DeveloperOption = { id: string; company_name_ar: string }
export type ProjectOption = { id: string; code: string; name_ar: string; developer_id: string | null }
export type DisbursementTypeOption = { code: string; label: string }
export type BeneficiaryOption = { id: string; name_ar: string; category: string | null; project_id: string }

/**
 * New-case form with two modes:
 *   1. AI mode  — pick client/project, upload PDF, AI extracts the rest.
 *   2. Manual mode — fill in every field manually; PDF optional.
 *
 * Both modes call `createCaseByStaff` (which now accepts manual fields too).
 * If a PDF is picked, the upload chain runs after case creation.
 */
export function NewCaseForm({
  developers,
  projects,
  disbursementTypes,
  beneficiaries,
  defaultDeveloperId = null,
  defaultProjectId = null,
}: {
  developers: DeveloperOption[]
  projects: ProjectOption[]
  disbursementTypes: DisbursementTypeOption[]
  beneficiaries: BeneficiaryOption[]
  defaultDeveloperId?: string | null
  defaultProjectId?: string | null
}) {
  const router = useRouter()

  const [mode, setMode] = useState<'ai' | 'manual'>('ai')

  const [developerId, setDeveloperId] = useState<string>(
    defaultDeveloperId ?? developers[0]?.id ?? '',
  )

  const filteredProjects = useMemo(() => {
    if (!developerId) return projects
    return projects.filter(
      (p) => p.developer_id === developerId || p.developer_id === null,
    )
  }, [developerId, projects])

  const [projectId, setProjectId] = useState<string>(
    defaultProjectId ?? filteredProjects[0]?.id ?? projects[0]?.id ?? '',
  )

  function onDeveloperChange(newId: string) {
    setDeveloperId(newId)
    const stillValid = newId
      ? projects.some(
          (p) =>
            p.id === projectId &&
            (p.developer_id === newId || p.developer_id === null),
        )
      : true
    if (!stillValid) {
      const nextProjects = newId
        ? projects.filter((p) => p.developer_id === newId || p.developer_id === null)
        : projects
      setProjectId(nextProjects[0]?.id ?? '')
    }
  }

  // Manual fields
  const [voucherNo, setVoucherNo] = useState('')
  const [voucherDate, setVoucherDate] = useState('')
  const [amount, setAmount] = useState('')
  const [dsbTypeCode, setDsbTypeCode] = useState('')
  const [beneficiaryVendorId, setBeneficiaryVendorId] = useState<string>('')
  const [beneficiaryName, setBeneficiaryName] = useState('')
  const [beneficiaryCapacity, setBeneficiaryCapacity] = useState('')
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [vatAmount, setVatAmount] = useState('')
  const [notes, setNotes] = useState('')

  // Filter beneficiaries to the currently-selected project.
  const projectBeneficiaries = useMemo(
    () => beneficiaries.filter((b) => b.project_id === projectId),
    [beneficiaries, projectId],
  )

  // When user picks a vendor from the dropdown, auto-fill the name +
  // capacity so the case is linked properly (fills vendor_id on save).
  function onBeneficiaryChange(vendorId: string) {
    setBeneficiaryVendorId(vendorId)
    if (!vendorId) return
    const v = beneficiaries.find((b) => b.id === vendorId)
    if (v) {
      setBeneficiaryName(v.name_ar)
      if (v.category && !beneficiaryCapacity) setBeneficiaryCapacity(v.category)
    }
  }

  // If the user switches projects, clear the vendor selection.
  function onDeveloperOrProjectChange() {
    setBeneficiaryVendorId('')
  }

  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const picked = e.target.files?.[0]
    if (!picked) return
    if (picked.size > MAX_FILE_SIZE) {
      setError(`الحجم يتجاوز الحد الأقصى (50 ميغابايت): ${picked.name}`)
      return
    }
    setFile(picked)
    e.target.value = ''
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!developerId || !projectId) {
      setError('يرجى اختيار العميل والمشروع.')
      return
    }
    if (mode === 'ai' && !file) {
      setError('يرجى اختيار ملف PDF (أو التبديل إلى الإدخال اليدوي).')
      return
    }

    setSubmitting(true)
    setUploadPct(null)
    try {
      // 1) Create case row. Include manual fields when in manual mode.
      const create = await createCaseByStaff({
        developer_id: developerId,
        project_id: projectId,
        ...(mode === 'manual' ? {
          voucher_number_text: voucherNo.trim() || null,
          voucher_date: voucherDate || null,
          amount_sar: amount ? Number(amount) : null,
          notes: notes.trim() || null,
          disbursement_type_code: dsbTypeCode || null,
          beneficiary_name_ar: beneficiaryName.trim() || null,
          beneficiary_capacity_ar: beneficiaryCapacity.trim() || null,
          invoice_amount_sar: invoiceAmount ? Number(invoiceAmount) : null,
          vat_amount_sar: vatAmount ? Number(vatAmount) : null,
          vendor_id: beneficiaryVendorId || null,
        } : {}),
      })
      if (!create.ok) {
        setError(create.error)
        setSubmitting(false)
        return
      }
      const caseId = create.case_id

      // 2) If a PDF was picked, run the upload chain.
      if (file) {
        const urlRes = await requestUploadUrl({
          case_id: caseId,
          filename: file.name,
          mime: file.type || 'application/pdf',
          size: file.size,
        })
        if (!urlRes.ok) { setError(urlRes.error); setSubmitting(false); return }

        setUploadPct(0)
        const putRes = await fetch(urlRes.signed_url, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type || 'application/pdf',
            'x-upsert': 'true',
          },
        })
        setUploadPct(100)
        if (!putRes.ok) {
          setError(`فشل رفع الملف (HTTP ${putRes.status}).`)
          setSubmitting(false)
          return
        }

        const reg = await registerUpload({
          case_id: caseId,
          storage_path: urlRes.storage_path,
          filename: file.name,
          size: file.size,
          mime: file.type || 'application/pdf',
        })
        if (!reg.ok) { setError(reg.error); setSubmitting(false); return }

        const fin = await finalizeStaffUpload({ case_id: caseId })
        if (!fin.ok) { setError(fin.error); setSubmitting(false); return }
      }

      router.push(`/app/disbursements/${caseId}?created=1`)
    } catch (err) {
      console.error('[NewCaseForm] submit threw', err)
      setError(err instanceof Error ? err.message : 'تعذّر إنشاء سند الصرف.')
      setSubmitting(false)
    }
  }

  const labelCls = 'text-sm font-semibold text-slate-700 mb-1 block'
  const inputCls =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500'

  return (
    <form onSubmit={onSubmit} className="space-y-5 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      {/* Mode toggle */}
      <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setMode('ai')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition ${
            mode === 'ai'
              ? 'bg-teal-600 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" /> ذكاء اصطناعي (PDF)
        </button>
        <button
          type="button"
          onClick={() => setMode('manual')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition ${
            mode === 'manual'
              ? 'bg-teal-600 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <PenLine className="w-3.5 h-3.5" /> إدخال يدوي
        </button>
      </div>

      {mode === 'ai' && (
        <div className="flex items-start gap-2 rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2.5 text-xs text-teal-800">
          <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            اختر العميل والمشروع، ثم ارفع ملف PDF. سيقوم الذكاء الاصطناعي باستخراج بيانات السند تلقائيًا (رقم السند، التاريخ، المبلغ، نوع الصرف، وغيرها) وعرضها على صفحة الطلب.
          </span>
        </div>
      )}
      {mode === 'manual' && (
        <div className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2.5 text-xs text-indigo-800">
          <PenLine className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            املأ الحقول يدويًا. يمكنك اختيار PDF إن أردت إرفاقه، أو الاكتفاء بالبيانات فقط.
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} htmlFor="developer_id">العميل / المطور *</label>
          <select id="developer_id" required className={inputCls}
            value={developerId} onChange={(e) => { onDeveloperChange(e.target.value); onDeveloperOrProjectChange() }}>
            <option value="">—</option>
            {developers.map((d) => (
              <option key={d.id} value={d.id}>{d.company_name_ar}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="project_id">المشروع *</label>
          <select id="project_id" required className={inputCls}
            value={projectId} onChange={(e) => { setProjectId(e.target.value); onDeveloperOrProjectChange() }}>
            <option value="">—</option>
            {filteredProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.code} — {p.name_ar}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Manual-mode fields */}
      {mode === 'manual' && (
        <div className="space-y-4 border-t border-slate-200 pt-4">
          <h2 className="text-sm font-bold text-slate-800">بيانات سند الصرف</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls} htmlFor="voucher_no">رقم السند</label>
              <input id="voucher_no" className={inputCls}
                value={voucherNo} onChange={(e) => setVoucherNo(e.target.value)}
                placeholder="مثال: 2026-045" />
            </div>
            <div>
              <label className={labelCls} htmlFor="voucher_date">تاريخ السند</label>
              <input id="voucher_date" type="date" className={inputCls} dir="ltr"
                value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} />
            </div>
            <div>
              <label className={labelCls} htmlFor="amount">المبلغ الإجمالي (ر.س)</label>
              <input id="amount" type="number" step="0.01" min={0} className={inputCls}
                value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className={labelCls} htmlFor="dsb_type">نوع الصرف</label>
              <select id="dsb_type" className={inputCls}
                value={dsbTypeCode} onChange={(e) => setDsbTypeCode(e.target.value)}>
                <option value="">— اختر —</option>
                {disbursementTypes.map((t) => (
                  <option key={t.code} value={t.code}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="ben_vendor">اسم المستفيد *</label>
              <select
                id="ben_vendor"
                className={inputCls}
                value={beneficiaryVendorId}
                onChange={(e) => onBeneficiaryChange(e.target.value)}
              >
                <option value="">— اختر من موردي المشروع —</option>
                {projectBeneficiaries.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name_ar}{b.category ? ` · ${b.category}` : ''}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-500 mt-1">
                يربط السند بصفحة المورد لعرض النشاط والحسم من الدفعة المقدّمة تلقائيًا.
                {projectBeneficiaries.length === 0 && projectId && (
                  <> لا يوجد موردون لهذا المشروع بعد.{' '}
                    <a href={`/app/disbursements/admin/projects/${projectId}/vendors`}
                       className="text-teal-700 font-semibold hover:underline">أضِف موردًا</a>.
                  </>
                )}
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="ben_name">اسم المستفيد (نص حر — إذا لم يكن ضمن الموردين)</label>
              <input id="ben_name" className={inputCls}
                value={beneficiaryName} onChange={(e) => { setBeneficiaryName(e.target.value); if (beneficiaryVendorId) setBeneficiaryVendorId('') }}
                placeholder="اترك فارغًا إذا اخترت من الأعلى" />
            </div>
            <div>
              <label className={labelCls}>صفة المستفيد</label>
              <BeneficiaryCapacityPicker value={beneficiaryCapacity} onChange={setBeneficiaryCapacity} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="inv_amount">قيمة الفاتورة قبل الضريبة</label>
              <input id="inv_amount" type="number" step="0.01" min={0} className={inputCls}
                value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} />
            </div>
            <div>
              <label className={labelCls} htmlFor="vat_amount">ضريبة القيمة المضافة</label>
              <input id="vat_amount" type="number" step="0.01" min={0} className={inputCls}
                value={vatAmount} onChange={(e) => setVatAmount(e.target.value)} />
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="notes">ملاحظات</label>
            <textarea id="notes" className={inputCls + ' min-h-[80px]'} rows={3}
              value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="أي ملاحظات إضافية" />
          </div>
        </div>
      )}

      {/* File upload — required in AI mode, optional in manual */}
      <div>
        <label className={labelCls} htmlFor="file">
          {mode === 'ai' ? 'الملف الموحّد *' : 'الملف الموحّد (اختياري)'}
        </label>
        <label
          htmlFor="file"
          className="flex items-center justify-center gap-2 px-4 py-8 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 cursor-pointer hover:border-teal-400 hover:bg-teal-50/40 transition"
        >
          <Upload className="w-5 h-5 text-slate-500" aria-hidden="true" />
          <span className="text-sm font-semibold text-slate-700">
            {file ? 'استبدال الملف' : 'اضغط لاختيار ملف PDF'}
          </span>
        </label>
        <input
          id="file" type="file" accept="application/pdf"
          onChange={onPickFile} className="hidden"
        />
        {file && (
          <div className="mt-3 flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-white">
            <FileText className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-900 truncate">{file.name}</div>
              <div className="text-[11px] text-slate-500 font-mono">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </div>
            </div>
            <button
              type="button" onClick={() => setFile(null)} disabled={submitting}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition disabled:opacity-40"
              aria-label="إزالة الملف"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {uploadPct !== null && submitting && (
          <div className="mt-2 text-xs text-slate-500">جاري الرفع {uploadPct}%</div>
        )}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit" disabled={submitting}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          {submitting
            ? 'جارٍ الحفظ…'
            : mode === 'manual'
              ? 'حفظ سند الصرف'
              : 'رفع وإرسال للمراجعة'}
        </button>
        <a href="/app/disbursements" className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
          إلغاء
        </a>
      </div>
    </form>
  )
}
