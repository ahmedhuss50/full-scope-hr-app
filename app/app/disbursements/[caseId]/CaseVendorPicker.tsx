'use client'

/**
 * CaseVendorPicker — dropdown on the case page for assigning this
 * disbursement voucher to a project vendor / contractor. The choice
 * feeds the vendor detail page's activity feed (mig 084).
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Check, Briefcase, ExternalLink, Wallet } from 'lucide-react'
import { updateCaseVendor, updateCaseIsDownpayment } from './actions-vendor'

export type VendorPickerOption = { id: string; name_ar: string; category: string | null }

export function CaseVendorPicker({
  caseId,
  projectId,
  initialVendorId,
  initialIsDownpayment,
  options,
  canEdit,
}: {
  caseId: string
  projectId: string
  initialVendorId: string | null
  initialIsDownpayment: boolean
  options: VendorPickerOption[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [selected, setSelected] = useState<string>(initialVendorId ?? '')
  const [isDownpayment, setIsDownpayment] = useState<boolean>(!!initialIsDownpayment)
  const [busy, setBusy] = useState(false)
  const [savedTick, setSavedTick] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  async function onChange(next: string) {
    if (!canEdit) return
    setErr(null)
    const prev = selected
    setSelected(next)
    setBusy(true)
    const res = await updateCaseVendor({ case_id: caseId, vendor_id: next || null })
    setBusy(false)
    if (!res.ok) {
      setSelected(prev)
      setErr(res.error)
      return
    }
    setSavedTick((n) => n + 1)
    startTransition(() => router.refresh())
  }

  async function onToggleDownpayment(next: boolean) {
    if (!canEdit) return
    setErr(null)
    const prev = isDownpayment
    setIsDownpayment(next)
    setBusy(true)
    const res = await updateCaseIsDownpayment({ case_id: caseId, is_downpayment: next })
    setBusy(false)
    if (!res.ok) {
      setIsDownpayment(prev)
      setErr(res.error)
      return
    }
    setSavedTick((n) => n + 1)
    startTransition(() => router.refresh())
  }

  const current = options.find((o) => o.id === selected)

  return (
    <div className="space-y-2 bg-white border border-slate-200 rounded-xl p-4 shadow-sm" dir="rtl">
      <div className="flex items-center gap-2">
        <Briefcase className="w-4 h-4 text-indigo-700" aria-hidden="true" />
        <h3 className="text-sm font-bold text-slate-800">المورد / المقاول المستفيد</h3>
        {busy && <Loader2 className="w-3 h-3 animate-spin text-teal-600" />}
        {!busy && savedTick > 0 && <Check className="w-3 h-3 text-emerald-600" />}
      </div>

      {options.length === 0 ? (
        <p className="text-xs text-slate-500">
          لا يوجد موردون لهذا المشروع بعد.{' '}
          <Link href={`/app/disbursements/admin/projects/${projectId}/vendors`}
            className="text-teal-700 font-semibold hover:underline">
            أضِف موردًا
          </Link>
        </p>
      ) : (
        <>
          <select
            value={selected}
            onChange={(e) => onChange(e.target.value)}
            disabled={!canEdit || busy}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-50"
          >
            <option value="">— بدون —</option>
            {options.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name_ar}{v.category ? ` · ${v.category}` : ''}
              </option>
            ))}
          </select>
          {current && (
            <Link
              href={`/app/disbursements/admin/projects/${projectId}/vendors/${current.id}`}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:underline"
            >
              فتح صفحة المورد <ExternalLink className="w-3 h-3" />
            </Link>
          )}

          {/* Downpayment toggle */}
          <label className={`flex items-start gap-2 mt-2 px-3 py-2 rounded-lg border cursor-pointer transition ${
            isDownpayment
              ? 'bg-indigo-50 border-indigo-300'
              : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
          } ${!canEdit ? 'cursor-default opacity-70' : ''}`}>
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              checked={isDownpayment}
              disabled={!canEdit || busy}
              onChange={(e) => onToggleDownpayment(e.target.checked)}
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-slate-800 inline-flex items-center gap-1">
                <Wallet className="w-3.5 h-3.5 text-indigo-600" />
                هذا سند دفعة مقدّمة
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                علِّم عند صرف (أو صرف جزء من) الدفعة المقدّمة للمورد. سيظهر في
                صفحة المورد ضمن قسم «دفعات مقدمة» ويُحسم من الدفعة الكلية.
              </div>
            </div>
          </label>

          <p className="text-[10px] text-slate-500 leading-relaxed">
            تحديد المورد يربط هذا السند بصفحته لعرض النشاط والحسم من دفعة المطوّر
            المخصصة له. تأكّد من اختيار حساب الدفع (حساب الضمان) في قسم مسار
            التحويل المالي أدناه.
          </p>
        </>
      )}
      {err && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">{err}</div>}
    </div>
  )
}
