'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, FileUp } from 'lucide-react'
import {
  requestReplacementUploadUrl,
  finalizeReplacementUpload,
} from './actions'

/**
 * Inline button to replace the case's PDF with a corrected version.
 *
 * Flow:
 *   1. User clicks "استبدال الوثيقة" — expand into a reason textarea + file picker.
 *   2. User picks a PDF, optionally types a reason.
 *   3. Click "رفع الاستبدال" → request signed upload URL → PUT file to Storage →
 *      finalize (server marks old version superseded, inserts new row, logs audit).
 *   4. Page refreshes; the case page shows a "نسخة محدّثة" banner.
 *
 * The old version stays in Storage and is downloadable from the version
 * history. Workflow status is NOT reset — staff stays at whatever stage they
 * were already in. They can click the AI review button again to re-run on
 * the new PDF.
 */
export function ReplaceDocumentButton({ caseId }: { caseId: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progressPct, setProgressPct] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function reset() {
    setFile(null)
    setReason('')
    setError(null)
    setProgressPct(null)
  }

  async function submit() {
    if (!file) {
      setError('يرجى اختيار ملف PDF.')
      return
    }
    if (file.type && file.type !== 'application/pdf') {
      setError('الملف يجب أن يكون PDF.')
      return
    }
    setError(null)
    setBusy(true)

    try {
      const urlRes = await requestReplacementUploadUrl({
        case_id: caseId,
        filename: file.name,
        size: file.size,
      })
      if (!urlRes.ok) {
        setError(urlRes.error)
        setBusy(false)
        return
      }

      setProgressPct(0)
      const putResp = await fetch(urlRes.signed_url, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'application/pdf',
          'x-upsert': 'true',
        },
        body: file,
      })
      setProgressPct(100)
      if (!putResp.ok) {
        setError(`فشل رفع الملف (HTTP ${putResp.status}).`)
        setBusy(false)
        return
      }

      const finRes = await finalizeReplacementUpload({
        case_id: caseId,
        storage_path: urlRes.storage_path,
        filename: file.name,
        size: file.size,
        mime: file.type || 'application/pdf',
        reason: reason.trim() || null,
      })
      if (!finRes.ok) {
        setError(finRes.error)
        setBusy(false)
        return
      }

      setOpen(false)
      reset()
      setBusy(false)
      startTransition(() => router.refresh())
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'تعذّر استبدال الوثيقة.')
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { reset(); setOpen(true) }}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-amber-200 bg-white text-xs font-semibold text-amber-800 hover:bg-amber-50 transition"
      >
        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
        استبدال الوثيقة
      </button>
    )
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

  return (
    <div className="bg-amber-50/40 border border-amber-200 rounded-lg p-4 space-y-3 max-w-md">
      <div className="text-sm font-semibold text-amber-900">استبدال الوثيقة الحالية</div>
      <div className="text-[11px] text-amber-800 leading-relaxed">
        ستُحفظ النسخة الحالية في السجل ولن تُحذف، وستُصبح النسخة الجديدة هي الوثيقة المعتمدة لهذا الطلب. ينصح بإعادة تشغيل المراجعة الآلية بعد الرفع.
      </div>

      <div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
        >
          <FileUp className="w-4 h-4" aria-hidden="true" />
          {file ? 'استبدال الملف المختار' : 'اختر ملف PDF'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) setFile(f)
            e.target.value = ''
          }}
        />
        {file && (
          <div className="mt-2 text-xs text-slate-700 truncate" title={file.name}>
            {file.name} <span className="text-slate-400 font-mono">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
          </div>
        )}
      </div>

      <div>
        <label className="text-xs font-semibold text-slate-500 mb-1 block">سبب الاستبدال (اختياري)</label>
        <textarea
          rows={2}
          className={inputCls}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
          placeholder="مثلاً: المطوّر أرسل النسخة الخطأ، أو نسخة أوضح من السكان."
        />
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
          {error}
        </div>
      )}

      {progressPct !== null && busy && (
        <div className="text-xs text-slate-500">جاري الرفع {progressPct}%</div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !file}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          {busy ? 'جاري الاستبدال…' : 'رفع الاستبدال'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); reset() }}
          disabled={busy}
          className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
        >
          إلغاء
        </button>
      </div>
    </div>
  )
}
