'use client'

/**
 * EditRowButton — inline edit button on the وثائق التسليم register.
 * Opens a modal with every editable case field (top-level + extracted)
 * and saves via the existing server actions.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, X, Save, Loader2, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { updateCaseFields } from '../[caseId]/actions'
import { updateExtractedFields } from '../[caseId]/actions'

export type EditableCase = {
  id: string
  case_number: string
  voucher_number_text: string | null
  voucher_date: string | null
  amount_sar: number | null
  delivery_date: string | null
  notes: string | null
  extracted_fields: {
    beneficiary_name_ar?: string | null
    beneficiary_capacity_ar?: string | null
    disbursement_type_code?: string | null
    invoice_amount_sar?: number | null
    vat_amount_sar?: number | null
    invoice_number?: string | null
  } | null
}

export function EditRowButton({
  kase,
  disbursementTypes,
}: {
  kase: EditableCase
  disbursementTypes: Array<{ code: string; label: string }>
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Top-level fields
  const [voucherNo, setVoucherNo] = useState(kase.voucher_number_text ?? '')
  const [voucherDate, setVoucherDate] = useState(kase.voucher_date ?? '')
  const [amount, setAmount] = useState(kase.amount_sar != null ? String(kase.amount_sar) : '')
  const [deliveryDate, setDeliveryDate] = useState(kase.delivery_date ?? '')
  const [notes, setNotes] = useState(kase.notes ?? '')
  // Extracted fields
  const ef = kase.extracted_fields ?? {}
  const [benName, setBenName]           = useState(ef.beneficiary_name_ar ?? '')
  const [benCap, setBenCap]             = useState(ef.beneficiary_capacity_ar ?? '')
  const [dsbType, setDsbType]           = useState(ef.disbursement_type_code ?? '')
  const [invAmount, setInvAmount]       = useState(ef.invoice_amount_sar != null ? String(ef.invoice_amount_sar) : '')
  const [vatAmount, setVatAmount]       = useState(ef.vat_amount_sar != null ? String(ef.vat_amount_sar) : '')
  const [invoiceNumber, setInvoiceNumber] = useState(ef.invoice_number ?? '')

  async function onSave() {
    setErr(null); setBusy(true)
    // 1) Top-level case fields
    const topRes = await updateCaseFields({
      case_id: kase.id,
      voucher_number_text: voucherNo.trim() || null,
      voucher_date: voucherDate || null,
      amount_sar: amount.trim() ? Number(amount) : null,
      delivery_date: deliveryDate || null,
      notes: notes.trim() || null,
    })
    if (!topRes.ok) { setErr(topRes.error); setBusy(false); return }

    // 2) Extracted fields (merged into JSONB by the server action)
    const fields: Record<string, unknown> = {
      beneficiary_name_ar: benName.trim() || null,
      beneficiary_capacity_ar: benCap.trim() || null,
      disbursement_type_code: dsbType || null,
      invoice_amount_sar: invAmount.trim() ? Number(invAmount) : null,
      vat_amount_sar: vatAmount.trim() ? Number(vatAmount) : null,
      invoice_number: invoiceNumber.trim() || null,
    }
    const efRes = await updateExtractedFields({ case_id: kase.id, fields })
    setBusy(false)
    if (!efRes.ok) { setErr(efRes.error); return }

    setOpen(false)
    startTransition(() => router.refresh())
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
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full my-8" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-teal-700" />
                <h3 className="serif font-bold text-slate-900">تعديل الطلب <span className="font-mono text-sm text-slate-500">{kase.case_number}</span></h3>
              </div>
              <button type="button" onClick={() => !busy && setOpen(false)} disabled={busy} className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="رقم السند">
                  <input type="text" className={inp} value={voucherNo} onChange={(e) => setVoucherNo(e.target.value)} disabled={busy} />
                </Field>
                <Field label="تاريخ السند">
                  <input type="date" className={inp} value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} disabled={busy} dir="ltr" />
                </Field>
                <Field label="المبلغ (ر.س)">
                  <input type="number" step="0.01" min={0} className={inp} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
                </Field>
                <Field label="تاريخ التسليم">
                  <input type="date" className={inp} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} disabled={busy} dir="ltr" />
                </Field>

                <Field label="اسم المستفيد">
                  <input type="text" className={inp} value={benName} onChange={(e) => setBenName(e.target.value)} disabled={busy} />
                </Field>
                <Field label="صفة المستفيد">
                  <input type="text" className={inp} value={benCap} onChange={(e) => setBenCap(e.target.value)} disabled={busy} />
                </Field>

                <Field label="نوع الصرف">
                  <select className={inp} value={dsbType} onChange={(e) => setDsbType(e.target.value)} disabled={busy}>
                    <option value="">— اختر —</option>
                    {disbursementTypes.map((t) => (
                      <option key={t.code} value={t.code}>{t.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="رقم الفاتورة">
                  <input type="text" className={inp} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} disabled={busy} />
                </Field>

                <Field label="قيمة الفاتورة قبل الضريبة">
                  <input type="number" step="0.01" min={0} className={inp} value={invAmount} onChange={(e) => setInvAmount(e.target.value)} disabled={busy} />
                </Field>
                <Field label="الضريبة">
                  <input type="number" step="0.01" min={0} className={inp} value={vatAmount} onChange={(e) => setVatAmount(e.target.value)} disabled={busy} />
                </Field>
              </div>

              <Field label="ملاحظات">
                <textarea rows={3} className={inp + ' min-h-[70px]'} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
              </Field>

              {err && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{err}</div>
              )}

              <div className="flex items-center gap-2 flex-wrap justify-between pt-2">
                <Link href={`/app/disbursements/${kase.id}`} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-slate-500 hover:text-teal-700 inline-flex items-center gap-1">
                  فتح صفحة الطلب <ExternalLink className="w-3 h-3" />
                </Link>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setOpen(false)} disabled={busy}
                    className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
                    إلغاء
                  </button>
                  <button type="button" onClick={onSave} disabled={busy}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:opacity-50">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    حفظ
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  )
}
