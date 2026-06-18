'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  approveCase,
  sendBackToDeveloper,
  signCase,
  moveCaseToStage,
  requestSignedDocumentUploadUrl,
  signCaseWithUploadedDocument,
} from './actions'
import { DrawSignatureDialog } from './DrawSignatureDialog'

type DsbRole = 'developer' | 'employee' | 'supervisor' | 'owner' | null
type CaseStatus =
  | 'draft'
  | 'with_employee'
  | 'with_supervisor'
  | 'with_owner'
  | 'sent_back_to_developer'
  | 'signed'
  | 'cancelled'

type MoveTargetStatus =
  | 'with_employee'
  | 'with_supervisor'
  | 'with_owner'
  | 'sent_back_to_developer'
  | 'signed'

const MOVE_TARGET_LABELS: Record<MoveTargetStatus, string> = {
  with_employee:           'بانتظار الموظف',
  with_supervisor:         'بانتظار السوبرفايزر',
  with_owner:              'بانتظار التوقيع النهائي',
  sent_back_to_developer:  'أعيدت إلى المطور',
  signed:                  'موقّعة',
}

const MOVE_ALLOWED_BY_ROLE: Record<'employee' | 'supervisor' | 'owner', MoveTargetStatus[]> = {
  employee:   ['with_supervisor', 'sent_back_to_developer'],
  supervisor: ['with_employee', 'with_owner', 'sent_back_to_developer'],
  owner:      ['with_employee', 'with_supervisor', 'with_owner', 'sent_back_to_developer', 'signed'],
}

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
  const [busy, setBusy] = useState<'approve' | 'sign' | 'sign_upload' | 'send_back' | 'move' | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<MoveTargetStatus | ''>('')
  const [moveNotes, setMoveNotes] = useState('')

  const canApproveAsEmployee = status === 'with_employee' && dsbRole === 'employee' && isAssignedEmployee
  const canApproveAsSupervisor = status === 'with_supervisor' && dsbRole === 'supervisor'
  const canSign = status === 'with_owner' && dsbRole === 'owner'
  const canSendBack = ['with_employee', 'with_supervisor', 'with_owner'].includes(status) &&
    ['employee', 'supervisor', 'owner'].includes(dsbRole ?? '')
  const canMove = ['employee', 'supervisor', 'owner'].includes(dsbRole ?? '') &&
    status !== 'signed' && status !== 'cancelled' && status !== 'draft'
  const moveOptions: MoveTargetStatus[] =
    dsbRole && ['employee', 'supervisor', 'owner'].includes(dsbRole)
      ? MOVE_ALLOWED_BY_ROLE[dsbRole as 'employee' | 'supervisor' | 'owner']
      : []

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

  // Sign-with-uploaded-document flow: pick file → get signed upload URL →
  // PUT file directly to Supabase Storage → call server action to finalize.
  // Direct-to-storage upload bypasses Vercel's 4.5MB request body limit.
  async function doSignWithUpload(file: File) {
    setError(null)
    if (file.type && file.type !== 'application/pdf') {
      setError('الملف يجب أن يكون PDF.')
      return
    }
    setBusy('sign_upload')

    const urlRes = await requestSignedDocumentUploadUrl({
      case_id: caseId,
      filename: file.name,
      size: file.size,
    })
    if (!urlRes.ok) {
      setBusy(null)
      setError(urlRes.error)
      return
    }

    try {
      const putResp = await fetch(urlRes.signed_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/pdf' },
        body: file,
      })
      if (!putResp.ok) {
        setBusy(null)
        setError(`تعذّر رفع الملف (HTTP ${putResp.status}).`)
        return
      }
    } catch (err) {
      setBusy(null)
      setError(err instanceof Error ? err.message : 'تعذّر رفع الملف.')
      return
    }

    const finalizeRes = await signCaseWithUploadedDocument({
      case_id: caseId,
      storage_path: urlRes.storage_path,
      filename: file.name,
    })
    setBusy(null)
    if (!finalizeRes.ok) {
      setError(finalizeRes.error)
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

  async function doMove(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!moveTarget) {
      setError('اختر المرحلة.')
      return
    }
    if (moveTarget === 'sent_back_to_developer' && !moveNotes.trim()) {
      setError('الملاحظة مطلوبة عند الإعادة إلى المطور.')
      return
    }
    setBusy('move')
    const res = await moveCaseToStage({
      case_id: caseId,
      target_status: moveTarget,
      notes: moveNotes.trim() || undefined,
    })
    setBusy(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setMoveOpen(false)
    setMoveTarget('')
    setMoveNotes('')
    startTransition(() => router.refresh())
  }

  if (!canApproveAsEmployee && !canApproveAsSupervisor && !canSign && !canSendBack && !canMove) {
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
            {busy === 'approve' ? 'جاري الاعتماد…' : 'اعتماد وتحويل إلى المدير'}
          </button>
        )}
        {canSign && (
          <>
            <button
              type="button"
              disabled={busy !== null || pending}
              onClick={doSign}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold shadow-sm hover:bg-emerald-700 transition disabled:opacity-50"
            >
              {busy === 'sign' ? 'جاري التوقيع…' : 'التوقيع وإغلاق الطلب'}
            </button>
            <button
              type="button"
              disabled={busy !== null || pending}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center px-4 py-2 rounded-lg border border-emerald-300 bg-white text-emerald-700 text-sm font-semibold hover:bg-emerald-50 transition disabled:opacity-50"
            >
              {busy === 'sign_upload' ? 'جاري الرفع والتوقيع…' : 'توقيع برفع مستند موقّع'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) doSignWithUpload(f)
                // Reset so picking the same file twice in a row still triggers.
                e.target.value = ''
              }}
            />
            {/* Third path: draw-to-sign in app. Server embeds the drawn
                signature image onto the PDF and saves it as the signed doc. */}
            <DrawSignatureDialog caseId={caseId} />
          </>
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
        {canMove && !moveOpen && moveOptions.length > 0 && (
          <button
            type="button"
            disabled={busy !== null || pending}
            onClick={() => setMoveOpen(true)}
            className="inline-flex items-center px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 transition disabled:opacity-50"
          >
            نقل إلى مرحلة أخرى
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

      {moveOpen && (
        <form onSubmit={doMove} className="space-y-3 pt-2 border-t border-slate-100">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-slate-700">نقل الطلب إلى…</div>
            <div className="space-y-1.5">
              {moveOptions.map((opt) => (
                <label key={opt} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="move_target"
                    value={opt}
                    checked={moveTarget === opt}
                    onChange={() => setMoveTarget(opt)}
                    className="w-4 h-4 border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-sm text-slate-700">{MOVE_TARGET_LABELS[opt]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-700 block">
              ملاحظة {moveTarget === 'sent_back_to_developer' ? '(مطلوبة)' : '(اختياري)'}
            </label>
            <textarea
              rows={3}
              required={moveTarget === 'sent_back_to_developer'}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={moveNotes}
              onChange={(e) => setMoveNotes(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy !== null || !moveTarget}
              className="inline-flex items-center px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition disabled:opacity-50"
            >
              {busy === 'move' ? 'جاري النقل…' : 'نقل'}
            </button>
            <button
              type="button"
              onClick={() => { setMoveOpen(false); setMoveTarget(''); setMoveNotes('') }}
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
