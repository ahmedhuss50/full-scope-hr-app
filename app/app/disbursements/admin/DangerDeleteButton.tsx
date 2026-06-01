'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'

/**
 * Two-step destructive button. Click once → expands inline into a
 * "هل أنت متأكد؟ نعم / إلغاء" prompt. Click "نعم" runs the action; on success
 * navigates to `redirectTo` (if set) or just refreshes the current route.
 *
 * The caller supplies the server action as `action` so this component is
 * reusable across entity types. We don't import any specific server action
 * here, which keeps the bundle small and avoids tight coupling.
 */
export function DangerDeleteButton({
  action,
  label,
  confirmText,
  size = 'sm',
  redirectTo,
}: {
  action: () => Promise<{ ok: true } | { ok: false; error: string }>
  label: string
  confirmText: string
  size?: 'sm' | 'md'
  redirectTo?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function onConfirm() {
    setError(null)
    setBusy(true)
    const res = await action()
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    if (redirectTo) {
      router.push(redirectTo)
    } else {
      startTransition(() => router.refresh())
    }
  }

  const sizing = size === 'md' ? 'px-3 py-2 text-sm' : 'px-2.5 py-1 text-xs'

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white font-semibold text-red-700 hover:bg-red-50 transition ${sizing}`}
      >
        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        {label}
      </button>
    )
  }

  return (
    <div className="inline-flex flex-col items-stretch gap-1.5 max-w-sm">
      <div className={`rounded-lg border border-red-200 bg-red-50 text-red-800 ${size === 'md' ? 'px-3 py-2 text-sm' : 'px-2.5 py-1.5 text-xs'}`}>
        {confirmText}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={`inline-flex items-center gap-1.5 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 transition disabled:opacity-50 ${sizing}`}
        >
          {busy ? 'جاري الحذف…' : 'نعم، احذف'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null) }}
          disabled={busy}
          className={`inline-flex items-center rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50 ${sizing}`}
        >
          إلغاء
        </button>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  )
}
