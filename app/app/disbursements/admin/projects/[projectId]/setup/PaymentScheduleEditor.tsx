'use client'

/**
 * Inline editor for the per-project buyer-payment installment schedule
 * (جدول الدفعات). Ships with the Mohammed Al Habib 7-row template as the
 * default; owner can rename any row, tweak both percentages, or add/remove
 * rows. Saves only when the payment_pct column sums to 100.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Save, Trash2, Plus, RotateCcw, Loader2 } from 'lucide-react'
import { updateProjectPaymentSchedule, type PaymentInstallment } from '../../../edit-actions'

const DEFAULT_SCHEDULE: PaymentInstallment[] = [
  { seq: 1, label_ar: 'الدفعة الأولى (المقدمة)',                  completion_pct: 0,   payment_pct: 20 },
  { seq: 2, label_ar: 'الثانية',                                  completion_pct: 20,  payment_pct: 20 },
  { seq: 3, label_ar: 'الثالثة',                                  completion_pct: 40,  payment_pct: 20 },
  { seq: 4, label_ar: 'الرابعة',                                  completion_pct: 60,  payment_pct: 15 },
  { seq: 5, label_ar: 'الخامسة',                                  completion_pct: 70,  payment_pct: 15 },
  { seq: 6, label_ar: 'السادسة',                                  completion_pct: 85,  payment_pct: 5  },
  { seq: 7, label_ar: 'الدفعة الأخيرة عند الإفراغ او التسليم', completion_pct: 100, payment_pct: 5  },
]

export function PaymentScheduleEditor({
  projectId,
  initial,
}: {
  projectId: string
  initial: PaymentInstallment[] | null | undefined
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [rows, setRows] = useState<PaymentInstallment[]>(
    initial && initial.length > 0 ? initial : DEFAULT_SCHEDULE,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const totalPct = rows.reduce((n, r) => n + (Number(r.payment_pct) || 0), 0)
  const balanced = Math.abs(totalPct - 100) < 0.01

  function updateRow(i: number, patch: Partial<PaymentInstallment>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function addRow() {
    const nextSeq = rows.length > 0 ? Math.max(...rows.map((r) => r.seq)) + 1 : 1
    setRows((prev) => [...prev, { seq: nextSeq, label_ar: '', completion_pct: 0, payment_pct: 0 }])
  }
  function deleteRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i))
  }
  function resetToDefault() {
    setRows(DEFAULT_SCHEDULE.map((r) => ({ ...r })))
    setError(null); setOkMsg(null)
  }

  async function onSave() {
    setError(null); setOkMsg(null); setBusy(true)
    const res = await updateProjectPaymentSchedule({ project_id: projectId, schedule: rows })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    setOkMsg('حُفظ جدول الدفعات.')
    startTransition(() => router.refresh())
    setTimeout(() => setOkMsg(null), 3000)
  }

  const inputCls = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500'
  const numCls = inputCls + ' text-center font-mono'

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 text-right text-xs font-bold text-slate-600 w-16">رقم الدفعة</th>
              <th className="px-3 py-2 text-right text-xs font-bold text-slate-600">الدفعة</th>
              <th className="px-3 py-2 text-right text-xs font-bold text-slate-600 w-32">نسبة الإنجاز</th>
              <th className="px-3 py-2 text-right text-xs font-bold text-slate-600 w-32">نسبة الدفعة</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={i} className="bg-white">
                <td className="px-3 py-2">
                  <input className={numCls} type="number" value={r.seq} onChange={(e) => updateRow(i, { seq: Number(e.target.value) })} disabled={busy} min={1} />
                </td>
                <td className="px-3 py-2">
                  <input className={inputCls} value={r.label_ar} onChange={(e) => updateRow(i, { label_ar: e.target.value })} disabled={busy} maxLength={80} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <input className={numCls} type="number" value={r.completion_pct} onChange={(e) => updateRow(i, { completion_pct: Number(e.target.value) })} disabled={busy} min={0} max={100} step={0.01} />
                    <span className="text-xs text-slate-400">%</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <input className={numCls} type="number" value={r.payment_pct} onChange={(e) => updateRow(i, { payment_pct: Number(e.target.value) })} disabled={busy} min={0} max={100} step={0.01} />
                    <span className="text-xs text-slate-400">%</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-center">
                  <button type="button" onClick={() => deleteRow(i)} disabled={busy} title="حذف" className="inline-flex items-center justify-center w-7 h-7 rounded-md text-red-600 hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
            <tr className={balanced ? 'bg-emerald-50/50' : 'bg-amber-50/50'}>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2 text-xs font-bold text-slate-700">الإجمالي</td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2 text-center font-mono text-sm font-bold">
                {totalPct.toFixed(2)}%
              </td>
              <td className="px-3 py-2"></td>
            </tr>
          </tbody>
        </table>
      </div>

      {!balanced && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 font-semibold">
          مجموع نسب الدفعات يجب أن يساوي 100٪ بالضبط.
        </div>
      )}
      {error && (<div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 font-semibold">{error}</div>)}
      {okMsg && (<div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 font-semibold">{okMsg}</div>)}

      <div className="flex items-center gap-2">
        <button type="button" onClick={onSave} disabled={busy || !balanced} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-bold hover:bg-teal-700 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" aria-hidden="true" />}
          {busy ? 'جارٍ الحفظ…' : 'حفظ الجدول'}
        </button>
        <button type="button" onClick={addRow} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> إضافة دفعة
        </button>
        <button type="button" onClick={resetToDefault} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50">
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> استرجاع الافتراضي
        </button>
      </div>
    </div>
  )
}
