'use client'

/**
 * VendorDownpaymentEditor — per-vendor developer downpayment + milestone
 * plan editor. Renders at the top of the VendorReceiptsPanel for owners.
 *
 * Distinct from:
 *   - the PROJECT-level downpayment plan (DownpaymentPlanSection above the
 *     vendor list — one pool for the whole project)
 *   - the CONTRACT-level installment schedule (ScheduleEditor per contract
 *     inside this panel — invoicing rhythm per contract)
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Save, Loader2, CheckCircle2, Circle, ChevronDown, ChevronUp, Wallet } from 'lucide-react'
import {
  updateVendorDownpayment,
  updateVendorDownpaymentPlan,
  markVendorMilestoneReleased,
  type VendorDownpaymentMilestone,
} from './receipts-actions'

function fmtSar(n: number): string {
  try {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency', currency: 'SAR', maximumFractionDigits: 0,
    }).format(n)
  } catch { return `${Math.round(n)} ر.س` }
}

function todayISO(): string { return new Date().toISOString().slice(0, 10) }

const inputCls =
  'w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-50'

export function VendorDownpaymentEditor({
  vendorId,
  vendorName,
  initialDownpayment,
  initialPlan,
  paidToVendor,
  fundedFromVouchers = 0,
  canEdit,
}: {
  vendorId: string
  vendorName: string
  initialDownpayment: number
  initialPlan: VendorDownpaymentMilestone[]
  /** Sum of INVOICE cases paid to this vendor (deducts from the pool). */
  paidToVendor: number
  /**
   * Sum of paid DOWNPAYMENT cases (وثائق صرف flagged as دفعة مقدمة).
   * These represent money moved FROM the escrow account INTO the vendor's
   * downpayment pool, so they ADD to what's deposited.
   */
  fundedFromVouchers?: number
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(initialDownpayment > 0 || initialPlan.length > 0)
  const [downpayment, setDownpayment] = useState<string>(String(initialDownpayment || ''))
  const [plan, setPlan] = useState<VendorDownpaymentMilestone[]>(initialPlan)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  function addRow() {
    const nextSeq = plan.length === 0 ? 1 : Math.max(...plan.map((p) => p.seq)) + 1
    setPlan([...plan, { seq: nextSeq, label_ar: '', completion_pct: 0, amount_sar: 0, released_at: null }])
  }
  function removeRow(seq: number) { setPlan(plan.filter((p) => p.seq !== seq)) }
  function editRow(seq: number, patch: Partial<VendorDownpaymentMilestone>) {
    setPlan(plan.map((p) => (p.seq === seq ? { ...p, ...patch } : p)))
  }

  async function saveAll() {
    setErr(null); setMsg(null); setBusy(true)
    const totalAmount = Number(downpayment.replace(/,/g, '')) || 0
    const totalRes = await updateVendorDownpayment({ vendor_id: vendorId, amount_sar: totalAmount })
    if (!totalRes.ok) { setErr(totalRes.error); setBusy(false); return }
    const planRes = await updateVendorDownpaymentPlan({ vendor_id: vendorId, plan })
    setBusy(false)
    if (!planRes.ok) { setErr(planRes.error); return }
    setMsg('تم الحفظ.')
    startTransition(() => router.refresh())
  }

  async function toggleReleased(seq: number, currentReleased: string | null | undefined) {
    setErr(null); setBusy(true)
    const res = await markVendorMilestoneReleased({
      vendor_id: vendorId, seq,
      released_at: currentReleased ? null : todayISO(),
    })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    startTransition(() => router.refresh())
  }

  const committed   = Number(downpayment) || 0
  const planTotal   = plan.reduce((n, m) => n + Number(m.amount_sar || 0), 0)
  const released    = plan.filter((m) => m.released_at).reduce((n, m) => n + Number(m.amount_sar || 0), 0)
  // Total pool = the developer's manual commitment + everything actually
  // funded into it via signed «دفعة مقدمة» vouchers.
  const totalPool   = committed + fundedFromVouchers
  const remaining   = totalPool - paidToVendor
  const usagePct    = totalPool > 0 ? Math.min(100, (paidToVendor / totalPool) * 100) : 0
  const overBudget  = remaining < 0
  // Kept for the collapsed-header chip.
  const total       = committed

  return (
    <div className="rounded-lg bg-indigo-50/40 border border-indigo-200 p-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 text-right"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Wallet className="w-4 h-4 text-indigo-700" aria-hidden="true" />
          <span className="text-sm font-bold text-indigo-900">دفعة المطوّر لهذا المورد</span>
          {total > 0 && (
            <span className="text-[11px] font-mono text-indigo-800 bg-white/70 rounded-full px-2 py-0.5">
              {fmtSar(total)} · مفرج {fmtSar(released)}
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-indigo-700" /> : <ChevronDown className="w-4 h-4 text-indigo-700" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs font-semibold text-slate-700">إجمالي الدفعة المخصصة لـ «{vendorName}»:</label>
            <input
              type="text" inputMode="decimal"
              className={`${inputCls} w-48 font-mono`}
              value={downpayment}
              onChange={(e) => setDownpayment(e.target.value)}
              disabled={!canEdit || busy}
              placeholder="0"
            />
            <span className="text-xs text-slate-500">ر.س</span>
          </div>

          {/* Rollup — auto-computed from وثائق الصرف of this vendor */}
          {(totalPool > 0 || fundedFromVouchers > 0) && (
            <div className="rounded-lg bg-white ring-1 ring-slate-200 p-3 space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-right">
                <RollupBox label="التزام المطوّر" value={fmtSar(committed)} tone="slate" />
                <RollupBox label="مُودَع فعليًا (سندات دفعة مقدمة)" value={fmtSar(fundedFromVouchers)} tone="indigo" />
                <RollupBox label="مُسدَّد للمورد (فواتير)" value={fmtSar(paidToVendor)} tone="amber" />
                <RollupBox label="الرصيد المتاح" value={fmtSar(remaining)} tone={overBudget ? 'red' : 'emerald'} />
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full ${overBudget ? 'bg-red-500' : usagePct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(100, usagePct)}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                «التزام المطوّر» = المبلغ المخطَّط له. «مُودَع فعليًا» = وثائق صرف
                موقّعة بعلامة «دفعة مقدمة» — تضاف للرصيد. «مُسدَّد للمورد» = فواتير
                موقّعة — تُخصم من الرصيد.
              </p>
            </div>
          )}

          {planTotal !== total && total > 0 && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
              مجموع الخطة {fmtSar(planTotal)} لا يساوي الإجمالي {fmtSar(total)}.
            </p>
          )}

          <div className="overflow-x-auto border border-slate-200 rounded-md bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-right">
                <tr>
                  <th className="px-2 py-1.5 font-bold text-slate-600">#</th>
                  <th className="px-2 py-1.5 font-bold text-slate-600">الوصف</th>
                  <th className="px-2 py-1.5 font-bold text-slate-600">نسبة الإنجاز</th>
                  <th className="px-2 py-1.5 font-bold text-slate-600">المبلغ</th>
                  <th className="px-2 py-1.5 font-bold text-slate-600">الحالة</th>
                  {canEdit && <th className="px-2 py-1.5 w-8"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plan.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 6 : 5} className="p-4 text-center text-slate-400 italic">
                      لا توجد ميلستونات بعد. {canEdit && 'اضغط «إضافة دفعة» أدناه للبدء.'}
                    </td>
                  </tr>
                )}
                {plan.map((m) => (
                  <tr key={m.seq} className="align-top">
                    <td className="px-2 py-1 font-mono">{m.seq}</td>
                    <td className="px-2 py-1">
                      <input className={inputCls} value={m.label_ar}
                        onChange={(e) => editRow(m.seq, { label_ar: e.target.value })}
                        disabled={!canEdit || busy}
                        placeholder="مثال: عند إنجاز 50٪" />
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <input className={`${inputCls} w-16 text-center font-mono`}
                          type="number" min={0} max={100} step={1}
                          value={m.completion_pct}
                          onChange={(e) => editRow(m.seq, { completion_pct: Number(e.target.value) || 0 })}
                          disabled={!canEdit || busy} />
                        <span className="text-[10px] text-slate-500">٪</span>
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <input className={`${inputCls} w-32 font-mono`}
                        type="number" min={0} step={1000}
                        value={m.amount_sar}
                        onChange={(e) => editRow(m.seq, { amount_sar: Number(e.target.value) || 0 })}
                        disabled={!canEdit || busy} />
                    </td>
                    <td className="px-2 py-1">
                      <button type="button"
                        onClick={() => canEdit && toggleReleased(m.seq, m.released_at ?? null)}
                        disabled={!canEdit || busy}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ring-1 ring-inset ${
                          m.released_at
                            ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 hover:bg-emerald-100'
                            : 'bg-slate-50 text-slate-700 ring-slate-200 hover:bg-slate-100'
                        } ${!canEdit ? 'cursor-default' : 'cursor-pointer'}`}
                      >
                        {m.released_at ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
                        {m.released_at ? m.released_at : 'قيد الانتظار'}
                      </button>
                    </td>
                    {canEdit && (
                      <td className="px-2 py-1">
                        <button type="button" onClick={() => removeRow(m.seq)} disabled={busy}
                          className="inline-flex items-center justify-center w-6 h-6 rounded-md text-red-600 hover:bg-red-50">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {err && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">{err}</div>}
          {msg && <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1">{msg}</div>}

          {canEdit && (
            <div className="flex items-center gap-2 justify-between flex-wrap">
              <button type="button" onClick={addRow} disabled={busy}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-indigo-300 bg-white text-indigo-800 text-[11px] font-bold hover:bg-indigo-50">
                <Plus className="w-3 h-3" /> إضافة دفعة
              </button>
              <button type="button" onClick={saveAll} disabled={busy}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-indigo-600 text-white text-[11px] font-bold hover:bg-indigo-700 disabled:opacity-50">
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                حفظ
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RollupBox({
  label, value, tone,
}: {
  label: string
  value: string
  tone: 'indigo' | 'amber' | 'emerald' | 'red' | 'slate'
}) {
  const cls =
    tone === 'indigo'  ? 'bg-indigo-50 text-indigo-800 ring-indigo-200' :
    tone === 'amber'   ? 'bg-amber-50 text-amber-800 ring-amber-200' :
    tone === 'emerald' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' :
    tone === 'slate'   ? 'bg-slate-50 text-slate-800 ring-slate-200' :
                         'bg-red-50 text-red-800 ring-red-200'
  return (
    <div className={`rounded-md ring-1 ring-inset ${cls} px-2.5 py-1.5`}>
      <div className="text-[9px] font-bold uppercase tracking-widest opacity-80">{label}</div>
      <div className="mt-0.5 text-sm font-black font-mono">{value}</div>
    </div>
  )
}
