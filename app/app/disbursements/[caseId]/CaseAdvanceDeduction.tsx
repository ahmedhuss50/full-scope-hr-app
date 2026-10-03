'use client'

/**
 * CaseAdvanceDeduction — خصم دفعة مقدمة.
 *
 * Shown on the case page when:
 *   • The case has a vendor assigned
 *   • The case is NOT itself a downpayment voucher
 *   • The vendor has an open advance balance (totalDowns − existingDeductions > 0)
 *
 * Lets staff deduct a portion of the open advance from this invoice. The
 * net paid from escrow = amount_sar − advance_deduction_sar. Supports both
 * "enter completion % and auto-calculate" or "enter amount directly".
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, Wallet } from 'lucide-react'
import { updateCaseAdvanceDeduction } from './actions-vendor'

function fmt(n: number): string {
  return n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function CaseAdvanceDeduction({
  caseId,
  invoiceAmount,
  totalAdvance,
  otherDeductions,
  initialDeduction,
  initialPct,
  canEdit,
}: {
  caseId: string
  invoiceAmount: number
  totalAdvance: number
  otherDeductions: number    // sum of advance_deduction_sar on OTHER cases
  initialDeduction: number
  initialPct: number | null
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [amountStr, setAmountStr] = useState<string>(initialDeduction > 0 ? String(initialDeduction) : '')
  const [pctStr, setPctStr]       = useState<string>(initialPct != null ? String(initialPct) : '')
  const [busy, setBusy] = useState(false)
  const [savedTick, setSavedTick] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  // Remaining advance balance EXCLUDING this case's current deduction.
  const remainingBeforeThis = Math.max(0, totalAdvance - otherDeductions)
  // Max deductible from this invoice = min(remaining, invoice)
  const maxDeductible = Math.max(0, Math.min(remainingBeforeThis, invoiceAmount))
  const amount = Math.max(0, Number(amountStr) || 0)
  const pct    = pctStr === '' ? null : Number(pctStr)
  const net    = Math.max(0, invoiceAmount - amount)
  const overLimit = amount > maxDeductible

  // Auto-compute amount from pct: amount = (pct/100) × totalAdvance
  function onPctChange(v: string) {
    setPctStr(v)
    const n = Number(v)
    if (v !== '' && Number.isFinite(n) && totalAdvance > 0) {
      const next = Math.round((n / 100) * totalAdvance * 100) / 100
      setAmountStr(String(next))
    }
  }

  async function save() {
    if (!canEdit) return
    setErr(null)
    setBusy(true)
    const res = await updateCaseAdvanceDeduction({
      case_id: caseId,
      amount_sar: amount,
      pct: pct,
    })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    setSavedTick((n) => n + 1)
    startTransition(() => router.refresh())
  }

  async function clear() {
    if (!canEdit) return
    setErr(null)
    setAmountStr(''); setPctStr('')
    setBusy(true)
    const res = await updateCaseAdvanceDeduction({ case_id: caseId, amount_sar: 0, pct: null })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    setSavedTick((n) => n + 1)
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-3 bg-amber-50 border border-amber-300 rounded-xl p-4 shadow-sm" dir="rtl">
      <div className="flex items-center gap-2">
        <Wallet className="w-4 h-4 text-amber-700" aria-hidden="true" />
        <h3 className="text-sm font-bold text-amber-900">خصم دفعة مقدمة</h3>
        {busy && <Loader2 className="w-3 h-3 animate-spin text-amber-600" />}
        {!busy && savedTick > 0 && <Check className="w-3 h-3 text-emerald-600" />}
      </div>

      {/* Balance summary */}
      <div className="rounded-lg bg-white border border-amber-200 px-3 py-2 text-xs space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-slate-600">إجمالي الدفعة المقدمة:</span>
          <span className="font-mono font-bold text-slate-900">{fmt(totalAdvance)} ر.س</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-600">مخصوم من فواتير أخرى:</span>
          <span className="font-mono text-slate-700">−{fmt(otherDeductions)}</span>
        </div>
        <div className="border-t border-amber-200 pt-1 flex items-center justify-between">
          <span className="font-bold text-amber-900">الرصيد المتبقي:</span>
          <span className="font-mono font-bold text-amber-900">{fmt(remainingBeforeThis)} ر.س</span>
        </div>
      </div>

      {remainingBeforeThis > 0 ? (
        <>
          {/* Inputs */}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <div className="text-[11px] text-slate-700 font-bold mb-1">نسبة الإنجاز (%)</div>
              <input
                type="number"
                min="0" max="100" step="0.01"
                value={pctStr}
                onChange={(e) => onPctChange(e.target.value)}
                disabled={!canEdit || busy}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                dir="ltr" placeholder="0"
              />
              <div className="text-[10px] text-slate-500 mt-0.5">تحسب الخصم تلقائياً</div>
            </label>
            <label className="block">
              <div className="text-[11px] text-slate-700 font-bold mb-1">مبلغ الخصم (ر.س)</div>
              <input
                type="number"
                min="0" step="0.01"
                value={amountStr}
                onChange={(e) => { setAmountStr(e.target.value); setPctStr('') }}
                disabled={!canEdit || busy}
                className={`w-full rounded-lg border bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500 ${overLimit ? 'border-red-500 text-red-700' : 'border-slate-200 text-slate-900'}`}
                dir="ltr" placeholder="0.00"
              />
              <div className="text-[10px] text-slate-500 mt-0.5">
                الحد الأعلى: {fmt(maxDeductible)}
              </div>
            </label>
          </div>

          {/* Net preview */}
          <div className="rounded-lg bg-white border border-amber-200 px-3 py-2 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">قيمة الفاتورة:</span>
              <span className="font-mono text-slate-700">{fmt(invoiceAmount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">خصم مقدم (هذه الفاتورة):</span>
              <span className="font-mono text-slate-700">−{fmt(amount)}</span>
            </div>
            <div className="border-t border-amber-200 pt-1 flex items-center justify-between">
              <span className="font-bold text-emerald-800">الصافي المدفوع:</span>
              <span className="font-mono font-bold text-emerald-800">{fmt(net)} ر.س</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!canEdit || busy || overLimit}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-700 text-white text-sm font-bold hover:bg-amber-800 disabled:bg-slate-300 disabled:text-slate-500 transition"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              حفظ الخصم
            </button>
            {initialDeduction > 0 && (
              <button
                type="button"
                onClick={clear}
                disabled={!canEdit || busy}
                className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200 transition"
              >
                مسح الخصم
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="text-xs text-slate-600 bg-white border border-amber-200 rounded-lg px-3 py-2">
          الرصيد المتبقي صفر — تم استرداد كامل الدفعة المقدمة.
        </div>
      )}

      {err && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">{err}</div>}
    </div>
  )
}
