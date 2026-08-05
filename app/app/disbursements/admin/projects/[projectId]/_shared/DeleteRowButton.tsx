'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2 } from 'lucide-react'

/**
 * Compact per-row delete button. Shows a small inline confirm ("متأكد؟ نعم /
 * إلغاء") on first click; second confirm triggers the server action. Avoids
 * a full modal for single-row operations that are cheap to reverse (owner
 * can just re-import).
 */
export function DeleteRowButton({
  id,
  itemLabel,
  action,
}: {
  id: string
  itemLabel: string
  // Server-action reference. Pass the action directly (e.g. `action={deleteUnit}`)
  // — inline arrow wrappers won't cross the server→client boundary.
  action: (input: { id: string }) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function doDelete() {
    setError(null)
    const res = await action({ id })
    if (!res.ok) {
      setError(res.error)
      return
    }
    setConfirming(false)
    startTransition(() => router.refresh())
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title={`حذف: ${itemLabel}`}
        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
      >
        <Trash2 className="w-4 h-4" aria-hidden="true" />
      </button>
    )
  }
  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={doDelete}
        disabled={pending}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-600 text-white text-[11px] font-bold hover:bg-red-700 disabled:opacity-60 transition"
      >
        {pending ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : null}
        حذف
      </button>
      <button
        type="button"
        onClick={() => {
          setConfirming(false)
          setError(null)
        }}
        disabled={pending}
        className="px-2 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        إلغاء
      </button>
      {error && (
        <span className="text-[11px] text-red-700 mr-1" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
