'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Upload, Sparkles, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import {
  createCaseByStaff,
  requestUploadUrl,
  registerUpload,
  finalizeStaffUpload,
} from '../../../new/actions'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

/**
 * One-click case upload scoped to a single project.
 *
 * Reuses the same 4-step server action pipeline as /app/disbursements/new
 * (create → sign upload URL → PUT → register → finalize + fire AI), but with
 * the developer + project pre-selected from the project page. The reviewer
 * doesn't have to pick anything — just attach the PDF.
 *
 * After the PDF hits Storage and the extract endpoint fires, the AI reads
 * unit_number / contract_number / buyer_name and auto-links the case to the
 * matching unit + sale + contract PDF (see /api/dsb-extract §7.5). The user
 * sees the linked entities on the case page once extraction finishes
 * (~15-30s).
 */
export function ProjectQuickUpload({
  projectId,
  projectName,
  developerId,
  developerName,
}: {
  projectId: string
  projectName: string
  // The project's developer — required to satisfy createCaseByStaff's NOT NULL
  // developer_id column. If the project isn't linked to a developer we hide
  // the upload card entirely (the parent page decides whether to render us).
  developerId: string
  developerName: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<
    'idle' | 'creating' | 'uploading' | 'finalizing' | 'done'
  >('idle')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<
    | { caseId: string; caseNumber: string; filename: string }
    | null
  >(null)

  async function handleFile(file: File) {
    setError(null)
    setDone(null)

    if (file.size > MAX_FILE_SIZE) {
      setError(`الحجم يتجاوز الحد الأقصى (50 ميغابايت): ${file.name}`)
      return
    }

    setBusy(true)
    try {
      // 1) Create the empty case row scoped to this project.
      setPhase('creating')
      const create = await createCaseByStaff({
        developer_id: developerId,
        project_id: projectId,
      })
      if (!create.ok) {
        setError(create.error)
        return
      }
      const caseId = create.case_id
      const caseNumber = create.case_number

      // 2) Signed upload URL.
      const urlRes = await requestUploadUrl({
        case_id: caseId,
        filename: file.name,
        mime: file.type || 'application/pdf',
        size: file.size,
      })
      if (!urlRes.ok) {
        setError(urlRes.error)
        return
      }

      // 3) Direct-to-Storage PUT.
      setPhase('uploading')
      const putRes = await fetch(urlRes.signed_url, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/pdf',
          'x-upsert': 'true',
        },
      })
      if (!putRes.ok) {
        setError(`فشل رفع الملف (HTTP ${putRes.status}).`)
        return
      }

      // 4) Register upload row.
      const reg = await registerUpload({
        case_id: caseId,
        storage_path: urlRes.storage_path,
        filename: file.name,
        size: file.size,
        mime: file.type || 'application/pdf',
      })
      if (!reg.ok) {
        setError(reg.error)
        return
      }

      // 5) Finalize — this fires AI extraction (fire-and-forget). Auto-link
      // to unit/sale/contract runs inside the extract endpoint.
      setPhase('finalizing')
      const fin = await finalizeStaffUpload({ case_id: caseId })
      if (!fin.ok) {
        setError(fin.error)
        return
      }

      setDone({ caseId, caseNumber, filename: file.name })
      setPhase('done')
      // Refresh so the new case appears in the project's pipeline board
      // immediately without the user having to reload.
      router.refresh()
    } catch (err) {
      console.error('[ProjectQuickUpload] failed', err)
      setError(err instanceof Error ? err.message : 'تعذّر رفع الملف.')
    } finally {
      setBusy(false)
    }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (picked) handleFile(picked)
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <h2 className="serif font-black text-lg text-slate-900">رفع وثيقة صرف</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            الملف يُنسب تلقائيًا إلى <span className="font-semibold text-slate-700">{projectName}</span>{' '}
            ({developerName}). الذكاء الاصطناعي يستخرج البيانات ويربط الطلب بالوحدة/العقد/المشتري إن أمكن.
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {done ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-emerald-900">
                تم رفع الملف بنجاح.
              </div>
              <div className="text-xs text-emerald-800 mt-0.5">
                <span className="font-mono font-bold">{done.caseNumber}</span> — {done.filename}
              </div>
              <div className="text-[11px] text-emerald-700 mt-1 inline-flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" aria-hidden="true" />
                يعمل الذكاء الاصطناعي الآن على استخراج البيانات وربطها بالوحدة والعقد.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/app/disbursements/${done.caseId}?created=1`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold transition"
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              فتح صفحة الطلب
            </Link>
            <button
              type="button"
              onClick={() => setDone(null)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition"
            >
              رفع وثيقة أخرى
            </button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={`project-upload-${projectId}`}
          className={`flex items-center justify-center gap-2 px-4 py-8 rounded-lg border-2 border-dashed transition
            ${
              busy
                ? 'border-teal-300 bg-teal-50/40 cursor-wait'
                : 'border-slate-300 bg-slate-50 hover:border-teal-400 hover:bg-teal-50/40 cursor-pointer'
            }`}
        >
          {busy ? (
            <Loader2 className="w-5 h-5 text-teal-600 animate-spin" aria-hidden="true" />
          ) : (
            <Upload className="w-5 h-5 text-slate-500" aria-hidden="true" />
          )}
          <span className="text-sm font-semibold text-slate-700">
            {busy
              ? phase === 'creating'
                ? 'إنشاء الطلب…'
                : phase === 'uploading'
                ? 'جاري رفع الملف…'
                : phase === 'finalizing'
                ? 'تشغيل الذكاء الاصطناعي…'
                : 'جاري المعالجة…'
              : 'اضغط لاختيار ملف PDF'}
          </span>
          <input
            id={`project-upload-${projectId}`}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            disabled={busy}
            onChange={onPickFile}
          />
        </label>
      )}
    </section>
  )
}
