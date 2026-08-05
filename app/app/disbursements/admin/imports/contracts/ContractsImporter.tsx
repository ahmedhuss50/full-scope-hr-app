'use client'

import { BaseImporter, type BaseImporterProps } from '../_shared/BaseImporter'
import {
  CONTRACT_FIELDS,
  toDeliveryStatus,
  toIntOrNull,
  toIsoDateOrNull,
  toNumOrNull,
  toPercentOrNull,
  toStr,
  type MappingField,
  type ProjectLite,
} from '../_shared/shared-mapping'
import {
  bulkImportContractsFromRows,
  checkExistingUnits,
  type BulkImportContractRow,
} from '../../units/actions'

type Payload = BulkImportContractRow

const PREVIEW_COLUMNS = [
  { key: 'contract_no', label: 'رقم العقد' },
  { key: 'sale_date', label: 'تاريخ البيع' },
  { key: 'price', label: 'السعر شامل الضريبة' },
  { key: 'financing', label: 'التمويل' },
  { key: 'delivery', label: 'التسليم' },
  { key: 'collection', label: 'التحصيل' },
] as const

/** Render a percentage value stored as either 0.35 or 35 → "35%". */
function fmtPct(v: number | null): string {
  if (v === null) return '—'
  const pct = Math.abs(v) <= 1 ? v * 100 : v
  return `${pct.toFixed(pct >= 100 ? 0 : 1)}%`
}

// Format numbers the way a sales report would — grouped, no decimals for
// integer-ish values. Keeps preview cells short.
function fmtPrice(v: number | null): string {
  if (v === null) return '—'
  const intish = Math.round(v)
  return Number.isInteger(v) || Math.abs(v - intish) < 0.01
    ? intish.toLocaleString('en-US')
    : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function ContractsImporter({
  projects,
  lockedProjectId = null,
}: {
  projects: ProjectLite[]
  // When set (via ?project=<id> on the page), all imported rows are pinned to
  // this project. The per-row project picker is hidden and the default-project
  // fallback panel is auto-filled + locked. Used by the project-page "استيراد
  // عقود ومشترين" shortcut.
  lockedProjectId?: string | null
}) {
  const parseRow: BaseImporterProps<Payload>['parseRow'] = ({
    rowValues,
    columns,
    sheetName,
    rowNumber,
    projectRaw,
  }) => {
    const at = (idx: number | null): unknown =>
      idx === null || idx < 0 ? '' : rowValues[idx]

    const unit_number = toStr(at(columns.unit_number))
    if (!unit_number) return null

    const contract_number = toStr(at(columns.contract_number)) || null
    const contract_type = toStr(at(columns.contract_type)) || null
    const financing_type = toStr(at(columns.financing_type)) || null
    const financing_bank = toStr(at(columns.financing_bank)) || null
    const sale_date = toIsoDateOrNull(at(columns.sale_date))
    const price_before_tax_sar = toNumOrNull(at(columns.price_before_tax_sar))
    const vat_sar = toNumOrNull(at(columns.vat_sar))
    const price_with_vat_sar = toNumOrNull(at(columns.price_with_vat_sar))
    const delivery_status = toDeliveryStatus(at(columns.delivery_status))
    const delivery_date = toIsoDateOrNull(at(columns.delivery_date))

    // Financial tracking (055).
    const retention_percentage = toPercentOrNull(at(columns.retention_percentage))
    const installment_number = toIntOrNull(at(columns.installment_number))
    const total_collected_before_tax_sar = toNumOrNull(
      at(columns.total_collected_before_tax_sar),
    )
    const total_collected_with_tax_sar = toNumOrNull(
      at(columns.total_collected_with_tax_sar),
    )
    const remaining_amount_sar = toNumOrNull(at(columns.remaining_amount_sar))
    const collection_percentage = toPercentOrNull(at(columns.collection_percentage))
    const price_per_meter_sar = toNumOrNull(at(columns.price_per_meter_sar))

    return {
      sheetName,
      rowNumber,
      projectRaw,
      unit_number,
      previewCells: {
        contract_no: contract_number ?? '—',
        sale_date: sale_date ?? '—',
        price: fmtPrice(price_with_vat_sar),
        financing:
          financing_bank ?? financing_type ?? '—',
        delivery:
          delivery_status === 'delivered'
            ? `مُسلَّمة${delivery_date ? ` (${delivery_date})` : ''}`
            : delivery_status === 'pending'
            ? 'قيد التسليم'
            : delivery_status ?? '—',
        collection: fmtPct(collection_percentage),
      },
      payload: {
        project_id: '',
        unit_number,
        contract_number,
        contract_type,
        financing_type,
        financing_bank,
        sale_date,
        price_before_tax_sar,
        vat_sar,
        price_with_vat_sar,
        delivery_status,
        delivery_date,
        retention_percentage,
        installment_number,
        total_collected_before_tax_sar,
        total_collected_with_tax_sar,
        remaining_amount_sar,
        collection_percentage,
        price_per_meter_sar,
      },
    }
  }

  return (
    <BaseImporter<Payload>
      title="ملف Excel: عقود ومشترين"
      subtitle="ارفع ملف يحتوي على (رقم الوحدة، رقم العقد، اسم المشتري، الجوال، تاريخ البيع، السعر، التمويل، حالة التسليم، اسم المشروع). يستخرج النظام أيضًا الأعمدة المالية إذا كانت متوفرة، ويربط العقود بالوحدات تلقائيًا بالذكاء الاصطناعي."
      projects={projects}
      lockedProjectId={lockedProjectId}
      relevantFields={CONTRACT_FIELDS as readonly MappingField[]}
      previewColumns={PREVIEW_COLUMNS}
      parseRow={parseRow}
      attachProjectId={(payload, projectId) => ({ ...payload, project_id: projectId })}
      checkExisting={async (pairs) => {
        const res = await checkExistingUnits({ pairs })
        const set = new Set<string>()
        if (res.ok) {
          for (const p of res.existing) set.add(`${p.project_id}::${p.unit_number}`)
        }
        return set
      }}
      onSubmit={async (payloads) => {
        const res = await bulkImportContractsFromRows({ rows: payloads })
        if (!res.ok) return { ok: false, message: res.error }
        return {
          ok: true,
          message: (
            <>
              حُدِّث <span className="font-mono font-bold">{res.updatedSales}</span> عقد نشط
              وأُضيف <span className="font-mono font-bold">{res.insertedSales}</span> سجل بيع
              جديد.
              {res.skippedRows > 0 && (
                <>
                  {' '}تم تجاهل{' '}
                  <span className="font-mono font-bold">{res.skippedRows}</span> صف (لا
                  يحتوي على رقم وحدة).
                </>
              )}
            </>
          ),
          extra:
            res.unmatched.length > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                <div className="font-semibold mb-1">
                  {res.unmatched.length} وحدة لم يتم العثور عليها (تم تجاهلها):
                </div>
                <ul className="list-disc ms-5 space-y-0.5 max-h-40 overflow-y-auto">
                  {res.unmatched.slice(0, 20).map((u, i) => (
                    <li key={i} className="font-mono">
                      {u.unit_number}
                    </li>
                  ))}
                  {res.unmatched.length > 20 && (
                    <li>… (+{res.unmatched.length - 20} أخرى)</li>
                  )}
                </ul>
                <div className="mt-1">
                  أنشئ هذه الوحدات أولًا من «قائمة الوحدات (المواصفات)».
                </div>
              </div>
            ) : undefined,
        }
      }}
    />
  )
}
