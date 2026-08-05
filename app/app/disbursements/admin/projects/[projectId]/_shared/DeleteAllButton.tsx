'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2, AlertTriangle } from 'lucide-react'

/**
 * Danger button for bulk-wipe actions. Modal with a typed-confirmation
 * ("اكتب DELETE") + explicit count of what will be removed. Two-step
 * intentionally slow so an accidental click can't destroy the project's
 * data.
 */
export function DeleteAllButton({
  label,
  count,
  itemNoun,             // e.g. "وحدة" / "عقد" for the modal text
  projectId,
  action,
}: {
  label: string
  count: number
  itemNoun: string
  projectId: string
  // Server-action ref. Called with { project_id, confirm } — the confirm
  // gate is enforced server-side (must equal 'DELETE').
  action: (input: {
    project_id: string
    confirm: string
  }) => Promise<{ ok: true; deleted: number } | { ok: false; error: string }>
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function confirm() {
    setError(null)
    const res = await action({ project_id: projectId, confirm: typed })
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    setTyped('')
    startTransition(() => router.refresh())
  }

  if (count === 0) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 bg-white hover:bg-red-50 hover:border-red-300 text-red-700 text-xs font-bold transition"
      >
        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-lg max-w-md w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-700" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="serif font-black text-lg text-slate-900">تأكيد الحذف الكلي</h3>
                <p className="text-sm text-slate-600 mt-1">
                  ستُحذف <span className="font-mono font-bold text-red-700">{count}</span>{' '}
                  {itemNoun}. لا يمكن التراجع عن هذه العملية.
                </p>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 mb-1 block">
                اكتب <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">DELETE</span> للتأكيد:
              </label>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={pending}
                dir="ltr"
                autoFocus
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                placeholder="DELETE"
              />
            </div>

            {error && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setTyped('')
                  setError(null)
                }}
                disabled={pending}
                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending || typed !== 'DELETE'}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {pending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                حذف نهائي
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
