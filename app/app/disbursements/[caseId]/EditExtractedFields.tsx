'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { updateExtractedFields } from './actions'
import type { ExtractedFields, DisbursementTypeCode } from './ExtractedFieldsPanel'

const DTYPE_OPTIONS: Array<{ code: DisbursementTypeCode; label: string }> = [
  { code: 'admin_marketing',       label: 'مصاريف إدارية وتسويقية' },
  { code: 'construction',          label: 'مصاريف إنشائية' },
  { code: 'bank_financing',        label: 'من قيمة تمويل بنكي' },
  { code: 'moh_incentive',         label: 'من قيمة حافز وزارة الإسكان' },
  { code: 'unit_seriousness_fees', label: 'رسوم الجدية في شراء الوحدة العقارية المختارة' },
  { code: 'vat_project_registry',  label: 'ضريبة القيمة المضافة عن السجل الضريبي للمشروع' },
  { code: 'vat_sales_payment',     label: 'سداد ضريبة القيمة المضافة المستلمة عن المبيعات للمشروع' },
  { code: 'other',                 label: 'أخرى' },
]

type LineItem = {
  description_ar?: string | null
  description_en?: string | null
  quantity?: number | null
  unit_price_sar?: number | null
  line_total_sar?: number | null
}

type InvoiceEntry = {
  number?: string | null
  date?: string | null
  total_sar?: number | null
  vat_sar?: number | null
  issued_to?: string | null
}

/**
 * Editable wrapper over the AI extraction. Click "تعديل" → all extracted
 * fields become editable inputs (Arabic + English names, IBAN, invoice
 * totals, ticked disbursement type, line items). Save merges edits into
 * dsb_cases.extracted_fields via the updateExtractedFields server action.
 *
 * Line items support add / remove / per-row edit. The shape mirrors what
 * Claude returns so re-extraction doesn't have to bridge formats.
 */
export function EditExtractedFields({
  caseId,
  extracted,
  canEdit,
}: {
  caseId: string
  extracted: ExtractedFields | null
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Local edit state (only populated when "open" is true).
  const e = extracted ?? {}
  const [developerAr, setDeveloperAr] = useState((e.developer_name_ar as string | null) ?? '')
  const [developerEn, setDeveloperEn] = useState((e.developer_name_en as string | null) ?? '')
  const [beneficiaryAr, setBeneficiaryAr] = useState((e.beneficiary_name_ar as string | null) ?? '')
  const [beneficiaryEn, setBeneficiaryEn] = useState((e.beneficiary_name_en as string | null) ?? '')
  const [beneAccount, setBeneAccount] = useState((e.beneficiary_account_number as string | null) ?? '')
  const [beneBank, setBeneBank] = useState((e.beneficiary_bank_name as string | null) ?? '')
  const [beneIban, setBeneIban] = useState((e.beneficiary_iban as string | null) ?? '')
  const [invoiceNumber, setInvoiceNumber] = useState((e.invoice_number as string | null) ?? '')
  const [invoiceDate, setInvoiceDate] = useState((e.invoice_date as string | null) ?? '')
  const [invoiceTotal, setInvoiceTotal] = useState<string>(
    e.invoice_total_sar != null ? String(e.invoice_total_sar) : '',
  )
  const [invoiceVat, setInvoiceVat] = useState<string>(
    e.invoice_vat_sar != null ? String(e.invoice_vat_sar) : '',
  )
  const [issuedTo, setIssuedTo] = useState((e.issued_to as string | null) ?? '')
  const [dtypeLabel, setDtypeLabel] = useState((e.disbursement_type_label_ar as string | null) ?? '')
  const [dtypeCode, setDtypeCode] = useState<DisbursementTypeCode | ''>(
    (e.disbursement_type_code as DisbursementTypeCode | null) ?? '',
  )
  const [lineItems, setLineItems] = useState<LineItem[]>(
    Array.isArray(e.line_items) ? (e.line_items as LineItem[]) : [],
  )
  const [invoices, setInvoices] = useState<InvoiceEntry[]>(
    Array.isArray(e.invoices) ? (e.invoices as InvoiceEntry[]) : [],
  )

  function reset() {
    setDeveloperAr((e.developer_name_ar as string | null) ?? '')
    setDeveloperEn((e.developer_name_en as string | null) ?? '')
    setBeneficiaryAr((e.beneficiary_name_ar as string | null) ?? '')
    setBeneficiaryEn((e.beneficiary_name_en as string | null) ?? '')
    setBeneAccount((e.beneficiary_account_number as string | null) ?? '')
    setBeneBank((e.beneficiary_bank_name as string | null) ?? '')
    setBeneIban((e.beneficiary_iban as string | null) ?? '')
    setInvoiceNumber((e.invoice_number as string | null) ?? '')
    setInvoiceDate((e.invoice_date as string | null) ?? '')
    setInvoiceTotal(e.invoice_total_sar != null ? String(e.invoice_total_sar) : '')
    setInvoiceVat(e.invoice_vat_sar != null ? String(e.invoice_vat_sar) : '')
    setIssuedTo((e.issued_to as string | null) ?? '')
    setDtypeLabel((e.disbursement_type_label_ar as string | null) ?? '')
    setDtypeCode((e.disbursement_type_code as DisbursementTypeCode | null) ?? '')
    setLineItems(Array.isArray(e.line_items) ? (e.line_items as LineItem[]) : [])
    setInvoices(Array.isArray(e.invoices) ? (e.invoices as InvoiceEntry[]) : [])
    setError(null)
  }

  function updateLineItem(idx: number, key: keyof LineItem, value: string) {
    setLineItems((prev) => {
      const next = prev.slice()
      const row = { ...(next[idx] ?? {}) }
      if (key === 'quantity' || key === 'unit_price_sar' || key === 'line_total_sar') {
        const n = value.trim() === '' ? null : Number(value)
        ;(row as Record<string, unknown>)[key] = Number.isFinite(n as number) ? n : null
      } else {
        ;(row as Record<string, unknown>)[key] = value.trim() === '' ? null : value
      }
      next[idx] = row
      return next
    })
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, { description_ar: '', quantity: null, unit_price_sar: null, line_total_sar: null }])
  }

  function removeLineItem(idx: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateInvoice(idx: number, key: keyof InvoiceEntry, value: string) {
    setInvoices((prev) => {
      const next = prev.slice()
      const row = { ...(next[idx] ?? {}) }
      if (key === 'total_sar' || key === 'vat_sar') {
        const n = value.trim() === '' ? null : Number(value)
        ;(row as Record<string, unknown>)[key] = Number.isFinite(n as number) ? n : null
      } else {
        ;(row as Record<string, unknown>)[key] = value.trim() === '' ? null : value
      }
      next[idx] = row
      return next
    })
  }

  function addInvoice() {
    setInvoices((prev) => [
      ...prev,
      { number: '', date: '', total_sar: null, vat_sar: null, issued_to: '' },
    ])
  }

  function removeInvoice(idx: number) {
    setInvoices((prev) => prev.filter((_, i) => i !== idx))
  }

  function parseNumberField(v: string): number | null {
    if (v.trim() === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  async function onSave() {
    setError(null)

    const invoiceDateOk =
      !invoiceDate || /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)
    if (!invoiceDateOk) {
      setError('تاريخ الفاتورة يجب أن يكون YYYY-MM-DD.')
      return
    }
    // Per-row date validation for the invoices[] array (empty allowed).
    for (const inv of invoices) {
      const d = (inv.date ?? '').trim()
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        setError('تواريخ الفواتير يجب أن تكون YYYY-MM-DD.')
        return
      }
    }

    // Reconcile the invoices[] array with the singular scalar fields.
    //   - 0 rows  → singulars stand alone; invoices set to null.
    //   - 1 row   → mirror the singulars into invoices[0] so the two stay
    //               consistent on save (the editor exposes the singulars as
    //               the primary UI when there's just one invoice).
    //   - 2+ rows → keep the array intact; copy row 0 into the singulars so
    //               downstream consumers reading singulars see the primary
    //               invoice, not stale data from a prior extraction.
    const singular: InvoiceEntry = {
      number: invoiceNumber.trim() || null,
      date: invoiceDate || null,
      total_sar: parseNumberField(invoiceTotal),
      vat_sar: parseNumberField(invoiceVat),
      issued_to: issuedTo.trim() || null,
    }

    let invoicesOut: InvoiceEntry[] | null
    let primary: InvoiceEntry
    if (invoices.length === 0) {
      invoicesOut = null
      primary = singular
    } else if (invoices.length === 1) {
      // Editor shows only the singulars in this case, so the singulars are
      // the source of truth — overwrite invoices[0] with them.
      invoicesOut = [singular]
      primary = singular
    } else {
      invoicesOut = invoices.map((inv) => ({
        number: (inv.number ?? '') === '' ? null : inv.number,
        date: (inv.date ?? '') === '' ? null : inv.date,
        total_sar: typeof inv.total_sar === 'number' && Number.isFinite(inv.total_sar) ? inv.total_sar : null,
        vat_sar: typeof inv.vat_sar === 'number' && Number.isFinite(inv.vat_sar) ? inv.vat_sar : null,
        issued_to: (inv.issued_to ?? '') === '' ? null : inv.issued_to,
      }))
      primary = invoicesOut[0]!
    }

    const fields: Record<string, unknown> = {
      developer_name_ar: developerAr.trim() || null,
      developer_name_en: developerEn.trim() || null,
      beneficiary_name_ar: beneficiaryAr.trim() || null,
      beneficiary_name_en: beneficiaryEn.trim() || null,
      beneficiary_account_number: beneAccount.trim() || null,
      beneficiary_bank_name: beneBank.trim() || null,
      beneficiary_iban: beneIban.trim() || null,
      invoice_number: primary.number ?? null,
      invoice_date: primary.date ?? null,
      invoice_total_sar: primary.total_sar ?? null,
      invoice_vat_sar: primary.vat_sar ?? null,
      issued_to: primary.issued_to ?? null,
      invoices: invoicesOut,
      disbursement_type_label_ar: dtypeLabel.trim() || null,
      disbursement_type_code: dtypeCode || null,
      line_items: lineItems.length > 0 ? lineItems : null,
    }

    setSaving(true)
    const res = await updateExtractedFields({ case_id: caseId, fields })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    startTransition(() => router.refresh())
  }

  if (!canEdit) return null

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { reset(); setOpen(true) }}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
      >
        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
        تعديل البيانات المستخرجة
      </button>
    )
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'
  const labelCls = 'text-xs font-semibold text-slate-500 mb-1 block'

  return (
    <div className="bg-teal-50/30 border border-teal-200 rounded-lg p-4 space-y-4">
      <h3 className="serif font-bold text-sm text-slate-900">تعديل البيانات المستخرجة</h3>

      {/* Disbursement type */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className={labelCls}>نوع الصرف (الرمز)</label>
          <select className={inputCls} value={dtypeCode} onChange={(ev) => {
            const newCode = ev.target.value as DisbursementTypeCode | ''
            setDtypeCode(newCode)
            // If the operator picks from the dropdown, mirror the canonical Arabic
            // label into the literal-label field automatically. They can still edit.
            if (newCode) {
              const opt = DTYPE_OPTIONS.find((o) => o.code === newCode)
              if (opt) setDtypeLabel(opt.label)
            }
          }} disabled={saving}>
            <option value="">— غير محدد —</option>
            {DTYPE_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>نوع الصرف (النص العربي)</label>
          <input className={inputCls} value={dtypeLabel} onChange={(ev) => setDtypeLabel(ev.target.value)} disabled={saving} />
        </div>
      </div>

      {/* Developer + beneficiary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>اسم المطور (عربي)</label>
          <input className={inputCls} value={developerAr} onChange={(ev) => setDeveloperAr(ev.target.value)} disabled={saving} />
        </div>
        <div>
          <label className={labelCls}>اسم المطور (English)</label>
          <input className={inputCls} value={developerEn} onChange={(ev) => setDeveloperEn(ev.target.value)} disabled={saving} dir="ltr" />
        </div>
        <div>
          <label className={labelCls}>اسم المستفيد (عربي)</label>
          <input className={inputCls} value={beneficiaryAr} onChange={(ev) => setBeneficiaryAr(ev.target.value)} disabled={saving} />
        </div>
        <div>
          <label className={labelCls}>اسم المستفيد (English)</label>
          <input className={inputCls} value={beneficiaryEn} onChange={(ev) => setBeneficiaryEn(ev.target.value)} disabled={saving} dir="ltr" />
        </div>
        <div>
          <label className={labelCls}>حساب المستفيد</label>
          <input className={inputCls} value={beneAccount} onChange={(ev) => setBeneAccount(ev.target.value)} disabled={saving} dir="ltr" />
        </div>
        <div>
          <label className={labelCls}>بنك المستفيد</label>
          <input className={inputCls} value={beneBank} onChange={(ev) => setBeneBank(ev.target.value)} disabled={saving} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>الآيبان</label>
          <input className={inputCls} value={beneIban} onChange={(ev) => setBeneIban(ev.target.value)} disabled={saving} dir="ltr" />
        </div>
      </div>

      {/* Invoice — singulars shown when the case has 0 or 1 invoices in the
          array. When 2+ invoices exist, the multi-invoice table below
          becomes the source of truth and the singulars are hidden (they get
          re-populated from invoices[0] on save). */}
      {invoices.length < 2 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>رقم الفاتورة</label>
            <input className={inputCls} value={invoiceNumber} onChange={(ev) => setInvoiceNumber(ev.target.value)} disabled={saving} />
          </div>
          <div>
            <label className={labelCls}>تاريخ الفاتورة</label>
            <input type="date" className={inputCls} value={invoiceDate} onChange={(ev) => setInvoiceDate(ev.target.value)} disabled={saving} dir="ltr" />
          </div>
          <div>
            <label className={labelCls}>إجمالي الفاتورة (ر.س)</label>
            <input type="number" min="0" step="0.01" className={inputCls} value={invoiceTotal} onChange={(ev) => setInvoiceTotal(ev.target.value)} disabled={saving} dir="ltr" />
          </div>
          <div>
            <label className={labelCls}>ضريبة القيمة المضافة (ر.س)</label>
            <input type="number" min="0" step="0.01" className={inputCls} value={invoiceVat} onChange={(ev) => setInvoiceVat(ev.target.value)} disabled={saving} dir="ltr" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>صادرة إلى</label>
            <input className={inputCls} value={issuedTo} onChange={(ev) => setIssuedTo(ev.target.value)} disabled={saving} />
          </div>
        </div>
      )}

      {/* Multi-invoice editor: shown when 2+ invoices exist. The "+ إضافة
          فاتورة" button below promotes the singular into invoices[0] and
          appends a blank row so the operator can start adding entries. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h4 className="serif font-bold text-sm text-slate-900">
            الفواتير
            {invoices.length > 0 && (
              <span className="text-xs font-normal text-slate-500 ms-1">({invoices.length})</span>
            )}
          </h4>
          <button
            type="button"
            onClick={() => {
              // If we're still in "single invoice" mode, capture the singulars
              // as invoices[0] before appending a blank row — otherwise the
              // switch to table mode would drop the singular values.
              if (invoices.length < 2) {
                const seed: InvoiceEntry = {
                  number: invoiceNumber.trim() || null,
                  date: invoiceDate || null,
                  total_sar: parseNumberField(invoiceTotal),
                  vat_sar: parseNumberField(invoiceVat),
                  issued_to: issuedTo.trim() || null,
                }
                const existing = invoices.length === 1 ? invoices[0]! : seed
                setInvoices([
                  existing,
                  { number: '', date: '', total_sar: null, vat_sar: null, issued_to: '' },
                ])
              } else {
                addInvoice()
              }
            }}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            إضافة فاتورة
          </button>
        </div>
        {invoices.length < 2 ? (
          <div className="text-xs text-slate-500 text-center py-3 border border-dashed border-slate-200 rounded-md">
            الفاتورة الحالية معروضة أعلاه. اضغط «إضافة فاتورة» لبدء إضافة فواتير متعددة.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] font-semibold text-slate-500 bg-slate-50 border-b border-slate-200">
                  <th className="text-start py-1.5 px-2">رقم</th>
                  <th className="text-start py-1.5 px-2 w-32">التاريخ</th>
                  <th className="text-end py-1.5 px-2 w-28">الإجمالي</th>
                  <th className="text-end py-1.5 px-2 w-28">الضريبة</th>
                  <th className="text-start py-1.5 px-2">صادرة إلى</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, idx) => (
                  <tr key={idx} className="border-b border-slate-100 last:border-b-0">
                    <td className="py-1.5 px-1.5">
                      <input
                        className={inputCls + ' text-xs font-mono'}
                        value={(inv.number as string | null) ?? ''}
                        onChange={(ev) => updateInvoice(idx, 'number', ev.target.value)}
                        disabled={saving}
                      />
                    </td>
                    <td className="py-1.5 px-1.5">
                      <input
                        type="date"
                        className={inputCls + ' text-xs'}
                        value={(inv.date as string | null) ?? ''}
                        onChange={(ev) => updateInvoice(idx, 'date', ev.target.value)}
                        disabled={saving}
                        dir="ltr"
                      />
                    </td>
                    <td className="py-1.5 px-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputCls + ' text-xs font-mono'}
                        value={inv.total_sar != null ? String(inv.total_sar) : ''}
                        onChange={(ev) => updateInvoice(idx, 'total_sar', ev.target.value)}
                        disabled={saving}
                        dir="ltr"
                      />
                    </td>
                    <td className="py-1.5 px-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputCls + ' text-xs font-mono'}
                        value={inv.vat_sar != null ? String(inv.vat_sar) : ''}
                        onChange={(ev) => updateInvoice(idx, 'vat_sar', ev.target.value)}
                        disabled={saving}
                        dir="ltr"
                      />
                    </td>
                    <td className="py-1.5 px-1.5">
                      <input
                        className={inputCls + ' text-xs'}
                        value={(inv.issued_to as string | null) ?? ''}
                        onChange={(ev) => updateInvoice(idx, 'issued_to', ev.target.value)}
                        disabled={saving}
                      />
                    </td>
                    <td className="py-1.5 px-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => removeInvoice(idx)}
                        disabled={saving}
                        title="حذف الفاتورة"
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Line items */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h4 className="serif font-bold text-sm text-slate-900">بنود الفاتورة</h4>
          <button
            type="button"
            onClick={addLineItem}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            إضافة بند
          </button>
        </div>
        {lineItems.length === 0 ? (
          <div className="text-xs text-slate-500 text-center py-3 border border-dashed border-slate-200 rounded-md">
            لا توجد بنود — اضغط «إضافة بند» للإضافة.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] font-semibold text-slate-500 bg-slate-50 border-b border-slate-200">
                  <th className="text-start py-1.5 px-2">الوصف</th>
                  <th className="text-end py-1.5 px-2 w-20">الكمية</th>
                  <th className="text-end py-1.5 px-2 w-24">السعر</th>
                  <th className="text-end py-1.5 px-2 w-24">الإجمالي</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li, idx) => (
                  <tr key={idx} className="border-b border-slate-100 last:border-b-0">
                    <td className="py-1.5 px-1.5">
                      <input
                        className={inputCls + ' text-xs'}
                        value={(li.description_ar as string | null) ?? ''}
                        onChange={(ev) => updateLineItem(idx, 'description_ar', ev.target.value)}
                        disabled={saving}
                      />
                    </td>
                    <td className="py-1.5 px-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputCls + ' text-xs font-mono'}
                        value={li.quantity != null ? String(li.quantity) : ''}
                        onChange={(ev) => updateLineItem(idx, 'quantity', ev.target.value)}
                        disabled={saving}
                        dir="ltr"
                      />
                    </td>
                    <td className="py-1.5 px-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputCls + ' text-xs font-mono'}
                        value={li.unit_price_sar != null ? String(li.unit_price_sar) : ''}
                        onChange={(ev) => updateLineItem(idx, 'unit_price_sar', ev.target.value)}
                        disabled={saving}
                        dir="ltr"
                      />
                    </td>
                    <td className="py-1.5 px-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputCls + ' text-xs font-mono'}
                        value={li.line_total_sar != null ? String(li.line_total_sar) : ''}
                        onChange={(ev) => updateLineItem(idx, 'line_total_sar', ev.target.value)}
                        disabled={saving}
                        dir="ltr"
                      />
                    </td>
                    <td className="py-1.5 px-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => removeLineItem(idx)}
                        disabled={saving}
                        title="حذف البند"
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-1">
        <button type="button" onClick={onSave} disabled={saving} className="inline-flex items-center px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50">
          {saving ? 'جارٍ الحفظ…' : 'حفظ التغييرات'}
        </button>
        <button type="button" onClick={() => { reset(); setOpen(false) }} disabled={saving} className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50">
          إلغاء
        </button>
      </div>
    </div>
  )
}
