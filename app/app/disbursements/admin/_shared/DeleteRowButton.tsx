'use client'

/**
 * DeleteRowButton — reusable owner-row delete trigger.
 *
 * Encapsulates the common delete-row pattern used across admin lists:
 *   1. confirm() dialog with a message you provide
 *   2. call a server action (passed in via `onDelete`)
 *   3. show the server's error message inline if it fails
 *   4. router.refresh() on success
 *
 * The server action is responsible for owner-role check + tenant isolation —
 * this component is purely UI glue and does NO auth of its own.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'

export function DeleteRowButton({
  onDelete,
  confirmMessage,
  label = 'حذف',
  title = 'حذف',
  compact = true,
}: {
  /** Server action — must return { ok: true } or { ok: false; error: string } */
  onDelete: () => Promise<{ ok: true } | { ok: false; error: string }>
  /** The confirm() prompt text. Include enough context so the user knows what they're deleting. */
  confirmMessage: string
  /** Visible button text when compact=false. */
  label?: string
  /** Tooltip on hover. */
  title?: string
  /** When true (default), renders an icon-only 7×7 button. When false, icon + text pill. */
  compact?: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function doDelete() {
    setErr(null)
    if (!confirm(confirmMessage)) return
    setBusy(true)
    const res = await onDelete()
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    startTransition(() => router.refresh())
  }

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={doDelete}
          disabled={busy}
          title={title}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 bg-white text-red-600 hover:bg-red-50 hover:border-red-200 transition disabled:opacity-50"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={doDelete}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-red-200 bg-white text-red-700 text-xs font-semibold hover:bg-red-50 transition disabled:opacity-50"
        >
          <Trash2 className="w-3 h-3" aria-hidden="true" />
          {busy ? '…' : label}
        </button>
      )}
      {err && (
        <div role="alert" className="mt-1 text-[11px] text-red-700 font-semibold">
          {err}
        </div>
      )}
    </>
  )
}
