'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Paperclip, FileUp, Download, Trash2, FileText } from 'lucide-react'
import {
  requestAttachmentUploadUrl,
  finalizeAttachmentUpload,
  deleteAttachment,
  getAttachmentSignedUrl,
} from './actions'
import { fmtDateTime } from '@/lib/dsb/datetime'

export type AttachmentRow = {
  id: string
  filename: string
  attachment_label: string | null
  file_size_bytes: number | null
  mime_type: string | null
  uploaded_at: string
  uploaded_by_user_id: string | null
}

/**
 * Per-case supplementary attachments.
 *
 * Lists existing attachments with download + delete; staff can upload new
 * ones via the inline button. The list updates via router.refresh().
 */
export function AttachmentsSection({
  caseId,
  attachments,
  currentUserId,
  isOwner,
}: {
  caseId: string
  attachments: AttachmentRow[]
  currentUserId: string
  isOwner: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progressPct, setProgressPct] = useState<number | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')

  function openPicker() {
    setError(null)
    setLabel('')
    setPendingFile(null)
    setProgressPct(null)
    fileInputRef.current?.click()
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > 50 * 1024 * 1024) {
      setError('حجم الملف يتجاوز ٥٠ ميغابايت.')
      return
    }
    setPendingFile(f)
    setPicking(true)
  }

  async function confirmUpload() {
    if (!pendingFile) return
    setError(null)
    setBusy(true)
    try {
      const urlRes = await requestAttachmentUploadUrl({
        case_id: caseId,
        filename: pendingFile.name,
        size: pendingFile.size,
      })
      if (!urlRes.ok) {
        setError(urlRes.error)
        setBusy(false)
        return
      }
      setProgressPct(0)
      const putResp = await fetch(urlRes.signed_url, {
        method: 'PUT',
        headers: { 'Content-Type': pendingFile.type || 'application/octet-stream' },
        body: pendingFile,
      })
      setProgressPct(100)
      if (!putResp.ok) {
        setError(`فشل رفع الملف (HTTP ${putResp.status}).`)
        setBusy(false)
        return
      }
      const finRes = await finalizeAttachmentUpload({
        case_id: caseId,
        storage_path: urlRes.storage_path,
        filename: pendingFile.name,
        size: pendingFile.size,
        mime: pendingFile.type || 'application/octet-stream',
        label: label.trim() || null,
      })
      if (!finRes.ok) {
        setError(finRes.error)
        setBusy(false)
        return
      }
      setBusy(false)
      setPendingFile(null)
      setLabel('')
      setPicking(false)
      startTransition(() => router.refresh())
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'فشل الرفع.')
    }
  }

  async function onDownload(uploadId: string) {
    const res = await getAttachmentSignedUrl({ upload_id: uploadId })
    if (!res.ok) {
      alert(res.error)
      return
    }
    window.open(res.url, '_blank', 'noopener,noreferrer')
  }

  async function onDelete(uploadId: string, filename: string) {
    if (!confirm(`حذف المرفق «${filename}»؟`)) return
    const res = await deleteAttachment({ upload_id: uploadId })
    if (!res.ok) {
      alert(res.error)
      return
    }
    startTransition(() => router.refresh())
  }

  function fmtBytes(b: number | null): string {
    if (!b || b <= 0) return ''
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
    return `${(b / 1024 / 1024).toFixed(2)} MB`
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="serif font-bold text-lg text-slate-900 inline-flex items-center gap-2">
          <Paperclip className="w-4 h-4 text-slate-500" aria-hidden="true" />
          مستندات إضافية
          {attachments.length > 0 && (
            <span className="text-xs font-mono text-slate-400">({attachments.length})</span>
          )}
        </h2>
        {!picking && (
          <button
            type="button"
            onClick={openPicker}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
          >
            <FileUp className="w-3.5 h-3.5" aria-hidden="true" />
            إضافة مستند
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.csv,.txt"
        className="hidden"
        onChange={onPickFile}
      />

      {picking && pendingFile && (
        <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3 space-y-2">
          <div className="text-xs font-semibold text-slate-700">
            ملف مختار: <span className="text-slate-900">{pendingFile.name}</span>{' '}
            <span className="text-slate-500 font-mono">({fmtBytes(pendingFile.size)})</span>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 mb-1 block">
              وصف المستند (اختياري)
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={busy}
              placeholder="مثلاً: إيصال الاستلام، شهادة الإتمام، صورة الهوية"
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50"
            />
          </div>
          {progressPct !== null && busy && (
            <div className="text-xs text-slate-500">جاري الرفع {progressPct}%</div>
          )}
          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
              {error}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={confirmUpload}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
            >
              <FileUp className="w-3.5 h-3.5" aria-hidden="true" />
              {busy ? 'جاري الرفع…' : 'رفع'}
            </button>
            <button
              type="button"
              onClick={() => { setPicking(false); setPendingFile(null); setLabel(''); setError(null) }}
              disabled={busy}
              className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {!picking && error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {attachments.length === 0 ? (
        <div className="text-sm text-slate-500 text-center py-4 border border-dashed border-slate-200 rounded-md">
          لا توجد مستندات إضافية بعد.
        </div>
      ) : (
        <ul className="space-y-2">
          {attachments.map((a) => {
            const canDelete = a.uploaded_by_user_id === currentUserId || isOwner
            return (
              <li
                key={a.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50/40"
              >
                <FileText className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {a.attachment_label || a.filename}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1.5 flex-wrap">
                    {a.attachment_label && <span className="truncate">{a.filename}</span>}
                    {a.attachment_label && <span>·</span>}
                    {a.file_size_bytes && <span>{fmtBytes(a.file_size_bytes)}</span>}
                    {a.file_size_bytes && <span>·</span>}
                    <span>{fmtDateTime(a.uploaded_at)}</span>
                  </div>
                </div>
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onDownload(a.id)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                    title="تنزيل المرفق"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    تنزيل
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => onDelete(a.id, a.attachment_label || a.filename)}
                      title="حذف المرفق"
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
