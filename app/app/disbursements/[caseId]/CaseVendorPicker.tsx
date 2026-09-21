'use client'

/**
 * CaseVendorPicker — dropdown on the case page for assigning this
 * disbursement voucher to a project vendor / contractor. The choice
 * feeds the vendor detail page's activity feed (mig 084).
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Check, Briefcase, ExternalLink } from 'lucide-react'
import { updateCaseVendor } from './actions-vendor'

export type VendorPickerOption = { id: string; name_ar: string; category: string | null }

export function CaseVendorPicker({
  caseId,
  projectId,
  initialVendorId,
  options,
  canEdit,
}: {
  caseId: string
  projectId: string
  initialVendorId: string | null
  options: VendorPickerOption[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [selected, setSelected] = useState<string>(initialVendorId ?? '')
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
          <p className="text-[10px] text-slate-500 leading-relaxed">
            تحديد المورد يربط هذا السند بصفحته لعرض النشاط والحسم من دفعة المطوّر
            المخصصة له.
          </p>
        </>
      )}
      {err && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">{err}</div>}
    </div>
  )
}
