'use client'

/**
 * CpaReportEditor — client form for the CPA quarterly report record.
 * Owner-only. Holds preparer overrides, opening balance, forecast rows,
 * and 6 narrative textareas. Generate button hits /api/dsb-cpa-report.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Save, Loader2, Plus, Trash2, Download } from 'lucide-react'
import { upsertCpaReport, type ForecastRow } from './actions'

const inp =
  'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

export function CpaReportEditor({
  projectId,
  initialYear,
  initialQuarter,
  initialReport,
  tenantDefaults,
}: {
  projectId: string
  initialYear: number
  initialQuarter: number
  initialReport: {
    preparer_name: string | null
    preparer_phone: string | null
    preparer_email: string | null
    opening_balance_sar: number
    forecast_rows: ForecastRow[]
    notes_sales: string | null
    notes_expenses: string | null
    notes_collection: string | null
    notes_current_risks: string | null
    notes_future_risks: string | null
    notes_other: string | null
  } | null
  tenantDefaults: {
    preparer_name: string | null
    preparer_phone: string | null
    preparer_email: string | null
  }
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [year, setYear]       = useState<number>(initialYear)
  const [quarter, setQuarter] = useState<number>(initialQuarter)

  const [prepName, setPrepName]   = useState<string>(initialReport?.preparer_name  ?? tenantDefaults.preparer_name  ?? '')
  const [prepPhone, setPrepPhone] = useState<string>(initialReport?.preparer_phone ?? tenantDefaults.preparer_phone ?? '')
  const [prepEmail, setPrepEmail] = useState<string>(initialReport?.preparer_email ?? tenantDefaults.preparer_email ?? '')

  const [openBal, setOpenBal] = useState<string>(String(initialReport?.opening_balance_sar ?? 0))

  const [forecast, setForecast] = useState<ForecastRow[]>(initialReport?.forecast_rows ?? [])

  const [nSales, setNSales]                 = useState<string>(initialReport?.notes_sales ?? '')
  const [nExpenses, setNExpenses]           = useState<string>(initialReport?.notes_expenses ?? '')
  const [nCollection, setNCollection]       = useState<string>(initialReport?.notes_collection ?? '')
  const [nCurrentRisks, setNCurrentRisks]   = useState<string>(initialReport?.notes_current_risks ?? '')
  const [nFutureRisks, setNFutureRisks]     = useState<string>(initialReport?.notes_future_risks ?? '')
  const [nOther, setNOther]                 = useState<string>(initialReport?.notes_other ?? '')

  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState<string | null>(null)
  const [msg, setMsg]   = useState<string | null>(null)

  function addForecastRow() {
    const seq = forecast.length === 0 ? 1 : Math.max(...forecast.map((r) => r.seq)) + 1
    setForecast([...forecast, { seq, label_ar: '', side: 'debit', amount_sar: 0 }])
  }
  function removeForecastRow(seq: number) {
    setForecast(forecast.filter((r) => r.seq !== seq))
  }
  function editForecastRow(seq: number, patch: Partial<ForecastRow>) {
    setForecast(forecast.map((r) => (r.seq === seq ? { ...r, ...patch } : r)))
  }

  async function onSave() {
    setErr(null); setMsg(null); setBusy(true)
    const res = await upsertCpaReport({
      project_id: projectId,
      period_year: year,
      period_quarter: quarter,
      preparer_name: prepName || null,
      preparer_phone: prepPhone || null,
      preparer_email: prepEmail || null,
      opening_balance_sar: Number(openBal) || 0,
      forecast_rows: forecast,
      notes_sales: nSales || null,
      notes_expenses: nExpenses || null,
      notes_collection: nCollection || null,
      notes_current_risks: nCurrentRisks || null,
      notes_future_risks: nFutureRisks || null,
      notes_other: nOther || null,
    })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    setMsg('تم الحفظ.')
    startTransition(() => router.refresh())
  }

  async function onGenerate() {
    // Placeholder — the actual xlsx generator will live at
    // /api/dsb-cpa-report and stream the filled template.
    setErr(null); setMsg(null); setBusy(true)
    try {
      const res = await fetch(`/api/dsb-cpa-report?project=${projectId}&year=${year}&quarter=${quarter}`)
      setBusy(false)
      if (!res.ok) {
        const t = await res.text()
        setErr(t || `HTTP ${res.status}`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `نموذج المحاسب — Q${quarter} ${year}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setBusy(false)
      setErr(e instanceof Error ? e.message : 'تعذّر إنشاء الملف.')
    }
  }

  return (
    <div className="space-y-5">
      {/* Period selector */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <h3 className="text-sm font-bold text-slate-800 mb-2">الفترة</h3>
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <Field label="السنة">
            <input type="number" min={2020} max={2100} className={inp} value={year} onChange={(e) => setYear(Number(e.target.value) || year)} disabled={busy} dir="ltr" />
          </Field>
          <Field label="الربع">
            <select className={inp} value={quarter} onChange={(e) => setQuarter(Number(e.target.value) || 1)} disabled={busy}>
              <option value={1}>Q1</option>
              <option value={2}>Q2</option>
              <option value={3}>Q3</option>
              <option value={4}>Q4</option>
            </select>
          </Field>
        </div>
      </section>

      {/* Preparer */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <h3 className="text-sm font-bold text-slate-800 mb-2">معد التقرير</h3>
        <p className="text-[11px] text-slate-500 mb-3">اترك الحقول فارغة لاستخدام بيانات مكتب المحاسبة الافتراضية.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="الاسم"><input type="text" className={inp} value={prepName} onChange={(e) => setPrepName(e.target.value)} disabled={busy} /></Field>
          <Field label="رقم الجوال"><input type="text" className={inp} value={prepPhone} onChange={(e) => setPrepPhone(e.target.value)} disabled={busy} dir="ltr" /></Field>
          <Field label="البريد الإلكتروني"><input type="email" className={inp} value={prepEmail} onChange={(e) => setPrepEmail(e.target.value)} disabled={busy} dir="ltr" /></Field>
        </div>
      </section>

      {/* Opening balance */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <h3 className="text-sm font-bold text-slate-800 mb-2">رصيد إغلاق الربع السابق</h3>
        <div className="max-w-md">
          <input type="number" step="0.01" min={0} className={`${inp} font-mono`} value={openBal} onChange={(e) => setOpenBal(e.target.value)} disabled={busy} dir="ltr" />
        </div>
      </section>

      {/* Forecast rows */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">العمليات المتوقعة للربع القادم</h3>
          <button type="button" onClick={addForecastRow} disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">
            <Plus className="w-3 h-3" /> إضافة عملية
          </button>
        </div>
        <div className="overflow-x-auto border border-slate-200 rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-right">
              <tr>
                <th className="px-2 py-1.5 text-xs font-bold text-slate-600">#</th>
                <th className="px-2 py-1.5 text-xs font-bold text-slate-600">البيان</th>
                <th className="px-2 py-1.5 text-xs font-bold text-slate-600">النوع</th>
                <th className="px-2 py-1.5 text-xs font-bold text-slate-600">المبلغ</th>
                <th className="px-2 py-1.5 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {forecast.length === 0 && (
                <tr><td colSpan={5} className="p-4 text-center text-xs text-slate-400 italic">لا توجد عمليات متوقعة.</td></tr>
              )}
              {forecast.map((r) => (
                <tr key={r.seq}>
                  <td className="px-2 py-1 font-mono text-xs">{r.seq}</td>
                  <td className="px-2 py-1">
                    <input type="text" className={inp} value={r.label_ar} onChange={(e) => editForecastRow(r.seq, { label_ar: e.target.value })} disabled={busy} placeholder="مثال: تكاليف انشائية" />
                  </td>
                  <td className="px-2 py-1">
                    <select className={inp} value={r.side} onChange={(e) => editForecastRow(r.seq, { side: e.target.value === 'credit' ? 'credit' : 'debit' })} disabled={busy}>
                      <option value="debit">مدين</option>
                      <option value="credit">دائن</option>
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" step="0.01" min={0} className={`${inp} font-mono`} value={r.amount_sar} onChange={(e) => editForecastRow(r.seq, { amount_sar: Number(e.target.value) || 0 })} disabled={busy} dir="ltr" />
                  </td>
                  <td className="px-2 py-1">
                    <button type="button" onClick={() => removeForecastRow(r.seq)} disabled={busy}
                      className="inline-flex items-center justify-center w-6 h-6 rounded-md text-red-600 hover:bg-red-50">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Narrative — Sheet 6 */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-800">النتائج والملاحظات (ورقة 6)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="المبيعات"><textarea rows={3} className={inp + ' min-h-[70px]'} value={nSales} onChange={(e) => setNSales(e.target.value)} disabled={busy} /></Field>
          <Field label="المصروفات"><textarea rows={3} className={inp + ' min-h-[70px]'} value={nExpenses} onChange={(e) => setNExpenses(e.target.value)} disabled={busy} /></Field>
          <Field label="التحصيل / التمويل"><textarea rows={3} className={inp + ' min-h-[70px]'} value={nCollection} onChange={(e) => setNCollection(e.target.value)} disabled={busy} /></Field>
          <Field label="المخاطر الحالية"><textarea rows={3} className={inp + ' min-h-[70px]'} value={nCurrentRisks} onChange={(e) => setNCurrentRisks(e.target.value)} disabled={busy} /></Field>
          <Field label="المخاطر المستقبلية"><textarea rows={3} className={inp + ' min-h-[70px]'} value={nFutureRisks} onChange={(e) => setNFutureRisks(e.target.value)} disabled={busy} /></Field>
          <Field label="ملاحظات أخرى"><textarea rows={3} className={inp + ' min-h-[70px]'} value={nOther} onChange={(e) => setNOther(e.target.value)} disabled={busy} /></Field>
        </div>
      </section>

      {err && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{err}</div>}
      {msg && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">{msg}</div>}

      <div className="flex items-center gap-3 flex-wrap sticky bottom-4 bg-white/95 backdrop-blur border border-slate-200 rounded-xl shadow-lg p-3">
        <button type="button" onClick={onSave} disabled={busy}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-bold hover:bg-teal-700 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          حفظ التقرير
        </button>
        <button type="button" onClick={onGenerate} disabled={busy}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-50">
          <Download className="w-4 h-4" />
          توليد وتنزيل النموذج (.xlsx)
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  )
}
