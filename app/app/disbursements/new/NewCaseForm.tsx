'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, X, Sparkles } from 'lucide-react'
import {
  createCaseByStaff,
  requestUploadUrl,
  registerUpload,
  finalizeStaffUpload,
} from './actions'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

export type DeveloperOption = { id: string; company_name_ar: string }
export type ProjectOption = { id: string; code: string; name_ar: string; developer_id: string | null }

/**
 * Minimal new-case form.
 *
 * The reviewer picks a client + a project, attaches the PDF, and submits.
 * Every other field — voucher number, voucher date, amount, delivery date,
 * notes — is left empty on insert and filled in by the AI extraction
 * pipeline (`/api/dsb-extract`) after upload. If the AI misses or gets
 * something wrong, the case page has an inline "تعديل البيانات" form for
 * manual correction.
 */
export function NewCaseForm({
  developers,
  projects,
  defaultDeveloperId = null,
  defaultProjectId = null,
}: {
  developers: DeveloperOption[]
  projects: ProjectOption[]
  defaultDeveloperId?: string | null
  defaultProjectId?: string | null
}) {
  const router = useRouter()

  const [developerId, setDeveloperId] = useState<string>(
    defaultDeveloperId ?? developers[0]?.id ?? '',
  )

  const filteredProjects = useMemo(() => {
    if (!developerId) return projects
    return projects.filter(
      (p) => p.developer_id === developerId || p.developer_id === null
    )
  }, [developerId, projects])

  const [projectId, setProjectId] = useState<string>(
    defaultProjectId ?? filteredProjects[0]?.id ?? projects[0]?.id ?? ''
  )

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
    if (!file) {
      setError('يرجى اختيار ملف PDF.')
      return
    }

    setSubmitting(true)
    setUploadPct(null)
    try {
      // 1) Create empty case row — AI will fill the metadata.
      const create = await createCaseByStaff({
        developer_id: developerId,
        project_id: projectId,
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

      // 5) Finalize — audit log + fire AI extraction + email assigned employee.
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
      <div className="flex items-start gap-2 rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2.5 text-xs text-teal-800">
        <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          اختر العميل والمشروع، ثم ارفع ملف PDF. سيقوم الذكاء الاصطناعي باستخراج بيانات السند تلقائيًا (رقم السند، التاريخ، المبلغ، نوع الصرف، وغيرها) وعرضها على صفحة الطلب.
        </span>
      </div>

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

      <div>
        <label className={labelCls} htmlFor="file">الملف الموحّد *</label>
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
          {submitting ? 'جارٍ الرفع…' : 'رفع وإرسال للمراجعة'}
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
