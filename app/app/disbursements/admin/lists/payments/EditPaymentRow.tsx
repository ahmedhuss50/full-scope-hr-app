'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { updatePayment } from './actions'

// ---------------------------------------------------------------------------
// EditPaymentRow
// ---------------------------------------------------------------------------
// Wraps a single <tr> in the payments list so an owner can inline-edit any
// payment field. Click the pencil in the last cell → the row expands with
// a second <tr> (colspan) that hosts the edit form. Save calls the
// updatePayment server action; the server resolves contract_number → sale_id
// (migration 064) and case_number → case_id.
//
// Split children (rows with split_source_payment_id) are read-only — they're
// regenerated from the parent by distributeBuyerDeposit, so editing them
// directly would be lost on the next distribution pass. Pencil is disabled
// with an explanatory tooltip.
// ---------------------------------------------------------------------------

export type ProjectOption = { id: string; label: string }
export type AccountOption = { id: string; project_id: string; label: string }

export interface PaymentEditable {
  id: string
  payment_date: string
  amount_sar: number
  vat_sar: number | null
  beneficiary_name: string | null
  description: string | null
  reference_number: string | null
  payment_method: string | null
  project_id: string | null
  account_id: string | null
  // Denormalized display values — server resolves them back to sale_id /
  // case_id on save. Keeps the edit UI simple (no free-text vs id juggling).
  contract_number: string | null
  case_number: string | null
  // Buyer identity — read-only display only, sourced from the linked sale.
  buyer_id_number: string | null
  buyer_phone: string | null
  // Unit number — read-only, sourced from the linked sale's unit (or the
  // payment's own unit_id for older rows).
  unit_number: string | null
  is_split_child: boolean
}

export function EditPaymentRow({
  payment,
  projects,
  accounts,
  rowClassName,
  totalCols,
  children,
}: {
  payment: PaymentEditable
  projects: ProjectOption[]
  accounts: AccountOption[]
  rowClassName: string
  totalCols: number
  // The 12 display cells for the primary row are passed as children so the
  // page keeps ownership of formatting/tone.
  children: React.ReactNode
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [paymentDate, setPaymentDate] = useState(payment.payment_date ?? '')
  const [amount, setAmount] = useState<string>(String(payment.amount_sar))
  const [vat, setVat] = useState<string>(payment.vat_sar != null ? String(payment.vat_sar) : '')
  const [beneficiary, setBeneficiary] = useState(payment.beneficiary_name ?? '')
  const [description, setDescription] = useState(payment.description ?? '')
  const [reference, setReference] = useState(payment.reference_number ?? '')
  const [method, setMethod] = useState(payment.payment_method ?? '')
  const [projectId, setProjectId] = useState<string>(payment.project_id ?? '')
  const [accountId, setAccountId] = useState<string>(payment.account_id ?? '')
  const [contractNumber, setContractNumber] = useState(payment.contract_number ?? '')
  const [caseNumber, setCaseNumber] = useState(payment.case_number ?? '')

  const accountOptions = projectId
    ? accounts.filter((a) => a.project_id === projectId)
    : []

  function onProjectChange(next: string) {
    setProjectId(next)
    // If the currently-selected account doesn't belong to the new project,
    // clear it so the operator has to re-pick. Mirrors EditCaseInfo's
    // developer→project cascade.
    if (accountId) {
      const stillValid = accounts.some(
        (a) => a.id === accountId && a.project_id === next,
      )
      if (!stillValid) setAccountId('')
    }
  }

  function reset() {
    setPaymentDate(payment.payment_date ?? '')
    setAmount(String(payment.amount_sar))
    setVat(payment.vat_sar != null ? String(payment.vat_sar) : '')
    setBeneficiary(payment.beneficiary_name ?? '')
    setDescription(payment.description ?? '')
    setReference(payment.reference_number ?? '')
    setMethod(payment.payment_method ?? '')
    setProjectId(payment.project_id ?? '')
    setAccountId(payment.account_id ?? '')
    setContractNumber(payment.contract_number ?? '')
    setCaseNumber(payment.case_number ?? '')
    setError(null)
  }

  async function onSave() {
    setError(null)
    if (!paymentDate || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      setError('تاريخ الدفع مطلوب.')
      return
    }
    const amountNum = amount.trim() === '' ? NaN : Number(amount)
    if (!Number.isFinite(amountNum)) {
      setError('المبلغ غير صالح.')
      return
    }
    const vatNum = vat.trim() === '' ? null : Number(vat)
    if (vatNum !== null && !Number.isFinite(vatNum)) {
      setError('قيمة الضريبة غير صالحة.')
      return
    }
    setSaving(true)
    const res = await updatePayment({
      payment_id: payment.id,
      payment_date: paymentDate,
      amount_sar: amountNum,
      vat_sar: vatNum,
      beneficiary_name: beneficiary.trim() || null,
      description: description.trim() || null,
      reference_number: reference.trim() || null,
      payment_method: method.trim() || null,
      project_id: projectId || null,
      account_id: accountId || null,
      contract_number: contractNumber.trim() || null,
      case_number: caseNumber.trim() || null,
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    startTransition(() => router.refresh())
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

  return (
    <>
      <tr className={rowClassName}>
        {children}
        <td className="px-3 py-2 align-top">
          {payment.is_split_child ? (
            <button
              type="button"
              disabled
              title="صف توزيع تلقائي — يُعدَّل بتعديل الأصل"
              className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed"
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              title="تعديل الدفعة"
              aria-expanded={open}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-teal-50 hover:text-teal-700 hover:border-teal-200 transition"
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </td>
      </tr>
      {open && !payment.is_split_child && (
        <tr>
          <td colSpan={totalCols} className="p-0 bg-teal-50/20">
            <div className="p-4 border-t border-b border-teal-200">
              <h3 className="serif font-bold text-sm text-slate-900 mb-3">
                تعديل بيانات الدفعة
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">تاريخ الدفع</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    disabled={saving}
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">المبلغ (ر.س)</label>
                  <input
                    type="number"
                    step="0.01"
                    className={inputCls}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={saving}
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">الضريبة (ر.س)</label>
                  <input
                    type="number"
                    step="0.01"
                    className={inputCls}
                    value={vat}
                    onChange={(e) => setVat(e.target.value)}
                    disabled={saving}
                    dir="ltr"
                    placeholder="—"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">اسم المشتري</label>
                  <input
                    type="text"
                    className={inputCls}
                    value={beneficiary}
                    onChange={(e) => setBeneficiary(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">المرجع</label>
                  <input
                    type="text"
                    className={inputCls}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    disabled={saving}
                  />
                </div>
                {/* رقم الهوية — read-only, sourced from the linked sale.
                    Edited on the عقود المشترين page, not here. */}
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">رقم الهوية</label>
                  <input
                    type="text"
                    className={`${inputCls} bg-slate-50 text-slate-600`}
                    value={payment.buyer_id_number ?? ''}
                    readOnly
                    dir="ltr"
                    placeholder="—"
                    title="مصدره من عقد المشتري المرتبط — يُعدَّل من صفحة عقود المشترين"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">رقم الجوال</label>
                  <input
                    type="text"
                    className={`${inputCls} bg-slate-50 text-slate-600`}
                    value={payment.buyer_phone ?? ''}
                    readOnly
                    dir="ltr"
                    placeholder="—"
                    title="مصدره من عقد المشتري المرتبط — يُعدَّل من صفحة عقود المشترين"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">البيان</label>
                  <textarea
                    rows={2}
                    className={inputCls}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">المشروع</label>
                  <select
                    className={inputCls}
                    value={projectId}
                    onChange={(e) => onProjectChange(e.target.value)}
                    disabled={saving}
                  >
                    <option value="">— بدون —</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">الحساب</label>
                  <select
                    className={inputCls}
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    disabled={saving || !projectId}
                  >
                    <option value="">
                      {projectId ? '— بدون —' : '— اختر المشروع أولاً —'}
                    </option>
                    {accountOptions.map((a) => (
                      <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">رقم العقد</label>
                  <input
                    type="text"
                    className={inputCls}
                    value={contractNumber}
                    onChange={(e) => setContractNumber(e.target.value)}
                    disabled={saving}
                    dir="ltr"
                    placeholder="—"
                  />
                </div>
                {/* رقم الوحدة — read-only, resolved via the linked sale's unit.
                    Changing the contract number cascades to a different unit. */}
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">رقم الوحدة</label>
                  <input
                    type="text"
                    className={`${inputCls} bg-slate-50 text-slate-600`}
                    value={payment.unit_number ?? ''}
                    readOnly
                    dir="ltr"
                    placeholder="—"
                    title="مصدره من العقد المرتبط — يتغيّر بتغيير رقم العقد"
                  />
                </div>
              </div>
              {error && (
                <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  className="inline-flex items-center px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
                >
                  {saving ? 'جارٍ الحفظ…' : 'حفظ'}
                </button>
                <button
                  type="button"
                  onClick={() => { reset(); setOpen(false) }}
                  disabled={saving}
                  className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
