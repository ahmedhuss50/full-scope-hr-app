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
  { key: 'beneficiary', label: 'المشتري' },
  { key: 'reference', label: 'المرجع' },
  { key: 'method', label: 'الطريقة' },
  { key: 'account', label: 'الحساب' },
  { key: 'case', label: 'رقم الطلب' },
  { key: 'contract', label: 'رقم العقد' },
  { key: 'category', label: 'نوع الإيداع' },
] as const

/**
 * Map the raw «نوع الإيداع» text from the Excel sheet to our internal
 * deposit_category code. Only «تحصيل مشتري» triggers the 76/20/4 split
 * (see distributeBuyerDeposit). Everything else lands as-is with no split.
 *
 * We normalize whitespace + drop diacritics before matching so «تَحْصِيل مُشْتَرِي»
 * or «تحصيل  مشتري» still resolves correctly.
 */
function mapDepositCategory(raw: string | null): 'buyer_collection' | 'wrong_transfer' | 'self_financing' | 'bank_financing' | 'other' {
  if (!raw) return 'buyer_collection' // default matches migration 062 default
  const n = raw
    .normalize('NFKC')
    .replace(/[ً-ْٰـ]/g, '') // diacritics + tatweel
    .replace(/\s+/g, ' ')
    .trim()
  if (n.includes('تحصيل مشتري') || n.includes('تحصيل المشتري')) return 'buyer_collection'
  if (n.includes('حوالة خاطئة') || n.includes('حواله خاطئه') || n.includes('خاطئة') || n.includes('خاطئه')) return 'wrong_transfer'
  if (n.includes('تمويل ذاتي')) return 'self_financing'
  if (n.includes('تمويل بنكي')) return 'bank_financing'
  if (n === 'أخرى' || n === 'اخرى' || n.includes('أخرى') || n.includes('اخرى')) return 'other'
  return 'buyer_collection' // unknown value → treat as buyer collection (safe default)
}

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
    // Only drop rows we truly can't store: no date OR no numeric amount at
    // all. NEGATIVE and ZERO amounts are legitimate (refunds, reversals,
    // adjustments) and belong in the ledger — dropping them was silently
    // losing data the user wants uploaded.
    if (!payment_date || amount === null) return null

    const vat = toNumOrNull(at(columns.vat_sar))
    const beneficiary = toStr(at(columns.beneficiary_name)) || null
    const description = toStr(at(columns.payment_description)) || null
    const reference = toStr(at(columns.payment_reference)) || null
    const method = toStr(at(columns.payment_method)) || null
    const account_number = toStr(at(columns.account_number)) || null
    const account_label = toStr(at(columns.account_label)) || null
    const case_number = toStr(at(columns.case_number)) || null
    const unit_number = toStr(at(columns.unit_number)) || null
    const contract_number = toStr(at(columns.contract_number)) || null
    const category_raw = toStr(at(columns.deposit_category_raw)) || null
    const deposit_category = mapDepositCategory(category_raw)

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
        contract: contract_number ?? '—',
        // Show the resolved code + a hint when we defaulted or the raw
        // value was unrecognized. Helps the operator spot misspelled
        // categories BEFORE hitting submit.
        category: category_raw
          ? `${category_raw} → ${deposit_category}`
          : deposit_category,
      },
      payload: {
        project_id: '', // filled by attachProjectId (or left empty for orphans)
        account_number,
        account_label,
        case_number,
        unit_number,
        contract_number,
        payment_date,
        amount_sar: amount,
        vat_sar: vat,
        beneficiary_name: beneficiary,
        description,
        reference_number: reference,
        payment_method: method,
        deposit_category,
      },
    }
  }

  return (
    <BaseImporter<Payload>
      title="ملف Excel: سجل الدفعات المالية"
      subtitle="ارفع ملف يحتوي على سجل المعاملات (تاريخ الدفع، المبلغ، الضريبة، اسم المشتري، رقم المرجع، طريقة الدفع، رقم الحساب، رقم الطلب، رقم الوحدة، اسم المشروع). الروابط للمشروع/الحساب/الطلب/الوحدة اختيارية — الصفوف غير المرتبطة تُدرَج كذلك."
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
