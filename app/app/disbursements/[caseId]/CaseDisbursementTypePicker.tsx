'use client'

/**
 * CaseDisbursementTypePicker — dropdown on the case page for setting the
 * نوع الوثيقة (disbursement type). Options come from the tenant's
 * أنواع الصرف list (mig 070 + 075 + 077): shipped enum + custom_* codes,
 * minus any codes the owner has hidden.
 *
 * The picked code is stored on dsb_cases.extracted_fields.disbursement_type_code
 * — same slot the AI writes during extraction. This is a manual override /
 * fill-in when the AI missed or misclassified.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, FileType2 } from 'lucide-react'
import { updateCaseDisbursementType } from './actions-vendor'

export type DisbursementTypeOption = { code: string; label: string }

export function CaseDisbursementTypePicker({
  caseId,
  initialCode,
  options,
  canEdit,
}: {
  caseId: string
  initialCode: string | null
  options: DisbursementTypeOption[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [selected, setSelected] = useState<string>(initialCode ?? '')
  const [busy, setBusy] = useState(false)
  const [savedTick, setSavedTick] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  async function onChange(next: string) {
    if (!canEdit) return
    setErr(null)
    const prev = selected
    setSelected(next)
    setBusy(true)
    const res = await updateCaseDisbursementType({
      case_id: caseId,
      type_code: next || null,
    })
    setBusy(false)
    if (!res.ok) {
      setSelected(prev)
      setErr(res.error)
      return
    }
    setSavedTick((n) => n + 1)
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-2 bg-white border border-slate-200 rounded-xl p-4 shadow-sm" dir="rtl">
      <div className="flex items-center gap-2">
        <FileType2 className="w-4 h-4 text-amber-700" aria-hidden="true" />
        <h3 className="text-sm font-bold text-slate-800">نوع الوثيقة</h3>
        {busy && <Loader2 className="w-3 h-3 animate-spin text-teal-600" />}
        {!busy && savedTick > 0 && <Check className="w-3 h-3 text-emerald-600" />}
      </div>

      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        disabled={!canEdit || busy}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:bg-slate-50"
      >
        <option value="">— بدون تصنيف —</option>
        {options.map((o) => (
          <option key={o.code} value={o.code}>{o.label}</option>
        ))}
      </select>

      <p className="text-[10px] text-slate-500 leading-relaxed">
        القائمة مأخوذة من «القوائم والنسب ← أنواع الصرف». إن لم يظهر التصنيف
        المطلوب، أضِفه من صفحة القوائم ثم عد إلى هنا. هذا الحقل يتحكم في تصنيف
        السند داخل ورقة (2) وثائق الصرف وسطر «العمليات المالية» في نموذج
        المحاسب القانوني.
      </p>

      {err && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">{err}</div>}
    </div>
  )
}
