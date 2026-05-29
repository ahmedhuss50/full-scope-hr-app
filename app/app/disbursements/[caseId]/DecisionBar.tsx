'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { approveCase, sendBackToDeveloper, signCase } from './actions'

type DsbRole = 'developer' | 'employee' | 'supervisor' | 'owner' | null
type CaseStatus =
  | 'draft'
  | 'with_employee'
  | 'with_supervisor'
  | 'with_owner'
  | 'sent_back_to_developer'
  | 'signed'
  | 'cancelled'

export function DecisionBar({
  caseId,
  status,
  dsbRole,
  isAssignedEmployee,
}: {
  caseId: string
  status: CaseStatus
  dsbRole: DsbRole
  isAssignedEmployee: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [sendBackOpen, setSendBackOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<'approve' | 'sign' | 'send_back' | null>(null)

  const canApproveAsEmployee = status === 'with_employee' && dsbRole === 'employee' && isAssignedEmployee
  const canApproveAsSupervisor = status === 'with_supervisor' && dsbRole === 'supervisor'
  const canSign = status === 'with_owner' && dsbRole === 'owner'
  const canSendBack = ['with_employee', 'with_supervisor', 'with_owner'].includes(status) &&
    ['employee', 'supervisor', 'owner'].includes(dsbRole ?? '')

  async function doApprove() {
    setError(null)
    setBusy('approve')
    const res = await approveCase({ case_id: caseId })
    setBusy(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    startTransition(() => router.refresh())
  }

  async function doSign() {
    setError(null)
    setBusy('sign')
    const res = await signCase({ case_id: caseId })
    setBusy(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    startTransition(() => router.refresh())
  }

  async function doSendBack(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!reason.trim()) {
      setError('السبب مطلوب عند الإعادة.')
      return
    }
    setBusy('send_back')
    const res = await sendBackToDeveloper({ case_id: caseId, reason: reason.trim() })
    setBusy(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSendBackOpen(false)
    setReason('')
    startTransition(() => router.refresh())
  }

  if (!canApproveAsEmployee && !canApproveAsSupervisor && !canSign && !canSendBack) {
    return null
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
      <h3 className="serif font-bold text-base text-slate-900">القرار</h3>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canApproveAsEmployee && (
          <button
            type="button"
            disabled={busy !== null || pending}
            onClick={doApprove}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
          >
            {busy === 'approve' ? 'جاري الاعتماد…' : 'اعتماد وتحويل إلى المشرف'}
          </button>
        )}
        {canApproveAsSupervisor && (
          <button
            type="button"
            disabled={busy !== null || pending}
            onClick={doApprove}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
          >
            {busy === 'approve' ? 'جاري الاعتماد…' : 'اعتماد وتحويل إلى صاحب القرار'}
          </button>
        )}
        {canSign && (
          <button
            type="button"
            disabled={busy !== null || pending}
            onClick={doSign}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold shadow-sm hover:bg-emerald-700 transition disabled:opacity-50"
          >
            {busy === 'sign' ? 'جاري التوقيع…' : 'التوقيع وإغلاق الطلب'}
          </button>
        )}
        {canSendBack && !sendBackOpen && (
          <button
            type="button"
            disabled={busy !== null || pending}
            onClick={() => setSendBackOpen(true)}
            className="inline-flex items-center px-4 py-2 rounded-lg border border-red-200 bg-white text-red-700 text-sm font-semibold hover:bg-red-50 transition disabled:opacity-50"
          >
            إعادة إلى المطوّر
          </button>
        )}
      </div>

      {sendBackOpen && (
        <form onSubmit={doSendBack} className="space-y-3 pt-2 border-t border-slate-100">
          <label className="text-sm font-semibold text-slate-700 block">
            سبب الإعادة (مطلوب)
          </label>
          <textarea
            rows={3}
            required
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy !== null}
              className="inline-flex items-center px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition disabled:opacity-50"
            >
              {busy === 'send_back' ? 'جاري الإرسال…' : 'تأكيد الإعادة'}
            </button>
            <button
              type="button"
              onClick={() => { setSendBackOpen(false); setReason('') }}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
