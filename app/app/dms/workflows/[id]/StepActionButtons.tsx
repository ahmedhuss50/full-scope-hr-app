'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { t as tFn, type Locale } from '@/lib/i18n/translations'
import { approveStepAsInternal } from './step-actions'

/**
 * Approve / Reject buttons rendered below the active checklist on the
 * workflow detail page. Visible only for active steps assigned to an
 * internal user (signer_kind='internal_user' AND status='awaiting').
 */
export function StepActionButtons({
  stepId,
  locale,
}: {
  stepId: string
  locale: Locale
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [showReject, setShowReject] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  function onApprove() {
    setError(null)
    startTransition(async () => {
      const res = await approveStepAsInternal({ step_id: stepId, decision: 'approve' })
      if (!res.ok) {
        setError(res.error ?? tFn('step.actions.error_generic', locale))
        return
      }
      router.refresh()
    })
  }

  function onReject() {
    if (!reason.trim()) {
      setError(tFn('step.actions.reason_required', locale))
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await approveStepAsInternal({
        step_id: stepId,
        decision: 'reject',
        reason: reason.trim(),
      })
      if (!res.ok) {
        setError(res.error ?? tFn('step.actions.error_generic', locale))
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-200">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="text-xs text-slate-500 pt-2">
          {tFn('step.actions.ready_to_advance', locale)}
        </div>
        <div className="flex gap-2">
          {!showReject && (
            <>
              <button
                type="button"
                onClick={() => setShowReject(true)}
                disabled={pending}
                className="px-4 py-2 rounded-md border border-red-300 text-red-700 text-sm font-semibold hover:bg-red-50 disabled:opacity-50"
              >
                {tFn('step.actions.reject', locale)}
              </button>
              <button
                type="button"
                onClick={onApprove}
                disabled={pending}
                className="px-4 py-2 rounded-md bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50"
              >
                {pending
                  ? tFn('step.actions.advancing', locale)
                  : tFn('step.actions.approve', locale)}
              </button>
            </>
          )}
          {showReject && (
            <div className="flex flex-col gap-2 w-full max-w-md">
              <textarea
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value)
                  if (error) setError(null)
                }}
                placeholder={tFn('step.actions.reject_reason', locale)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                rows={2}
              />
              {error && <div className="text-xs text-red-600">{error}</div>}
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowReject(false)
                    setReason('')
                    setError(null)
                  }}
                  disabled={pending}
                  className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50"
                >
                  {tFn('step.actions.cancel', locale)}
                </button>
                <button
                  type="button"
                  onClick={onReject}
                  disabled={pending}
                  className="px-4 py-2 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
                >
                  {pending
                    ? tFn('step.actions.advancing', locale)
                    : tFn('step.actions.confirm_reject', locale)}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {!showReject && error && (
        <div className="mt-2 text-xs text-red-600 text-right">{error}</div>
      )}
    </div>
  )
}
