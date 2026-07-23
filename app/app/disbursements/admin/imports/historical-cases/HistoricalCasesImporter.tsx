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
  { key: 'case_number', label: 'رقم الطلب' },
  { key: 'voucher', label: 'رقم السند' },
  { key: 'voucher_date', label: 'تاريخ السند' },
  { key: 'amount', label: 'المبلغ' },
  { key: 'type', label: 'نوع الصرف' },
  { key: 'beneficiary', label: 'المستفيد' },
  { key: 'delivery_date', label: 'تاريخ التسليم' },
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
        case_number: case_number ?? '—',
        voucher: voucher_number_text ?? '—',
        voucher_date: voucher_date ?? '—',
        amount: fmtAmount(amount),
        type: disbursement_type_ar ?? '—',
        beneficiary: beneficiary_name ?? '—',
        delivery_date: delivery_date ?? '—',
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
