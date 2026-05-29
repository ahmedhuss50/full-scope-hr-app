'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, X } from 'lucide-react'
import {
  createCaseByStaff,
  requestUploadUrl,
  registerUpload,
  finalizeStaffUpload,
} from './actions'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

export type DeveloperOption = { id: string; company_name_ar: string }
export type ProjectOption = { id: string; code: string; name_ar: string; developer_id: string | null }

export function NewCaseForm({
  developers,
  projects,
}: {
  developers: DeveloperOption[]
  projects: ProjectOption[]
}) {
  const router = useRouter()
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const [developerId, setDeveloperId] = useState<string>(developers[0]?.id ?? '')

  // Projects shown for the currently selected client: those tied to this
  // developer + any untied legacy projects (developer_id is null).
  const filteredProjects = useMemo(() => {
    if (!developerId) return projects
    return projects.filter(
      (p) => p.developer_id === developerId || p.developer_id === null
    )
  }, [developerId, projects])

  const [projectId, setProjectId] = useState<string>(
    filteredProjects[0]?.id ?? projects[0]?.id ?? ''
  )

  // If the picked developer changes and the currently selected project no
  // longer fits the filter, snap to the first valid one (or clear).
  function onDeveloperChange(newId: string) {
    setDeveloperId(newId)
    const stillValid = newId
      ? projects.some(
          (p) =>
            p.id === projectId &&
            (p.developer_id === newId || p.developer_id === null)
        )
      : true
    if (!stillValid) {
      const nextProjects = newId
        ? projects.filter((p) => p.developer_id === newId || p.developer_id === null)
        : projects
      setProjectId(nextProjects[0]?.id ?? '')
    }
  }
  const [voucherNumber, setVoucherNumber] = useState('')
  const [voucherDate, setVoucherDate] = useState(today)
  const [amountSar, setAmountSar] = useState('')
  const [notes, setNotes] = useState('')
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

    const amountNum = Number(amountSar)
    if (
      !developerId ||
      !projectId ||
      !voucherNumber.trim() ||
      !voucherDate ||
      !Number.isFinite(amountNum) ||
      amountNum <= 0 ||
      !file
    ) {
      setError('الرجاء تعبئة جميع الحقول المطلوبة.')
      return
    }

    setSubmitting(true)
    setUploadPct(null)
    try {
      // 1) Create case row.
      const create = await createCaseByStaff({
        developer_id: developerId,
        project_id: projectId,
        voucher_number_text: voucherNumber.trim(),
        voucher_date: voucherDate,
        amount_sar: amountNum,
        notes: notes.trim() || null,
      })
      if (!create.ok) {
        setError(create.error)
        setSubmitting(false)
        return
      }
      const caseId = create.case_id

      // 2) Get signed upload URL.
      const urlRes = await requestUploadUrl({
        case_id: caseId,
        filename: file.name,
        mime: file.type || 'application/pdf',
        size: file.size,
      })
      if (!urlRes.ok) {
        setError(urlRes.error)
        setSubmitting(false)
        return
      }

      // 3) PUT file to storage.
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

      // 4) Register upload.
      const reg = await registerUpload({
        case_id: caseId,
        storage_path: urlRes.storage_path,
        filename: file.name,
        size: file.size,
        mime: file.type || 'application/pdf',
      })
      if (!reg.ok) {
        setError(reg.error)
        setSubmitting(false)
        return
      }

      // 5) Finalize — audit log + email assigned employee.
      const fin = await finalizeStaffUpload({ case_id: caseId })
      if (!fin.ok) {
        setError(fin.error)
        setSubmitting(false)
        return
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
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} htmlFor="developer_id">العميل / المطور *</label>
          <select
            id="developer_id"
            required
            className={inputCls}
            value={developerId}
            onChange={(e) => onDeveloperChange(e.target.value)}
          >
            <option value="">—</option>
            {developers.map((d) => (
              <option key={d.id} value={d.id}>{d.company_name_ar}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="project_id">المشروع *</label>
          <select
            id="project_id"
            required
            className={inputCls}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">—</option>
            {filteredProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.code} — {p.name_ar}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} htmlFor="voucher_number">رقم سند الصرف *</label>
          <input
            id="voucher_number"
            required
            maxLength={60}
            className={inputCls}
            value={voucherNumber}
            onChange={(e) => setVoucherNumber(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="voucher_date">تاريخ سند الصرف *</label>
          <input
            id="voucher_date"
            type="date"
            required
            className={inputCls}
            value={voucherDate}
            onChange={(e) => setVoucherDate(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="amount_sar">المبلغ بالريال السعودي *</label>
        <input
          id="amount_sar"
          type="number"
          required
          min={0}
          step="0.01"
          className={inputCls}
          value={amountSar}
          onChange={(e) => setAmountSar(e.target.value)}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="notes">ملاحظات</label>
        <textarea
          id="notes"
          rows={3}
          className={inputCls}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="file">الملف الموحّد *</label>
        <label
          htmlFor="file"
          className="flex items-center justify-center gap-2 px-4 py-6 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 cursor-pointer hover:border-teal-400 hover:bg-teal-50/40 transition"
        >
          <Upload className="w-4 h-4 text-slate-500" aria-hidden="true" />
          <span className="text-sm font-semibold text-slate-700">اضغط لاختيار ملف PDF</span>
        </label>
        <input
          id="file"
          type="file"
          accept="application/pdf"
          onChange={onPickFile}
          className="hidden"
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
              type="button"
              onClick={() => setFile(null)}
              disabled={submitting}
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
          type="submit"
          disabled={submitting}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          {submitting ? 'جارٍ الإرسال…' : 'إرسال'}
        </button>
        <a
          href="/app/disbursements"
          className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          إلغاء
        </a>
      </div>
    </form>
  )
}
