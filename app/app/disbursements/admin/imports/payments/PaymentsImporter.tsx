'use client'

import { BaseImporter, type BaseImporterProps } from '../_shared/BaseImporter'
import {
  PAYMENT_FIELDS,
  toIsoDateOrNull,
  toNumOrNull,
  toStr,
  type MappingField,
  type ProjectLite,
} from '../_shared/shared-mapping'
import { bulkImportPayments, type PaymentRow } from '../historical-cases/actions'

type Payload = PaymentRow

const PREVIEW_COLUMNS = [
  { key: 'date', label: 'تاريخ الدفع' },
  { key: 'amount', label: 'المبلغ' },
  { key: 'vat', label: 'الضريبة' },
  { key: 'beneficiary', label: 'المستفيد' },
  { key: 'reference', label: 'المرجع' },
  { key: 'method', label: 'الطريقة' },
  { key: 'account', label: 'الحساب' },
  { key: 'case', label: 'رقم الطلب' },
] as const

function fmtAmount(v: number | null): string {
  if (v === null) return '—'
  const n = Math.round(v)
  return Math.abs(v - n) < 0.005
    ? n.toLocaleString('en-US')
    : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function PaymentsImporter({ projects }: { projects: ProjectLite[] }) {
  const parseRow: BaseImporterProps<Payload>['parseRow'] = ({
    rowValues,
    columns,
    sheetName,
    rowNumber,
    projectRaw,
  }) => {
    const at = (idx: number | null): unknown =>
      idx === null || idx < 0 ? '' : rowValues[idx]

    const payment_date = toIsoDateOrNull(at(columns.payment_date))
    const amount = toNumOrNull(at(columns.payment_amount))
    // Ledger rows without a date or a positive amount are useless — drop
    // them at parse time so the preview only lists usable rows.
    if (!payment_date || amount === null || amount <= 0) return null

    const vat = toNumOrNull(at(columns.vat_sar))
    const beneficiary = toStr(at(columns.beneficiary_name)) || null
    const description = toStr(at(columns.payment_description)) || null
    const reference = toStr(at(columns.payment_reference)) || null
    const method = toStr(at(columns.payment_method)) || null
    const account_number = toStr(at(columns.account_number)) || null
    const account_label = toStr(at(columns.account_label)) || null
    const case_number = toStr(at(columns.case_number)) || null
    const unit_number = toStr(at(columns.unit_number)) || null

    return {
      sheetName,
      rowNumber,
      projectRaw,
      // BaseImporter still displays unit_number in a dedicated column; we
      // reuse it here to hint at the case's unit link.
      unit_number: unit_number ?? '',
      previewCells: {
        date: payment_date,
        amount: fmtAmount(amount),
        vat: fmtAmount(vat),
        beneficiary: beneficiary ?? '—',
        reference: reference ?? '—',
        method: method ?? '—',
        account: account_number ?? account_label ?? '—',
        case: case_number ?? '—',
      },
      payload: {
        project_id: '', // filled by attachProjectId (or left empty for orphans)
        account_number,
        account_label,
        case_number,
        unit_number,
        payment_date,
        amount_sar: amount,
        vat_sar: vat,
        beneficiary_name: beneficiary,
        description,
        reference_number: reference,
        payment_method: method,
      },
    }
  }

  return (
    <BaseImporter<Payload>
      title="ملف Excel: سجل الدفعات المالية"
      subtitle="ارفع ملف يحتوي على سجل المعاملات (تاريخ الدفع، المبلغ، الضريبة، اسم المستفيد، رقم المرجع، طريقة الدفع، رقم الحساب، رقم الطلب، رقم الوحدة، اسم المشروع). الروابط للمشروع/الحساب/الطلب/الوحدة اختيارية — الصفوف غير المرتبطة تُدرَج كذلك."
      projects={projects}
      relevantFields={PAYMENT_FIELDS as readonly MappingField[]}
      previewColumns={PREVIEW_COLUMNS}
      parseRow={parseRow}
      allowOrphan
      attachProjectId={(payload, projectId) => ({
        ...payload,
        project_id: projectId || null,
      })}
      onSubmit={async (payloads) => {
        const res = await bulkImportPayments({ rows: payloads })
        if (!res.ok) return { ok: false, message: res.error }
        return {
          ok: true,
          message: (
            <>
              أُدرجت{' '}
              <span className="font-mono font-bold">{res.inserted}</span> دفعة
              في السجل.
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
            res.skipped.length > 0 || res.unmatched.length > 0 ? (
              <div className="space-y-2">
                {res.skipped.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    <div className="font-semibold mb-1">
                      الصفوف المُتجاهَلة ({res.skipped.length}):
                    </div>
                    <ul className="list-disc ms-5 space-y-0.5 max-h-40 overflow-y-auto">
                      {res.skipped.slice(0, 20).map((s, i) => (
                        <li key={i}>
                          <span className="font-mono">صف {s.row}</span> —{' '}
                          {s.reason}
                        </li>
                      ))}
                      {res.skipped.length > 20 && (
                        <li>… (+{res.skipped.length - 20} أخرى)</li>
                      )}
                    </ul>
                  </div>
                )}
                {res.unmatched.length > 0 && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
                    <div className="font-semibold mb-1">
                      الروابط غير المُطابَقة ({res.unmatched.length}) — دُرِجت
                      كصفوف يتيمة:
                    </div>
                    <ul className="list-disc ms-5 space-y-0.5 max-h-40 overflow-y-auto">
                      {res.unmatched.slice(0, 20).map((u, i) => (
                        <li key={i}>
                          <span className="font-mono">صف {u.row}</span> — {u.field}:{' '}
                          {u.value}
                        </li>
                      ))}
                      {res.unmatched.length > 20 && (
                        <li>… (+{res.unmatched.length - 20} أخرى)</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            ) : undefined,
        }
      }}
    />
  )
}
