'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import { revertSignature } from './actions'

/**
 * Owner-only "undo signature" button. Shows on signed cases and rolls the
 * case back to with_owner so the manager can re-sign or change course.
 * Two-step confirm with optional reason captured in the audit log.
 */
export function RevertSignatureButton({ caseId }: { caseId: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onConfirm() {
    setError(null)
    setBusy(true)
    const res = await revertSignature({ case_id: caseId, reason: reason.trim() || null })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    setReason('')
    startTransition(() => router.refresh())
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setError(null); setOpen(true) }}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-white text-xs font-semibold text-red-700 hover:bg-red-50 transition"
      >
        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
        إلغاء التوقيع
      </button>
    )
  }

  return (
    <div className="inline-flex flex-col items-stretch gap-1.5 max-w-sm">
      <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-xs leading-relaxed">
        سيتم إعادة الطلب إلى حالة «بانتظار مدير المراجعة». ستُحفظ النسخة الموقّعة السابقة في السجل ولن تُحذف من الخادم، لكنها لن تكون النسخة المعتمدة بعد الآن. هل تريد المتابعة؟
      </div>
      <textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={busy}
        placeholder="سبب الإلغاء (اختياري)"
        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 disabled:bg-slate-50"
      />
      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition disabled:opacity-50"
        >
          {busy ? 'جاري الإلغاء…' : 'نعم، ألغِ التوقيع'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setReason('') }}
          disabled={busy}
          className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
        >
          تراجع
        </button>
      </div>
    </div>
  )
}
