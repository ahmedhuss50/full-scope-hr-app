'use client'

/**
 * DeveloperDownpaymentEditor — pencil icon that opens a small inline dialog
 * to edit dsb_projects.developer_downpayment_sar. Owner-only.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Check, X, Loader2 } from 'lucide-react'
import { updateDeveloperDownpayment } from './actions-downpayment'

export function DeveloperDownpaymentEditor({
  projectId,
  initialValue,
}: {
  projectId: string
  initialValue: number
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(initialValue || ''))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setErr(null)
    const amount = Number(value.replace(/,/g, ''))
    if (!Number.isFinite(amount) || amount < 0) {
      setErr('المبلغ غير صالح.')
      return
    }
    setBusy(true)
    const res = await updateDeveloperDownpayment({ projectId, amount_sar: amount })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    setEditing(false)
    startTransition(() => router.refresh())
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setValue(String(initialValue || '')); setEditing(true) }}
        title="تعديل مبلغ الدفعة المقدّمة"
        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-500 hover:bg-white/60"
      >
        <Pencil className="w-3 h-3" aria-hidden="true" />
      </button>
    )
  }

  return (
    <div className="relative">
      <div className="absolute top-6 left-0 z-10 bg-white border border-slate-200 rounded-lg shadow-lg p-3 w-64" dir="rtl">
        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
          إجمالي الدفعة المقدّمة من المطوّر (ر.س)
        </label>
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void save() }
            if (e.key === 'Escape') setEditing(false)
          }}
          disabled={busy}
          placeholder="0"
        />
        {err && <div className="mt-2 text-[11px] text-red-700">{err}</div>}
        <div className="mt-2 flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={busy}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:bg-slate-100"
            title="إلغاء"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            حفظ
          </button>
        </div>
      </div>
    </div>
  )
}
