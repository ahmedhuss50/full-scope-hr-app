'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, AlertCircle, Wallet } from 'lucide-react'
import { updatePaidFromAccount } from './actions'

type AccountOption = {
  id: string
  label: string
  bank_name: string | null
  account_number: string | null
}

/**
 * Inline picker for dsb_cases.paid_from_account_id.
 *
 * The paid-from account is what powers the escrow-account report deduction
 * AND unblocks the stage-2 promotion gate, so it needs to be settable at
 * any point in a case's lifecycle — not just from the archive after
 * delivery. This component lives on the case detail page and saves
 * immediately on change (no separate save button).
 */
export function PaidFromPicker({
  caseId,
  initialAccountId,
  accounts,
  canEdit,
}: {
  caseId: string
  initialAccountId: string | null
  accounts: AccountOption[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [value, setValue] = useState<string>(initialAccountId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedTick, setSavedTick] = useState(0)

  async function onChange(newValue: string) {
    if (!canEdit) return
    setError(null)
    const prev = value
    setValue(newValue) // optimistic
    setSaving(true)
    const res = await updatePaidFromAccount({
      case_id: caseId,
      account_id: newValue || null,
    })
    setSaving(false)
    if (!res.ok) {
      setValue(prev) // rollback on error
      setError(res.error)
      return
    }
    setSavedTick((n) => n + 1)
    startTransition(() => router.refresh())
  }

  if (accounts.length === 0) {
    return (
      <div className="text-[11px] text-slate-500 italic">
        لم تُضَف حسابات لهذا المشروع بعد. أضِفها من «إدارة الحسابات» على صفحة المشروع.
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Wallet className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
        <label className="text-[11px] font-semibold text-slate-500">
          الحساب المسدد منه
        </label>
        {saving && (
          <Loader2 className="w-3 h-3 animate-spin text-teal-600" aria-hidden="true" />
        )}
        {!saving && savedTick > 0 && (
          <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />
        )}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!canEdit || saving}
        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
      >
        <option value="">— لم يُختَر —</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
            {a.bank_name ? ` · ${a.bank_name}` : ''}
          </option>
        ))}
      </select>
      {error && (
        <div role="alert" className="text-[11px] text-red-700 inline-flex items-center gap-1">
          <AlertCircle className="w-3 h-3" aria-hidden="true" />
          {error}
        </div>
      )}
    </div>
  )
}
