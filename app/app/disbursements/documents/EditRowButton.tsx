'use client'

/**
 * EditRowButton — comprehensive inline edit modal on the وثائق التسليم
 * register. Covers every editable case field, calling the specialized
 * server actions in [caseId]/actions.ts.
 */
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, X, Save, Loader2, ExternalLink, Wallet } from 'lucide-react'
import Link from 'next/link'
import { updateCaseFields, updateExtractedFields, updatePaidFromAccount } from '../[caseId]/actions'
import { updateCaseVendor, updateCaseIsDownpayment } from '../[caseId]/actions-vendor'
import { BeneficiaryCapacityPicker } from '@/components/BeneficiaryCapacityPicker'

export type EditableCase = {
  id: string
  case_number: string
  voucher_number_text: string | null
  voucher_date: string | null
  amount_sar: number | null
  delivery_date: string | null
  notes: string | null
  developer_id: string | null
  project_id: string | null
  vendor_id: string | null
  is_downpayment: boolean | null
  paid_from_account_id: string | null
  extracted_fields: Record<string, unknown> | null
}

export type DeveloperOpt = { id: string; label: string }
export type ProjectOpt = { id: string; label: string; developer_id: string | null }
export type VendorOpt = { id: string; label: string; project_id: string }
export type AccountOpt = { id: string; label: string; project_id: string }
export type DsbTypeOpt = { code: string; label: string }

export function EditRowButton({
  kase,
  developers,
  projects,
  vendors,
  accounts,
  disbursementTypes,
}: {
  kase: EditableCase
  developers: DeveloperOpt[]
  projects: ProjectOpt[]
  vendors: VendorOpt[]
  accounts: AccountOpt[]
  disbursementTypes: DsbTypeOpt[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // ─── Relationships ───────────────────────────────────────────
  const [developerId, setDeveloperId] = useState<string>(kase.developer_id ?? '')
  const [projectId,   setProjectId]   = useState<string>(kase.project_id ?? '')
  const [vendorId,    setVendorId]    = useState<string>(kase.vendor_id ?? '')
  const [isDownpayment, setIsDownpayment] = useState<boolean>(!!kase.is_downpayment)
  const [paidFromId,  setPaidFromId]  = useState<string>(kase.paid_from_account_id ?? '')

  // ─── Top-level fields ────────────────────────────────────────
  const [voucherNo,   setVoucherNo]   = useState(kase.voucher_number_text ?? '')
  const [voucherDate, setVoucherDate] = useState(kase.voucher_date ?? '')
  const [amount,      setAmount]      = useState(kase.amount_sar != null ? String(kase.amount_sar) : '')
  const [deliveryDate, setDeliveryDate] = useState(kase.delivery_date ?? '')
  const [notes,       setNotes]       = useState(kase.notes ?? '')

  // ─── Extracted fields ────────────────────────────────────────
  const ef = (kase.extracted_fields ?? {}) as Record<string, unknown>
  const s = (k: string) => (ef[k] == null ? '' : String(ef[k]))
  const [benName,        setBenName]        = useState(s('beneficiary_name_ar'))
  const [benCap,         setBenCap]         = useState(s('beneficiary_capacity_ar'))
  const [dsbType,        setDsbType]        = useState(s('disbursement_type_code'))
  const [invoiceNumber,  setInvoiceNumber]  = useState(s('invoice_number'))
  const [invAmount,      setInvAmount]      = useState(s('invoice_amount_sar'))
  const [vatAmount,      setVatAmount]      = useState(s('vat_amount_sar'))
  const [benBank,        setBenBank]        = useState(s('beneficiary_bank_name'))
  const [benAccount,     setBenAccount]     = useState(s('beneficiary_account_number'))
  const [benIban,        setBenIban]        = useState(s('beneficiary_iban'))
  const [contractNumber, setContractNumber] = useState(s('contract_number'))
  const [unitNumber,     setUnitNumber]     = useState(s('unit_number'))
  const [buyerName,      setBuyerName]      = useState(s('buyer_name_ar'))
  const [buyerId,        setBuyerId]        = useState(s('buyer_id_number'))
  const [buyerPhone,     setBuyerPhone]     = useState(s('buyer_phone'))

  // ─── Filtered lists (react to selections) ────────────────────
  const filteredProjects = useMemo(() =>
    projects.filter((p) => !developerId || p.developer_id === developerId || p.developer_id === null),
    [projects, developerId],
  )
  const filteredVendors = useMemo(() =>
    vendors.filter((v) => v.project_id === projectId),
    [vendors, projectId],
  )
  const filteredAccounts = useMemo(() =>
    accounts.filter((a) => a.project_id === projectId),
    [accounts, projectId],
  )

  function onDeveloperChange(next: string) {
    setDeveloperId(next)
    // If current project doesn't belong to the new developer, clear it.
    const stillOk = !next || projects.some((p) => p.id === projectId && (p.developer_id === next || p.developer_id === null))
    if (!stillOk) {
      setProjectId('')
      setVendorId('')
      setPaidFromId('')
    }
  }
  function onProjectChange(next: string) {
    setProjectId(next)
    // Vendor + account are project-scoped
    if (!vendors.some((v) => v.id === vendorId && v.project_id === next)) setVendorId('')
    if (!accounts.some((a) => a.id === paidFromId && a.project_id === next)) setPaidFromId('')
  }

  async function onSave() {
    setErr(null); setBusy(true)
    try {
      // 1) Top-level (voucher / dates / amount / notes / developer / project)
      const topRes = await updateCaseFields({
        case_id: kase.id,
        voucher_number_text: voucherNo.trim() || null,
        voucher_date: voucherDate || null,
        amount_sar: amount.trim() ? Number(amount) : null,
        delivery_date: deliveryDate || null,
        notes: notes.trim() || null,
        developer_id: developerId || null,
        project_id:   projectId   || null,
      })
      if (!topRes.ok) { setErr(topRes.error); setBusy(false); return }

      // 2) Extracted fields (merged into JSONB)
      const fields: Record<string, unknown> = {
        beneficiary_name_ar:        benName.trim() || null,
        beneficiary_capacity_ar:    benCap.trim() || null,
        disbursement_type_code:     dsbType || null,
        invoice_number:             invoiceNumber.trim() || null,
        invoice_amount_sar:         invAmount.trim() ? Number(invAmount) : null,
        vat_amount_sar:             vatAmount.trim() ? Number(vatAmount) : null,
        beneficiary_bank_name:      benBank.trim() || null,
        beneficiary_account_number: benAccount.trim() || null,
        beneficiary_iban:           benIban.trim() || null,
        contract_number:            contractNumber.trim() || null,
        unit_number:                unitNumber.trim() || null,
        buyer_name_ar:              buyerName.trim() || null,
        buyer_id_number:            buyerId.trim() || null,
        buyer_phone:                buyerPhone.trim() || null,
      }
      const efRes = await updateExtractedFields({ case_id: kase.id, fields })
      if (!efRes.ok) { setErr(efRes.error); setBusy(false); return }

      // 3) Vendor link (mig 084)
      if ((vendorId || '') !== (kase.vendor_id ?? '')) {
        const vRes = await updateCaseVendor({ case_id: kase.id, vendor_id: vendorId || null })
        if (!vRes.ok) { setErr(vRes.error); setBusy(false); return }
      }

      // 4) Downpayment flag (mig 085)
      if (isDownpayment !== !!kase.is_downpayment) {
        const dRes = await updateCaseIsDownpayment({ case_id: kase.id, is_downpayment: isDownpayment })
        if (!dRes.ok) { setErr(dRes.error); setBusy(false); return }
      }

      // 5) Paid-from account
      if ((paidFromId || '') !== (kase.paid_from_account_id ?? '')) {
        const aRes = await updatePaidFromAccount({ case_id: kase.id, account_id: paidFromId || null })
        if (!aRes.ok) { setErr(aRes.error); setBusy(false); return }
      }

      setBusy(false)
      setOpen(false)
      startTransition(() => router.refresh())
    } catch (e) {
      setBusy(false)
      setErr(e instanceof Error ? e.message : 'حدث خطأ.')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-xs font-semibold hover:bg-slate-50"
        title="تعديل"
      >
        <Pencil className="w-3.5 h-3.5" />
        تعديل
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={() => !busy && setOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full my-6" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 sticky top-0 bg-white rounded-t-xl">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-teal-700" />
                <h3 className="serif font-bold text-slate-900">
                  تعديل الطلب <span className="font-mono text-sm text-slate-500">{kase.case_number}</span>
                </h3>
              </div>
              <button type="button" onClick={() => !busy && setOpen(false)} disabled={busy} className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-5">
              {/* Relationships */}
              <Section title="التصنيف والربط">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="المطور / العميل">
                    <select className={inp} value={developerId} onChange={(e) => onDeveloperChange(e.target.value)} disabled={busy}>
                      <option value="">—</option>
                      {developers.map((d) => (<option key={d.id} value={d.id}>{d.label}</option>))}
                    </select>
                  </Field>
                  <Field label="المشروع">
                    <select className={inp} value={projectId} onChange={(e) => onProjectChange(e.target.value)} disabled={busy}>
                      <option value="">—</option>
                      {filteredProjects.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
                    </select>
                  </Field>
                  <Field label="المورد / المقاول">
                    <select className={inp} value={vendorId} onChange={(e) => setVendorId(e.target.value)} disabled={busy || !projectId}>
                      <option value="">— بدون —</option>
                      {filteredVendors.map((v) => (<option key={v.id} value={v.id}>{v.label}</option>))}
                    </select>
                  </Field>
                  <Field label="حساب الدفع">
                    <select className={inp} value={paidFromId} onChange={(e) => setPaidFromId(e.target.value)} disabled={busy || !projectId}>
                      <option value="">— بدون —</option>
                      {filteredAccounts.map((a) => (<option key={a.id} value={a.id}>{a.label}</option>))}
                    </select>
                  </Field>
                </div>
                <label className={`mt-3 flex items-start gap-2 px-3 py-2 rounded-lg border cursor-pointer transition ${isDownpayment ? 'bg-indigo-50 border-indigo-300' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" checked={isDownpayment} disabled={busy} onChange={(e) => setIsDownpayment(e.target.checked)} />
                  <div>
                    <div className="text-xs font-bold text-slate-800 inline-flex items-center gap-1">
                      <Wallet className="w-3.5 h-3.5 text-indigo-600" /> هذا سند دفعة مقدّمة
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">يُضاف إلى رصيد المورد بدل الخصم منه.</div>
                  </div>
                </label>
              </Section>

              {/* Voucher fields */}
              <Section title="بيانات السند">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="رقم السند"><input type="text" className={inp} value={voucherNo} onChange={(e) => setVoucherNo(e.target.value)} disabled={busy} /></Field>
                  <Field label="تاريخ السند"><input type="date" className={inp} value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} disabled={busy} dir="ltr" /></Field>
                  <Field label="المبلغ (ر.س)"><input type="number" step="0.01" min={0} className={inp} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} /></Field>
                  <Field label="تاريخ التسليم"><input type="date" className={inp} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} disabled={busy} dir="ltr" /></Field>
                </div>
                <Field label="ملاحظات"><textarea rows={2} className={inp + ' min-h-[60px]'} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} /></Field>
              </Section>

              {/* Beneficiary */}
              <Section title="بيانات المستفيد">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="اسم المستفيد"><input type="text" className={inp} value={benName} onChange={(e) => setBenName(e.target.value)} disabled={busy} /></Field>
                  <Field label="صفة المستفيد">
                    <BeneficiaryCapacityPicker value={benCap} onChange={setBenCap} disabled={busy} />
                  </Field>
                  <Field label="نوع الصرف">
                    <select className={inp} value={dsbType} onChange={(e) => setDsbType(e.target.value)} disabled={busy}>
                      <option value="">—</option>
                      {disbursementTypes.map((t) => (<option key={t.code} value={t.code}>{t.label}</option>))}
                    </select>
                  </Field>
                  <Field label="رقم الفاتورة"><input type="text" className={inp} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} disabled={busy} /></Field>
                  <Field label="قيمة الفاتورة قبل الضريبة"><input type="number" step="0.01" min={0} className={inp} value={invAmount} onChange={(e) => setInvAmount(e.target.value)} disabled={busy} /></Field>
                  <Field label="الضريبة"><input type="number" step="0.01" min={0} className={inp} value={vatAmount} onChange={(e) => setVatAmount(e.target.value)} disabled={busy} /></Field>
                  <Field label="بنك المستفيد"><input type="text" className={inp} value={benBank} onChange={(e) => setBenBank(e.target.value)} disabled={busy} /></Field>
                  <Field label="رقم حساب المستفيد"><input type="text" className={inp} value={benAccount} onChange={(e) => setBenAccount(e.target.value)} disabled={busy} dir="ltr" /></Field>
                  <Field label="IBAN المستفيد"><input type="text" className={inp} value={benIban} onChange={(e) => setBenIban(e.target.value)} disabled={busy} dir="ltr" /></Field>
                  <Field label="رقم العقد"><input type="text" className={inp} value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} disabled={busy} /></Field>
                  <Field label="رقم الوحدة"><input type="text" className={inp} value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} disabled={busy} /></Field>
                </div>
              </Section>

              {/* Buyer (only relevant for buyer-collection cases) */}
              <Section title="بيانات المشتري (اختياري)">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="اسم المشتري"><input type="text" className={inp} value={buyerName} onChange={(e) => setBuyerName(e.target.value)} disabled={busy} /></Field>
                  <Field label="رقم هوية المشتري"><input type="text" className={inp} value={buyerId} onChange={(e) => setBuyerId(e.target.value)} disabled={busy} dir="ltr" /></Field>
                  <Field label="رقم جوال المشتري"><input type="text" className={inp} value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} disabled={busy} dir="ltr" /></Field>
                </div>
              </Section>

              {err && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{err}</div>
              )}

              <div className="flex items-center gap-2 flex-wrap justify-between pt-2 border-t border-slate-100 sticky bottom-0 bg-white pb-1 -mb-4">
                <Link href={`/app/disbursements/${kase.id}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-slate-500 hover:text-teal-700 inline-flex items-center gap-1">
                  فتح صفحة الطلب <ExternalLink className="w-3 h-3" />
                </Link>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setOpen(false)} disabled={busy} className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
                    إلغاء
                  </button>
                  <button type="button" onClick={onSave} disabled={busy} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:opacity-50">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    حفظ الكل
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const inp =
  'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-bold text-slate-700 border-b border-slate-100 pb-1">{title}</h4>
      {children}
    </section>
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
