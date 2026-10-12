'use client'

import { useState } from 'react'
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
  // Buyer identity — name + phone + ID (with type + nationality inline).
  // The operator's primary "does this row look right?" check is on the
  // buyer name, so lead with it.
  { key: 'buyer_name', label: 'المشتري' },
  { key: 'buyer_id', label: 'الهوية' },
  { key: 'buyer_phone', label: 'الجوال' },
  // Contract terms.
  { key: 'contract_no', label: 'رقم العقد' },
  { key: 'contract_type', label: 'نوع العقد' },
  { key: 'sale_date', label: 'تاريخ البيع' },
  // Pricing — show whichever price the file has (with-VAT preferred, else
  // before-VAT). The preview cell logic below handles the fallback.
  { key: 'price', label: 'السعر' },
  { key: 'financing', label: 'التمويل' },
  { key: 'delivery', label: 'التسليم' },
  // Status chip — shows the auto-detected sale_status so the operator can
  // spot a wrong classification (sheet-name mismatch, fallback kicking in)
  // BEFORE committing the upload.
  { key: 'sale_status_label', label: 'الحالة' },
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
  // Fallback status when the Excel sheet name doesn't match any known
  // REGA buyers-register sheet. Sheet-based auto-detection takes priority
  // (see sheetNameToStatus below) — this toggle only kicks in for custom
  // single-sheet exports.
  const [batchStatus, setBatchStatus] = useState<'active' | 'cancelled'>('active')

  /**
   * Auto-detect sale_status from the Excel sheet name. The REGA buyers
   * register template ships with 4 sheets, each tracking a specific
   * contract state — honoring that automatically lets staff upload the
   * whole workbook in one shot and get status right per sheet.
   */
  function sheetNameToStatus(name: string): 'active' | 'cancelled' | 'cancelled_resold' | 'completed' | null {
    // Normalize: trim + collapse whitespace + strip Arabic tatweel + lowercase
    // tolerance for latin chars (sheet-name labels sometimes carry invisible
    // characters from Excel re-saves). Match by substring so an exact-string
    // regression from a renamed sheet still classifies correctly.
    const n = (name ?? '')
      .replace(/ـ/g, '')        // tatweel
      .replace(/[​-‏]/g, '') // zero-width spaces + bidi marks
      .replace(/\s+/g, ' ')
      .trim()
    // Order matters: 'الملغية والمعاد بيعها' must match BEFORE the plain
    // 'الملغية' substring (otherwise cancelled_resold rows get misread as
    // cancelled).
    if (n.includes('الملغية والمعاد بيعها') || n.includes('ملغية ومعاد بيعها')) return 'cancelled_resold'
    if (n.includes('المعاد بيعها') || n.includes('معاد بيعها')) return 'cancelled_resold'
    if (n.includes('المنجزة') || n.includes('منجزة')) return 'completed'
    if (n.includes('الملغية') || n.includes('ملغية') || n.includes('ملغاة') || n.includes('الملغاة')) return 'cancelled'
    if (n.includes('قائمة') || n.includes('سجل المشترين')) return 'active'
    return null  // unknown sheet → fall back to batchStatus
  }

  /** Human-readable Arabic label for a sale status. Reused in the preview chip. */
  function labelForStatus(s: 'active' | 'cancelled' | 'cancelled_resold' | 'completed' | null): string {
    if (s === 'cancelled') return 'ملغي'
    if (s === 'cancelled_resold') return 'ملغي ومعاد بيعه'
    if (s === 'completed') return 'منجز'
    if (s === 'active') return 'ساري'
    return 'ساري (افتراضي)'
  }

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
    // Buyer identity — read first so a row with a valid buyer but missing
    // unit_number still gets kept for post-import AI linking.
    const buyer_name_ar = toStr(at(columns.buyer_name)) || null
    const buyer_phone = toStr(at(columns.buyer_phone)) || null
    const buyer_id_type = toStr(at(columns.buyer_id_type)) || null
    const buyer_id_number = toStr(at(columns.buyer_id_number)) || null
    const buyer_nationality = toStr(at(columns.buyer_nationality)) || null

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

    // Skip only if the row has NO identifying data at all — no unit, no
    // buyer, no contract number. Post-refactor a row with buyer + contract
    // number but no unit_number is still valuable (the AI linker will
    // attach it to a unit later).
    if (!unit_number && !buyer_name_ar && !contract_number) return null

    // Price display: fall back to before-VAT when the file only carries that
    // (common — many سجل المشترين exports don't include a with-VAT column).
    const displayPrice = price_with_vat_sar ?? price_before_tax_sar

    return {
      sheetName,
      rowNumber,
      projectRaw,
      unit_number: unit_number || '',
      previewCells: {
        // Buyer identity — top line = name, sub line = nationality (if any).
        buyer_name:
          buyer_name_ar
            ? (buyer_nationality ? `${buyer_name_ar} · ${buyer_nationality}` : buyer_name_ar)
            : '—',
        // ID cell packs id_type + id_number so the operator can spot a
        // "أحوال وطنية 1234…" mismatch in one glance.
        buyer_id:
          buyer_id_number
            ? (buyer_id_type ? `${buyer_id_type}: ${buyer_id_number}` : buyer_id_number)
            : '—',
        buyer_phone: buyer_phone ?? '—',
        contract_no: contract_number ?? '—',
        contract_type: contract_type ?? '—',
        sale_date: sale_date ?? '—',
        price: fmtPrice(displayPrice),
        // Financing cell: bank name is the readable part, type ("تمويل" /
        // "نقدي") tucked in parens when both present.
        financing:
          financing_bank && financing_type
            ? `${financing_bank} (${financing_type})`
            : financing_bank ?? financing_type ?? '—',
        delivery:
          delivery_status === 'delivered'
            ? `مُسلَّمة${delivery_date ? ` (${delivery_date})` : ''}`
            : delivery_status === 'pending'
            ? 'قيد التسليم'
            : delivery_status ?? '—',
        // Status chip — reflects the auto-detected sale_status for this row.
        // Prefixed with ⚠ when we fell back to the batch toggle (unknown
        // sheet) so the operator notices and can adjust before saving.
        sale_status_label: (() => {
          const detected = sheetNameToStatus(sheetName)
          const effective = detected ?? batchStatus
          const prefix = detected ? '' : '⚠ '
          return `${prefix}${labelForStatus(effective)}`
        })(),
      },
      payload: {
        project_id: '',
        unit_number,
        // Buyer fields go through to the server action (which now accepts
        // them per the earlier refactor).
        buyer_name_ar,
        buyer_phone,
        buyer_id_type,
        buyer_id_number,
        buyer_nationality,
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
        // Auto-detect from sheet name (REGA template convention). If the
        // sheet isn't a recognized REGA sheet, attachProjectId below will
        // stamp the batchStatus fallback.
        sale_status: sheetNameToStatus(sheetName),
      },
    }
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Batch status toggle — applies to every row in the file. The default
          'ساري' preserves the old behaviour; switch to 'ملغي' when importing
          a batch of historical cancelled contracts. */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
        <div className="text-sm font-bold text-slate-800">حالة العقود (للصفحات غير المعروفة)</div>
        <div className="text-[11px] text-slate-600 leading-relaxed">
          إذا كان الملف من قالب REGA (أسماء الصفحات: «سجل المشترين وحدات
          قائمة» / «الوحدات الملغية» / «الوحدات الملغية والمعاد بيعها» /
          «الوحدات المنجزة»)، النظام يحدد الحالة تلقائياً من اسم الصفحة
          لكل صف. هذا الخيار يُستخدم فقط للصفحات بأسماء غير معروفة.
        </div>
        <div className="flex gap-4 flex-wrap">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="radio" name="batchStatus" checked={batchStatus === 'active'}
              onChange={() => setBatchStatus('active')}
              className="h-4 w-4 text-teal-600 focus:ring-teal-500" />
            <span className="text-sm font-semibold text-slate-800">ساري (افتراضي)</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="radio" name="batchStatus" checked={batchStatus === 'cancelled'}
              onChange={() => setBatchStatus('cancelled')}
              className="h-4 w-4 text-rose-600 focus:ring-rose-500" />
            <span className="text-sm font-semibold text-slate-800">ملغي</span>
          </label>
        </div>
      </div>

      <BaseImporter<Payload>
      title="ملف Excel: عقود ومشترين"
      subtitle="ارفع ملف يحتوي على (رقم الوحدة، رقم العقد، اسم المشتري، الجوال، تاريخ البيع، السعر، التمويل، حالة التسليم، اسم المشروع). يستخرج النظام أيضًا الأعمدة المالية إذا كانت متوفرة، ويربط العقود بالوحدات تلقائيًا بالذكاء الاصطناعي."
      projects={projects}
      lockedProjectId={lockedProjectId}
      relevantFields={CONTRACT_FIELDS as readonly MappingField[]}
      previewColumns={PREVIEW_COLUMNS}
      parseRow={parseRow}
      attachProjectId={(payload, projectId) => ({
        ...payload,
        project_id: projectId,
        // Keep auto-detected sheet status if present; else fall back to the
        // batch toggle. Lets the user upload multi-sheet REGA workbooks
        // (sheet dictates status) OR a single-sheet file (toggle dictates).
        sale_status: payload.sale_status ?? batchStatus,
      })}
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
              وأُضيف <span className="font-mono font-bold">{res.insertedSales}</span> سجل جديد.
              {res.insertedUnlinked > 0 && (
                <>
                  {' '}منها <span className="font-mono font-bold">{res.insertedUnlinked}</span>{' '}
                  بلا وحدة مطابقة.
                </>
              )}
              {res.linkedByAI > 0 && (
                <>
                  {' '}الذكاء الاصطناعي ربط <span className="font-mono font-bold">{res.linkedByAI}</span>{' '}
                  منها تلقائيًا بالوحدات.
                </>
              )}
              {res.skippedRows > 0 && (
                <>
                  {' '}تم تجاهل{' '}
                  <span className="font-mono font-bold">{res.skippedRows}</span> صف فارغ.
                </>
              )}
            </>
          ),
          extra:
            res.unmatched.length > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                <div className="font-semibold mb-1">
                  {res.unmatched.length} صف بلا وحدة مطابقة (أُدرج بدون ربط، جاهز للربط اليدوي أو AI لاحقًا):
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
                  استخدم زر «ربط تلقائي بالوحدات» على صفحة «عقود المشترين» لإعادة المحاولة.
                </div>
              </div>
            ) : undefined,
        }
      }}
    />
    </div>
  )
}
