'use client'

/**
 * DownpaymentPlanEditor — inline editor for:
 *   1. total developer_downpayment_sar
 *   2. the milestone-based spending plan (add/edit/remove rows,
 *      mark rows released with a date, save all)
 *
 * Owner-only writes; read-only for other roles (canEdit=false).
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Save, Loader2, CheckCircle2, Circle } from 'lucide-react'
import {
  updateDeveloperDownpayment,
  updateDownpaymentPlan,
  markMilestoneReleased,
  type DownpaymentMilestone,
} from './actions-downpayment'

const inputCls =
  'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-50'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function DownpaymentPlanEditor({
  projectId,
  initialDownpayment,
  initialPlan,
  canEdit,
}: {
  projectId: string
  initialDownpayment: number
  initialPlan: DownpaymentMilestone[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [downpayment, setDownpayment] = useState<string>(String(initialDownpayment || ''))
  const [plan, setPlan] = useState<DownpaymentMilestone[]>(
    initialPlan.length > 0
      ? initialPlan
      : [],
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  function addRow() {
    const nextSeq = plan.length === 0 ? 1 : Math.max(...plan.map((p) => p.seq)) + 1
    setPlan([...plan, {
      seq: nextSeq,
      label_ar: '',
      completion_pct: 0,
      amount_sar: 0,
      released_at: null,
    }])
  }

  function removeRow(seq: number) {
    setPlan(plan.filter((p) => p.seq !== seq))
  }

  function editRow(seq: number, patch: Partial<DownpaymentMilestone>) {
    setPlan(plan.map((p) => (p.seq === seq ? { ...p, ...patch } : p)))
  }

  async function saveAll() {
    setErr(null); setMsg(null); setBusy(true)
    // 1) save total
    const totalAmount = Number(downpayment.replace(/,/g, '')) || 0
    const totalRes = await updateDeveloperDownpayment({ projectId, amount_sar: totalAmount })
    if (!totalRes.ok) { setErr(totalRes.error); setBusy(false); return }
    // 2) save plan
    const planRes = await updateDownpaymentPlan({ projectId, plan })
    setBusy(false)
    if (!planRes.ok) { setErr(planRes.error); return }
    setMsg('تم الحفظ.')
    startTransition(() => router.refresh())
  }

  async function toggleReleased(seq: number, currentReleased: string | null | undefined) {
    setErr(null); setBusy(true)
    const res = await markMilestoneReleased({
      projectId, seq,
      released_at: currentReleased ? null : todayISO(),
    })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-3">
      {/* Total downpayment input */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-sm font-semibold text-slate-700">
          إجمالي الدفعة المقدّمة من المطوّر:
        </label>
        <input
          type="text"
          inputMode="decimal"
          className={`${inputCls} w-52 font-mono`}
          value={downpayment}
          onChange={(e) => setDownpayment(e.target.value)}
          disabled={!canEdit || busy}
          placeholder="0"
        />
        <span className="text-xs text-slate-500">ر.س</span>
      </div>

      {/* Plan table */}
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-right">
            <tr>
              <Th>#</Th>
              <Th>الوصف</Th>
              <Th>نسبة الإنجاز</Th>
              <Th>المبلغ</Th>
              <Th>الحالة</Th>
              {canEdit && <Th>حذف</Th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {plan.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="p-6 text-center text-sm text-slate-400">
                  لا توجد ميلستونات بعد. {canEdit && 'اضغط «إضافة دفعة» أدناه للبدء.'}
                </td>
              </tr>
            )}
            {plan.map((m) => (
              <tr key={m.seq} className="align-top">
                <Td>
                  <span className="font-mono text-xs">{m.seq}</span>
                </Td>
                <Td>
                  <input
                    type="text"
                    className={inputCls}
                    value={m.label_ar}
                    onChange={(e) => editRow(m.seq, { label_ar: e.target.value })}
                    disabled={!canEdit || busy}
                    placeholder="مثال: عند إنجاز 10٪ من المشروع"
                  />
                </Td>
                <Td>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0} max={100} step={1}
                      className={`${inputCls} w-20 font-mono text-center`}
                      value={m.completion_pct}
                      onChange={(e) => editRow(m.seq, { completion_pct: Number(e.target.value) || 0 })}
                      disabled={!canEdit || busy}
                    />
                    <span className="text-xs text-slate-500">٪</span>
                  </div>
                </Td>
                <Td>
                  <input
                    type="number"
                    min={0} step={1000}
                    className={`${inputCls} w-36 font-mono`}
                    value={m.amount_sar}
                    onChange={(e) => editRow(m.seq, { amount_sar: Number(e.target.value) || 0 })}
                    disabled={!canEdit || busy}
                  />
                </Td>
                <Td>
                  <button
                    type="button"
                    onClick={() => canEdit && toggleReleased(m.seq, m.released_at ?? null)}
                    disabled={!canEdit || busy}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ring-1 ring-inset transition ${
                      m.released_at
                        ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 hover:bg-emerald-100'
                        : 'bg-slate-50 text-slate-700 ring-slate-200 hover:bg-slate-100'
                    } ${!canEdit ? 'cursor-default' : 'cursor-pointer'}`}
                    title={canEdit ? (m.released_at ? 'إلغاء الإفراج' : 'وضع علامة كمُفرج عنه') : ''}
                  >
                    {m.released_at ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
                    {m.released_at ? `مفرج عنه (${m.released_at})` : 'قيد الانتظار'}
                  </button>
                </Td>
                {canEdit && (
                  <Td>
                    <button
                      type="button"
                      onClick={() => removeRow(m.seq)}
                      disabled={busy}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-red-600 hover:bg-red-50"
                      title="حذف الصف"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {err && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}
      {msg && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</div>}

      {canEdit && (
        <div className="flex items-center gap-2 justify-between flex-wrap">
          <button
            type="button"
            onClick={addRow}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-800 text-xs font-semibold hover:bg-indigo-100"
          >
            <Plus className="w-3.5 h-3.5" /> إضافة دفعة
          </button>
          <button
            type="button"
            onClick={saveAll}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            حفظ الإجمالي والخطة
          </button>
        </div>
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-[11px] font-bold text-slate-600 uppercase tracking-wider">{children}</th>
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2">{children}</td>
}
