'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, CheckCircle2 } from 'lucide-react'
import { t as tFn, type Locale } from '@/lib/i18n/translations'
import { requestAdminUploadUrls, registerAdminUploads } from './admin-upload-actions'

type UploadKind = 'contract' | 'bill' | 'proof_of_fund' | 'bank_statement'
const KINDS: UploadKind[] = ['contract', 'bill', 'proof_of_fund', 'bank_statement']

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB
const MAX_FILE_SIZE_MB = 25

const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

/**
 * Internal-staff version of the developer upload form. Uses the same
 * direct-to-Supabase-Storage flow as the public token form to dodge Vercel's
 * 4.5 MB server-action body limit:
 *   1. requestAdminUploadUrls (auth-gated) -> N signed PUT URLs
 *   2. Browser PUTs each file directly to Storage
 *   3. registerAdminUploads (auth-gated) -> records metadata + advances step
 */
export function AdminUploadForm({
  stepId,
  locale,
}: {
  stepId: string
  locale: Locale
}) {
  const router = useRouter()
  const [files, setFiles] = useState<Partial<Record<UploadKind, File>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<{ n: number; m: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function onPick(kind: UploadKind, e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > MAX_FILE_SIZE) {
      setError(tFn('disbursement.upload.too_large', locale, { max: MAX_FILE_SIZE_MB }))
      return
    }
    if (f.type && !ALLOWED_MIME_TYPES.has(f.type)) {
      setError(tFn('disbursement.upload.unsupported', locale))
      return
    }
    setError(null)
    setFiles((prev) => ({ ...prev, [kind]: f }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const slots = KINDS.map((kind) => ({ kind, file: files[kind] })).filter(
      (s): s is { kind: UploadKind; file: File } => Boolean(s.file),
    )
    if (slots.length === 0) {
      setError(tFn('disbursement.upload.error_generic', locale))
      return
    }

    setSubmitting(true)
    try {
      // 1. Mint signed upload URLs.
      const urlsResp = await requestAdminUploadUrls({
        step_id: stepId,
        slots: slots.map((s) => ({
          kind: s.kind,
          filename: s.file.name,
          mime_type: s.file.type || 'application/octet-stream',
          size: s.file.size,
        })),
      })
      if (!urlsResp.ok || !urlsResp.uploads) {
        setError(urlsResp.error ?? tFn('disbursement.upload.error_generic', locale))
        return
      }

      // 2. PUT each file directly to Supabase Storage.
      const total = urlsResp.uploads.length
      let done = 0
      for (const u of urlsResp.uploads) {
        const file = slots.find((s) => s.kind === u.kind)?.file
        if (!file) continue
        setProgress({ n: done + 1, m: total })

        const putRes = await fetch(u.signed_url, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'x-upsert': 'true',
          },
        })
        if (!putRes.ok) {
          setError(`${tFn('disbursement.upload.error_generic', locale)} (${u.kind}: HTTP ${putRes.status})`)
          return
        }
        done += 1
      }

      // 3. Register metadata.
      const regResp = await registerAdminUploads({
        step_id: stepId,
        uploads: urlsResp.uploads.map((u) => {
          const file = slots.find((s) => s.kind === u.kind)!.file
          return {
            kind: u.kind,
            storage_path: u.storage_path,
            filename: file.name,
            display_name: file.name,
            file_size: file.size,
            mime_type: file.type || 'application/octet-stream',
          }
        }),
      })
      if (!regResp.ok) {
        setError(regResp.error ?? tFn('disbursement.upload.error_generic', locale))
        return
      }

      setFiles({})
      if (formRef.current) formRef.current.reset()
      router.refresh()
    } catch (err) {
      console.error('[admin-upload] direct-to-Storage failed', err)
      setError(err instanceof Error ? err.message : tFn('disbursement.upload.error_generic', locale))
    } finally {
      setSubmitting(false)
      setProgress(null)
    }
  }

  const anyFile = KINDS.some((k) => Boolean(files[k]))

  let buttonLabel = tFn('step.admin_upload.submit', locale)
  if (submitting) {
    buttonLabel =
      progress && progress.m > 0
        ? tFn('disbursement.upload.uploading_n_of_m', locale, { n: progress.n, m: progress.m })
        : tFn('disbursement.upload.uploading', locale)
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-3">
        {KINDS.map((kind) => (
          <UploadSlot
            key={kind}
            kind={kind}
            file={files[kind] ?? null}
            onPick={(e) => onPick(kind, e)}
            label={tFn(`disbursement.upload.kind.${kind}`, locale)}
            chooseFileLabel={tFn('disbursement.upload.choose_file', locale)}
            noFileLabel={tFn('disbursement.upload.no_file', locale)}
          />
        ))}
      </div>

      {error && <div className="text-xs text-red-600">{error}</div>}

      <div className="pt-1 flex justify-end">
        <button
          type="submit"
          disabled={submitting || !anyFile}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload className="w-4 h-4" />
          {buttonLabel}
        </button>
      </div>
    </form>
  )
}

function UploadSlot({
  kind,
  file,
  onPick,
  label,
  chooseFileLabel,
  noFileLabel,
}: {
  kind: UploadKind
  file: File | null
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void
  label: string
  chooseFileLabel: string
  noFileLabel: string
}) {
  const inputId = `admin_file_${kind}_input`
  return (
    <div
      className={`p-3 rounded-lg border ${file ? 'border-green-200 bg-green-50/30' : 'border-slate-200 bg-white'} flex items-center gap-3`}
    >
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          file ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
        }`}
      >
        {file ? <CheckCircle2 className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        <div className="text-xs text-slate-500 truncate">
          {file ? file.name : noFileLabel}
        </div>
      </div>
      <label
        htmlFor={inputId}
        className="cursor-pointer inline-flex items-center px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
      >
        {chooseFileLabel}
      </label>
      <input
        id={inputId}
        name={`file_${kind}`}
        type="file"
        accept="application/pdf,image/jpeg,image/png,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={onPick}
        className="hidden"
      />
    </div>
  )
}
