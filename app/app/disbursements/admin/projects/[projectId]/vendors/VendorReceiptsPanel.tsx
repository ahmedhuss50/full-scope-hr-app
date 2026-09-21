'use client'

/**
 * VendorReceiptsPanel — per-vendor payment tracking.
 *
 * Renders three sections in a card:
 *   1. Rollup: contract value · invoiced · paid · remaining
 *   2. Installment schedule (editable inline: seq, label, amount, paid-tick)
 *   3. Receipts table with add/edit/delete + "إنشاء سند صرف" per row
 *
 * All server actions live in ./receipts-actions.ts.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Save, Plus, Trash2, FileText, ExternalLink, Loader2, Check, X, Pencil,
} from 'lucide-react'
import {
  updateVendorContractSchedule,
  markInstallmentPaid,
  createVendorReceipt,
  updateVendorReceipt,
  deleteVendorReceipt,
  createCaseFromReceipt,
  type VendorInstallment,
  type VendorDownpaymentMilestone,
} from './receipts-actions'
import { VendorDownpaymentEditor } from './VendorDownpaymentEditor'

export type ContractLite = {
  id: string
  contract_number: string | null
  total_amount_sar: number | null
  amount_before_tax_sar: number | null
  vat_sar: number | null
  payment_schedule: VendorInstallment[] | null
}

export type ReceiptLite = {
  id: string
  contract_id: string | null
  installment_seq: number | null
  receipt_number: string | null
  receipt_date: string | null
  amount_before_tax_sar: number
  vat_sar: number
  total_amount_sar: number
  description: string | null
  disbursement_type_code: string | null
  status: 'pending' | 'invoiced' | 'paid'
  case_id: string | null
}

export type DisbursementTypeOption = { code: string; label: string }

function fmtSar(n: number | null | undefined): string {
  if (n == null) return '—'
  try { return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }).format(n) }
  catch { return `${Math.round(n)} ر.س` }
}

export function VendorReceiptsPanel({
  vendorId,
  vendorName,
  contracts,
  receipts,
  disbursementTypes,
  vendorDownpayment,
  vendorDownpaymentPlan,
  canEdit,
}: {
  vendorId: string
  vendorName: string
  contracts: ContractLite[]
  receipts: ReceiptLite[]
  disbursementTypes: DisbursementTypeOption[]
  vendorDownpayment: number
  vendorDownpaymentPlan: VendorDownpaymentMilestone[]
  canEdit: boolean
}) {
  // Pick the primary contract (first) as the working target. For vendors
  // with multiple contracts, we let the user switch via the receipt row.
  const primary = contracts[0]
  const schedule = primary?.payment_schedule ?? []

  // Rollups.
  const contractTotal = contracts.reduce((n, c) => n + Number(c.total_amount_sar || 0), 0)
  const invoiced      = receipts.reduce((n, r) => n + Number(r.total_amount_sar || 0), 0)
  const paid          = receipts.filter((r) => r.status === 'paid').reduce((n, r) => n + Number(r.total_amount_sar || 0), 0)
  const remaining     = Math.max(0, contractTotal - paid)

  return (
    <div className="border-t border-slate-100 bg-slate-50/40 p-4 space-y-4" dir="rtl">
      <VendorDownpaymentEditor
        vendorId={vendorId}
        vendorName={vendorName}
        initialDownpayment={vendorDownpayment}
        initialPlan={vendorDownpaymentPlan}
        canEdit={canEdit}
      />
      <RollupCard contractTotal={contractTotal} invoiced={invoiced} paid={paid} remaining={remaining} />
      {primary && (
        <ScheduleEditor
          contractId={primary.id}
          initial={schedule}
          suggestedTotal={Number(primary.total_amount_sar || 0)}
        />
      )}
      <ReceiptsTable
        vendorId={vendorId}
        contracts={contracts}
        receipts={receipts}
        disbursementTypes={disbursementTypes}
      />
    </div>
  )
}

/* ─────────────────────────────  Rollup  ───────────────────────────── */

function RollupCard({
  contractTotal, invoiced, paid, remaining,
}: {
  contractTotal: number; invoiced: number; paid: number; remaining: number
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <Kpi label="قيمة العقد"   value={fmtSar(contractTotal)} tone="slate" />
      <Kpi label="المُفوتَر"     value={fmtSar(invoiced)}      tone="teal"  />
      <Kpi label="المُسدَّد"     value={fmtSar(paid)}          tone="emerald"/>
      <Kpi label="المتبقي"       value={fmtSar(remaining)}     tone="amber" />
    </div>
  )
}
function Kpi({ label, value, tone }: { label: string; value: string; tone: 'slate' | 'teal' | 'emerald' | 'amber' }) {
  const cls =
    tone === 'teal'    ? 'bg-teal-50 text-teal-800 ring-teal-200' :
    tone === 'emerald' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' :
    tone === 'amber'   ? 'bg-amber-50 text-amber-800 ring-amber-200' :
                         'bg-white text-slate-800 ring-slate-200'
  return (
    <div className={`rounded-lg ring-1 ring-inset px-3 py-2 ${cls}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">{label}</div>
      <div className="mt-1 text-base font-black font-mono">{value}</div>
    </div>
  )
}

/* ─────────────────────────────  Schedule  ───────────────────────────── */

function ScheduleEditor({
  contractId, initial, suggestedTotal,
}: {
  contractId: string; initial: VendorInstallment[]; suggestedTotal: number
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [rows, setRows] = useState<VendorInstallment[]>(initial.length > 0 ? initial : [
    { seq: 1, label_ar: 'الدفعة الأولى (المقدمة)', amount_sar: 0, paid_at: null },
  ])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedTick, setSavedTick] = useState(0)

  function updateRow(i: number, patch: Partial<VendorInstallment>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function addRow() {
    const nextSeq = rows.length > 0 ? Math.max(...rows.map((r) => r.seq)) + 1 : 1
    setRows((prev) => [...prev, { seq: nextSeq, label_ar: '', amount_sar: 0, paid_at: null }])
  }
  function deleteRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i))
  }
  async function onSave() {
    setErr(null); setBusy(true)
    const res = await updateVendorContractSchedule({ contract_id: contractId, schedule: rows })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    setSavedTick((n) => n + 1)
    startTransition(() => router.refresh())
    setTimeout(() => setSavedTick(0), 2500)
  }
  async function togglePaid(seq: number, currentPaidAt: string | null | undefined) {
    setErr(null); setBusy(true)
    const res = await markInstallmentPaid({
      contract_id: contractId,
      seq,
      paid_at: currentPaidAt ? null : new Date().toISOString().slice(0, 10),
    })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    startTransition(() => router.refresh())
  }

  const total = rows.reduce((n, r) => n + Number(r.amount_sar || 0), 0)
  const balanced = suggestedTotal === 0 || Math.abs(total - suggestedTotal) < 0.5

  const inp = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500'
  const num = inp + ' text-center font-mono'

  return (
    <div className="rounded-lg bg-white border border-slate-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-bold text-slate-900">جدول دفعات المقاول</h4>
        <span className={`text-[11px] font-mono ${balanced ? 'text-slate-500' : 'text-amber-700 font-bold'}`}>
          الإجمالي: {fmtSar(total)}
          {suggestedTotal > 0 && ` / ${fmtSar(suggestedTotal)}`}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-right">
              <th className="px-2 py-1.5 text-xs font-bold text-slate-600 w-12">#</th>
              <th className="px-2 py-1.5 text-xs font-bold text-slate-600">الدفعة</th>
              <th className="px-2 py-1.5 text-xs font-bold text-slate-600 w-40">المبلغ</th>
              <th className="px-2 py-1.5 text-xs font-bold text-slate-600 w-32">الحالة</th>
              <th className="px-2 py-1.5 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5">
                  <input className={num} type="number" value={r.seq} onChange={(e) => updateRow(i, { seq: Number(e.target.value) })} disabled={busy} min={1} />
                </td>
                <td className="px-2 py-1.5">
                  <input className={inp} value={r.label_ar} onChange={(e) => updateRow(i, { label_ar: e.target.value })} disabled={busy} maxLength={80} />
                </td>
                <td className="px-2 py-1.5">
                  <input className={num} type="number" step={0.01} value={r.amount_sar} onChange={(e) => updateRow(i, { amount_sar: Number(e.target.value) })} disabled={busy} min={0} />
                </td>
                <td className="px-2 py-1.5">
                  <button type="button" onClick={() => togglePaid(r.seq, r.paid_at)} disabled={busy}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold ring-1 ring-inset ${r.paid_at ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
                    {r.paid_at ? <><Check className="w-3 h-3" /> مُسدَّدة {r.paid_at}</> : 'قيد الانتظار'}
                  </button>
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button type="button" onClick={() => deleteRow(i)} disabled={busy} title="حذف"
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md text-red-600 hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {err && (<div role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 font-semibold">{err}</div>)}
      <div className="flex items-center gap-2 pt-2">
        <button type="button" onClick={onSave} disabled={busy}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-teal-600 text-white text-xs font-bold hover:bg-teal-700 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          حفظ الجدول
        </button>
        <button type="button" onClick={addRow} disabled={busy}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" /> إضافة دفعة
        </button>
        {savedTick > 0 && <span className="text-[11px] text-emerald-700 font-semibold">تم الحفظ ✓</span>}
      </div>
    </div>
  )
}

/* ─────────────────────────────  Receipts  ───────────────────────────── */

function ReceiptsTable({
  vendorId, contracts, receipts, disbursementTypes,
}: {
  vendorId: string; contracts: ContractLite[]; receipts: ReceiptLite[]
  disbursementTypes: DisbursementTypeOption[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Add-row form state.
  const [contractId, setContractId] = useState<string>(contracts[0]?.id ?? '')
  const [installSeq, setInstallSeq] = useState<string>('')
  const [receiptNo, setReceiptNo]   = useState('')
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount]         = useState('')
  const [vat, setVat]               = useState('')
  const [description, setDescription] = useState('')
  const [dsbTypeCode, setDsbTypeCode] = useState<string>('')

  function resetForm() {
    setContractId(contracts[0]?.id ?? '')
    setInstallSeq('')
    setReceiptNo(''); setReceiptDate(new Date().toISOString().slice(0, 10))
    setAmount(''); setVat(''); setDescription('')
    setDsbTypeCode('')
    setErr(null)
  }

  async function onAdd() {
    setErr(null)
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt < 0) { setErr('مبلغ غير صالح.'); return }
    setBusy(true)
    const res = await createVendorReceipt({
      vendor_id: vendorId,
      contract_id: contractId || null,
      installment_seq: installSeq ? Number(installSeq) : null,
      receipt_number: receiptNo.trim() || null,
      receipt_date: receiptDate || null,
      amount_before_tax_sar: amt,
      vat_sar: vat ? Number(vat) : 0,
      description: description.trim() || null,
      disbursement_type_code: dsbTypeCode || null,
    })
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    resetForm(); setAdding(false)
    startTransition(() => router.refresh())
  }
  async function onDelete(id: string) {
    if (!confirm('حذف الفاتورة؟')) return
    setBusy(true)
    const res = await deleteVendorReceipt({ id })
    setBusy(false)
    if (!res.ok) { alert(res.error); return }
    startTransition(() => router.refresh())
  }
  async function onCreateCase(id: string) {
    setBusy(true)
    const res = await createCaseFromReceipt({ receipt_id: id })
    setBusy(false)
    if (!res.ok) { alert(res.error); return }
    startTransition(() => router.refresh())
  }

  const inp = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500'

  return (
    <div className="rounded-lg bg-white border border-slate-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-bold text-slate-900">الفواتير</h4>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-teal-600 text-white text-[11px] font-bold hover:bg-teal-700">
            <Plus className="w-3 h-3" /> إضافة فاتورة
          </button>
        )}
      </div>

      {adding && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 p-3 rounded-md bg-slate-50 border border-slate-200">
          {contracts.length > 1 && (
            <div className="col-span-2">
              <label className="text-[10px] font-bold text-slate-600 mb-0.5 block">العقد</label>
              <select className={inp} value={contractId} onChange={(e) => setContractId(e.target.value)} disabled={busy}>
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>{c.contract_number ?? 'عقد بدون رقم'}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="text-[10px] font-bold text-slate-600 mb-0.5 block">رقم الدفعة (من الجدول)</label>
            <input className={inp} type="number" value={installSeq} onChange={(e) => setInstallSeq(e.target.value)} disabled={busy} min={1} placeholder="1، 2، …" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-600 mb-0.5 block">رقم الفاتورة</label>
            <input className={inp} value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} disabled={busy} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-600 mb-0.5 block">تاريخ الفاتورة</label>
            <input className={inp} type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} disabled={busy} dir="ltr" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-600 mb-0.5 block">المبلغ قبل الضريبة</label>
            <input className={inp} type="number" step={0.01} min={0} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-600 mb-0.5 block">الضريبة</label>
            <input className={inp} type="number" step={0.01} min={0} value={vat} onChange={(e) => setVat(e.target.value)} disabled={busy} />
          </div>
          <div className="col-span-2">
            <label className="text-[10px] font-bold text-slate-600 mb-0.5 block">نوع الصرف</label>
            <select className={inp} value={dsbTypeCode} onChange={(e) => setDsbTypeCode(e.target.value)} disabled={busy}>
              <option value="">— اختر —</option>
              {disbursementTypes.map((t) => (
                <option key={t.code} value={t.code}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2 md:col-span-4">
            <label className="text-[10px] font-bold text-slate-600 mb-0.5 block">البيان</label>
            <input className={inp} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
          </div>
          {err && (<div role="alert" className="col-span-full rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 font-semibold">{err}</div>)}
          <div className="col-span-full flex items-center gap-2">
            <button type="button" onClick={onAdd} disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-teal-600 text-white text-xs font-bold hover:bg-teal-700 disabled:opacity-50">
              {busy && <Loader2 className="w-3 h-3 animate-spin" />} حفظ الفاتورة
            </button>
            <button type="button" onClick={() => { resetForm(); setAdding(false) }} disabled={busy}
              className="inline-flex items-center px-3 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              إلغاء
            </button>
          </div>
        </div>
      )}

      {receipts.length === 0 ? (
        <div className="text-center text-xs text-slate-400 italic py-6">لم تُسجَّل أي فواتير بعد.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-right">
                <th className="px-2 py-1.5 text-xs font-bold text-slate-600">رقم الفاتورة</th>
                <th className="px-2 py-1.5 text-xs font-bold text-slate-600">التاريخ</th>
                <th className="px-2 py-1.5 text-xs font-bold text-slate-600">دفعة</th>
                <th className="px-2 py-1.5 text-xs font-bold text-slate-600">الإجمالي</th>
                <th className="px-2 py-1.5 text-xs font-bold text-slate-600">الحالة</th>
                <th className="px-2 py-1.5 text-xs font-bold text-slate-600">سند الصرف</th>
                <th className="px-2 py-1.5 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {receipts.map((r) => (
                <tr key={r.id} className={editingId === r.id ? 'bg-teal-50/40' : ''}>
                  {editingId === r.id ? (
                    <ReceiptEditRow
                      r={r}
                      disbursementTypes={disbursementTypes}
                      onClose={() => setEditingId(null)}
                      onSaved={() => { setEditingId(null); startTransition(() => router.refresh()) }}
                    />
                  ) : (
                    <>
                      <td className="px-2 py-1.5 font-mono text-xs">{r.receipt_number ?? '—'}</td>
                      <td className="px-2 py-1.5 text-xs text-slate-500">{r.receipt_date ?? '—'}</td>
                      <td className="px-2 py-1.5 text-xs">{r.installment_seq ?? '—'}</td>
                      <td className="px-2 py-1.5 text-xs font-mono">{fmtSar(r.total_amount_sar)}</td>
                      <td className="px-2 py-1.5">
                        <StatusPill s={r.status} />
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        {r.case_id ? (
                          <Link href={`/app/disbursements/${r.case_id}`} className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-900 hover:underline">
                            <ExternalLink className="w-3 h-3" /> عرض
                          </Link>
                        ) : (
                          <button type="button" onClick={() => onCreateCase(r.id)} disabled={busy}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200 hover:bg-teal-100 text-[11px] font-semibold disabled:opacity-50">
                            <FileText className="w-3 h-3" /> إنشاء سند
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <div className="inline-flex items-center gap-0.5">
                          <button type="button" onClick={() => setEditingId(r.id)} title="تعديل"
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-600 hover:bg-slate-100">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => onDelete(r.id)} title="حذف" disabled={busy}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-red-600 hover:bg-red-50 disabled:opacity-40">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatusPill({ s }: { s: ReceiptLite['status'] }) {
  const map = {
    pending:  { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: 'قيد الانتظار' },
    invoiced: { cls: 'bg-amber-50 text-amber-800 ring-amber-200',   label: 'بانتظار السداد' },
    paid:     { cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200', label: 'مُسدَّدة' },
  } as const
  const p = map[s]
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ring-1 ring-inset ${p.cls}`}>{p.label}</span>
}

function ReceiptEditRow({
  r, onClose, onSaved, disbursementTypes,
}: {
  r: ReceiptLite; onClose: () => void; onSaved: () => void
  disbursementTypes: DisbursementTypeOption[]
}) {
  const [num, setNum] = useState(r.receipt_number ?? '')
  const [date, setDate] = useState(r.receipt_date ?? '')
  const [seq, setSeq] = useState<string>(r.installment_seq != null ? String(r.installment_seq) : '')
  const [amt, setAmt] = useState(String(r.amount_before_tax_sar))
  const [vat, setVat] = useState(String(r.vat_sar))
  const [desc, setDesc] = useState(r.description ?? '')
  const [dsbTypeCode, setDsbTypeCode] = useState<string>(r.disbursement_type_code ?? '')
  const [busy, setBusy] = useState(false)

  async function onSave() {
    setBusy(true)
    const res = await updateVendorReceipt({
      id: r.id,
      patch: {
        receipt_number: num,
        receipt_date: date || null,
        installment_seq: seq ? Number(seq) : null,
        amount_before_tax_sar: Number(amt || 0),
        vat_sar: Number(vat || 0),
        description: desc,
        disbursement_type_code: dsbTypeCode || null,
      },
    })
    setBusy(false)
    if (!res.ok) { alert(res.error); return }
    onSaved()
  }
  const inp = 'w-full rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500'
  return (
    <>
      <td className="px-2 py-1"><input className={inp} value={num} onChange={(e) => setNum(e.target.value)} disabled={busy} /></td>
      <td className="px-2 py-1"><input className={inp} type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} dir="ltr" /></td>
      <td className="px-2 py-1"><input className={inp} type="number" min={1} value={seq} onChange={(e) => setSeq(e.target.value)} disabled={busy} /></td>
      <td className="px-2 py-1"><input className={inp + ' font-mono text-left'} type="number" step={0.01} value={amt} onChange={(e) => setAmt(e.target.value)} disabled={busy} /></td>
      <td className="px-2 py-1">
        <select className={inp} value={dsbTypeCode} onChange={(e) => setDsbTypeCode(e.target.value)} disabled={busy}>
          <option value="">نوع الصرف —</option>
          {disbursementTypes.map((t) => (
            <option key={t.code} value={t.code}>{t.label}</option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1">
        <input className={inp} value={desc} onChange={(e) => setDesc(e.target.value)} disabled={busy} placeholder="البيان" />
      </td>
      <td className="px-2 py-1 text-center">
        <div className="inline-flex items-center gap-0.5">
          <button type="button" onClick={onSave} disabled={busy} title="حفظ"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-emerald-700 hover:bg-emerald-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
          <button type="button" onClick={onClose} disabled={busy} title="إلغاء"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-500 hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      </td>
    </>
  )
}
