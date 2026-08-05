'use client'

import { BaseImporter, type BaseImporterProps } from '../_shared/BaseImporter'
import {
  HISTORICAL_CASE_FIELDS,
  toIsoDateOrNull,
  toNumOrNull,
  toStr,
  type MappingField,
  type ProjectLite,
} from '../_shared/shared-mapping'
import { bulkImportHistoricalCases, type HistoricalCaseRow } from './actions'

type Payload = HistoricalCaseRow

const PREVIEW_COLUMNS = [
  { key: 'voucher', label: 'رقم الوثيقة' },
  { key: 'voucher_date', label: 'تاريخ الوثيقة' },
  { key: 'account', label: 'الحساب' },
  { key: 'type', label: 'نوع الصرف' },
  { key: 'amount', label: 'المبلغ' },
  { key: 'beneficiary', label: 'المستفيد' },
  { key: 'paid_at', label: 'تاريخ الدفع' },
  { key: 'delivery', label: 'التسليم' },
  { key: 'invoice', label: 'رقم الفاتورة' },
] as const

function fmtAmount(v: number | null): string {
  if (v === null) return '—'
  const n = Math.round(v)
  return Math.abs(v - n) < 0.005
    ? n.toLocaleString('en-US')
    : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function HistoricalCasesImporter({ projects }: { projects: ProjectLite[] }) {
  const parseRow: BaseImporterProps<Payload>['parseRow'] = ({
    rowValues,
    columns,
    sheetName,
    rowNumber,
    projectRaw,
  }) => {
    const at = (idx: number | null): unknown =>
      idx === null || idx < 0 ? '' : rowValues[idx]

    const case_number = toStr(at(columns.case_number)) || null
    const voucher_number_text = toStr(at(columns.voucher_number_text)) || null
    const voucher_date = toIsoDateOrNull(at(columns.voucher_date))
    // Amount can be under either case_amount_sar (voucher-specific) or the
    // more generic payment_amount if that's the only amount column present.
    const amount =
      toNumOrNull(at(columns.case_amount_sar)) ??
      toNumOrNull(at(columns.payment_amount))
    const disbursement_type_ar = toStr(at(columns.disbursement_type_ar)) || null
    const beneficiary_name = toStr(at(columns.beneficiary_name)) || null
    const sale_date = toIsoDateOrNull(at(columns.sale_date))
    const delivery_date = toIsoDateOrNull(at(columns.delivery_date))
    const unit_number = toStr(at(columns.unit_number)) || null
    // Extended voucher schema.
    const account_label = toStr(at(columns.account_label)) || null
    const beneficiary_role = toStr(at(columns.beneficiary_role)) || null
    const approval_date = toIsoDateOrNull(at(columns.approval_date))
    const payment_date = toIsoDateOrNull(at(columns.payment_date))
    const delivery_status_raw = toStr(at(columns.delivery_status)) || null
    const recipient_name = toStr(at(columns.recipient_name)) || null
    const recipient_phone = toStr(at(columns.recipient_phone)) || null
    const invoice_number = toStr(at(columns.invoice_number)) || null
    const invoice_date = toIsoDateOrNull(at(columns.invoice_date))
    const invoice_payment_type = toStr(at(columns.invoice_payment_type)) || null
    // Description column often maps to payment_description or notes/بيان.
    const description = toStr(at(columns.payment_description)) || null

    // A row with no identifying info at all → drop. We require at least
    // ONE of: case_number, voucher_number, or beneficiary. Otherwise it's
    // almost certainly a blank/summary row from the sheet.
    if (!case_number && !voucher_number_text && !beneficiary_name && amount === null) {
      return null
    }

    return {
      sheetName,
      rowNumber,
      projectRaw,
      unit_number: unit_number ?? '',
      previewCells: {
        voucher: voucher_number_text ?? case_number ?? '—',
        voucher_date: voucher_date ?? '—',
        account: account_label ?? '—',
        type: disbursement_type_ar ?? '—',
        amount: fmtAmount(amount),
        beneficiary:
          beneficiary_role && beneficiary_name
            ? `${beneficiary_name} (${beneficiary_role})`
            : beneficiary_name ?? '—',
        paid_at: payment_date ?? '—',
        delivery:
          delivery_status_raw
            ? (delivery_date ? `${delivery_status_raw} (${delivery_date})` : delivery_status_raw)
            : (delivery_date ?? '—'),
        invoice:
          invoice_number
            ? (invoice_date ? `${invoice_number} (${invoice_date})` : invoice_number)
            : '—',
      },
      payload: {
        project_id: '', // filled by attachProjectId
        unit_number,
        case_number,
        voucher_number_text,
        voucher_date,
        amount_sar: amount,
        disbursement_type_ar,
        beneficiary_name,
        sale_date,
        delivery_date,
        delivered_at: delivery_date,
        // Extended fields (server action maps them into the case row +
        // extracted_fields JSONB, and does the account_label lookup).
        account_label,
        beneficiary_role,
        approval_date,
        payment_date,
        delivery_status_raw,
        recipient_name,
        recipient_phone,
        invoice_number,
        invoice_date,
        invoice_payment_type,
        description,
        historical_source_note: `Imported from sheet "${sheetName}" row ${rowNumber}`,
      },
    }
  }

  return (
    <BaseImporter<Payload>
      title="ملف Excel: الصرفيات السابقة"
      subtitle="ارفع ملف يحتوي على سجل الصرفيات القديمة (رقم الطلب/السند، تاريخ السند، مبلغ السند، نوع الصرف، اسم المستفيد، تاريخ التسليم، رقم الوحدة إن وُجد، اسم المشروع). تُدرج كطلبات مؤرشَفة مباشرةً دون مسار المراجعة."
      projects={projects}
      relevantFields={HISTORICAL_CASE_FIELDS as readonly MappingField[]}
      previewColumns={PREVIEW_COLUMNS}
      parseRow={parseRow}
      attachProjectId={(payload, projectId) => ({ ...payload, project_id: projectId })}
      // No checkExisting — historical cases don't require a matching unit
      // in dsb_project_units; the unit link is opportunistic.
      onSubmit={async (payloads) => {
        const res = await bulkImportHistoricalCases({ rows: payloads })
        if (!res.ok) return { ok: false, message: res.error }
        return {
          ok: true,
          message: (
            <>
              أُدرجت{' '}
              <span className="font-mono font-bold">{res.inserted}</span> صرفية
              تاريخية في الأرشيف.
              {res.skipped.length > 0 && (
                <>
                  {' '}
                  تم تجاهل{' '}
                  <span className="font-mono font-bold">{res.skipped.length}</span>{' '}
                  صف.
                </>
              )}
            </>
          ),
          extra:
            res.skipped.length > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                <div className="font-semibold mb-1">
                  الصفوف المُتجاهَلة ({res.skipped.length}):
                </div>
                <ul className="list-disc ms-5 space-y-0.5 max-h-40 overflow-y-auto">
                  {res.skipped.slice(0, 20).map((s, i) => (
                    <li key={i}>
                      <span className="font-mono">صف {s.row}</span> — {s.reason}
                    </li>
                  ))}
                  {res.skipped.length > 20 && (
                    <li>… (+{res.skipped.length - 20} أخرى)</li>
                  )}
                </ul>
              </div>
            ) : undefined,
        }
      }}
    />
  )
}
