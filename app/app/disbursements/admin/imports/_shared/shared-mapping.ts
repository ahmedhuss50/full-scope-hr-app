// Shared utilities + types for all four importers (units, buyers, contracts,
// master). Extracted from the original UnitsImporter so each focused importer
// can call the same AI mapping endpoint, use the same coercion helpers, and
// render the same MappingSummary / ManualMappingPanel components.
//
// This file is import-safe from both server and client — pure code, no
// react/next imports.

// -----------------------------------------------------------------------------
// AI mapping — mirrors the /api/dsb-units-map-columns response schema.
// -----------------------------------------------------------------------------

export const MAPPING_FIELDS = [
  'unit_number',
  'block_number',
  'zone_number',
  'unit_type',
  'area_m2',
  'district',
  'city',
  'region',
  'project_name',
  'buyer_name',
  'buyer_id_type',
  'buyer_id_number',
  'buyer_nationality',
  'buyer_phone',
  'contract_number',
  'contract_type',
  'financing_type',
  'financing_bank',
  'sale_date',
  'price_before_tax_sar',
  'vat_sar',
  'price_with_vat_sar',
  'delivery_status',
  'delivery_date',
  'sale_count',
  // Financial tracking — captured by migration 055 from master-list Excels.
  'retention_percentage',
  'installment_number',
  'total_collected_before_tax_sar',
  'total_collected_with_tax_sar',
  'remaining_amount_sar',
  'collection_percentage',
  'price_per_meter_sar',
  // Historical-case + payments-ledger targets (migration 056).
  'case_number',
  'voucher_number_text',
  'voucher_date',
  'case_amount_sar',
  'disbursement_type_ar',
  'beneficiary_name',
  'payment_date',
  'payment_amount',
  'payment_reference',
  'payment_method',
  'payment_description',
  'account_number',
  'account_label',
] as const

export type MappingField = (typeof MAPPING_FIELDS)[number]

export interface ColumnMap {
  header_row_index: number
  columns: Record<MappingField, number | null>
  notes_ar: string
}

// Arabic labels shown in mapping strip + manual mapping UI.
export const FIELD_LABELS_AR: Record<MappingField, string> = {
  unit_number: 'رقم الوحدة',
  block_number: 'رقم البلوك',
  zone_number: 'رقم المنطقة (ZONE)',
  unit_type: 'نوع الوحدة',
  area_m2: 'المساحة',
  district: 'الحي',
  city: 'المدينة',
  region: 'المنطقة',
  project_name: 'اسم المشروع',
  buyer_name: 'اسم العميل',
  buyer_id_type: 'نوع الهوية',
  buyer_id_number: 'رقم الهوية',
  buyer_nationality: 'الجنسية',
  buyer_phone: 'رقم الجوال',
  contract_number: 'رقم العقد',
  contract_type: 'نوع العقد',
  financing_type: 'نوع التمويل',
  financing_bank: 'الجهة التمويلية',
  sale_date: 'تاريخ البيع',
  price_before_tax_sar: 'السعر قبل الضريبة',
  vat_sar: 'ضريبة القيمة المضافة',
  price_with_vat_sar: 'السعر شامل الضريبة',
  delivery_status: 'حالة التسليم',
  delivery_date: 'تاريخ التسليم',
  sale_count: 'عدد مرات البيع',
  retention_percentage: 'النسبة المستقطعة',
  installment_number: 'رقم الدفعة',
  total_collected_before_tax_sar: 'إجمالي المحصل قبل الضريبة',
  total_collected_with_tax_sar: 'إجمالي المحصل شامل الضريبة',
  remaining_amount_sar: 'المبلغ المتبقي من قيمة الوحدة',
  collection_percentage: 'نسبة التحصيل',
  price_per_meter_sar: 'سعر المتر',
  case_number: 'رقم الطلب / رقم السند',
  voucher_number_text: 'رقم السند',
  voucher_date: 'تاريخ السند',
  case_amount_sar: 'مبلغ السند',
  disbursement_type_ar: 'نوع الصرف',
  beneficiary_name: 'اسم المستفيد',
  payment_date: 'تاريخ الدفع',
  payment_amount: 'مبلغ الدفع',
  payment_reference: 'رقم المرجع',
  payment_method: 'طريقة الدفع',
  payment_description: 'بيان الدفع',
  account_number: 'رقم الحساب',
  account_label: 'اسم الحساب',
}

// Subsets used by the three focused importers. Kept as a `readonly` array so
// TypeScript narrows them tightly when consumed in .filter/.map.

export const UNIT_SPEC_FIELDS: readonly MappingField[] = [
  'unit_number',
  'project_name',
  'block_number',
  'zone_number',
  'unit_type',
  'area_m2',
  'district',
  'city',
  'region',
]

export const BUYER_FIELDS: readonly MappingField[] = [
  'unit_number',
  'project_name',
  'buyer_name',
  'buyer_id_type',
  'buyer_id_number',
  'buyer_nationality',
  'buyer_phone',
  'sale_count',
]

export const CONTRACT_FIELDS: readonly MappingField[] = [
  'unit_number',
  'project_name',
  'contract_number',
  'contract_type',
  'financing_type',
  'financing_bank',
  'sale_date',
  'price_before_tax_sar',
  'vat_sar',
  'price_with_vat_sar',
  'delivery_status',
  'delivery_date',
  // Financial tracking — natural fit for the contract/sale record.
  'retention_percentage',
  'installment_number',
  'total_collected_before_tax_sar',
  'total_collected_with_tax_sar',
  'remaining_amount_sar',
  'collection_percentage',
  'price_per_meter_sar',
]

// Historical cases: past voucher/disbursement records loaded into dsb_cases
// as delivered/archived. Includes case identifier + voucher info + amount +
// disbursement type + beneficiary + delivery timing.
export const HISTORICAL_CASE_FIELDS: readonly MappingField[] = [
  'project_name',
  'unit_number',
  'case_number',
  'voucher_number_text',
  'voucher_date',
  'case_amount_sar',
  'disbursement_type_ar',
  'beneficiary_name',
  'sale_date',
  'delivery_date',
]

// Payments ledger: standalone financial transactions. Every FK is optional
// so the importer should feel free to ship ledger rows without a linked
// project / case / unit — the server lookup fills what it can.
export const PAYMENT_FIELDS: readonly MappingField[] = [
  'project_name',
  'unit_number',
  'case_number',
  'account_number',
  'account_label',
  'payment_date',
  'payment_amount',
  'vat_sar',
  'beneficiary_name',
  'payment_description',
  'payment_reference',
  'payment_method',
]

// -----------------------------------------------------------------------------
// Sheet source (used by master importer only; kept here so shared components
// can be shared between master + focused variants without a circular import).
// -----------------------------------------------------------------------------

export type SheetSource = 'active' | 'cancelled_resold' | 'cancelled' | 'completed'

export interface SheetPack {
  name: string
  key: SheetSource
  aoa: unknown[][]
  mapping: ColumnMap | null
  aiError: string | null
  aiCostUsd: number | null
  aiModel: string | null
}

// -----------------------------------------------------------------------------
// Arabic normalization + cell coercion helpers
// -----------------------------------------------------------------------------

export function normAr(s: string): string {
  return s
    .replace(/ـ/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/[يى]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function toStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

export function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = String(v).replace(/[,\s]/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Like `toNumOrNull` but also strips a trailing '%' — the master-list
 * financial columns (retention_percentage, collection_percentage) ship as
 * either "0.35", "35", or "35%" depending on the source workbook. We store
 * the raw number and let the display layer decide how to render.
 */
export function toPercentOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = String(v).replace(/[,\s%]/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Excel installment "number" is usually a small positive integer. Accept
 * numeric cells directly, coerce strings via `parseInt` (base 10), and
 * reject non-integer/non-finite input.
 */
export function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  const n = Number.parseInt(String(v).replace(/[,\s]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Convert whatever the cell holds into a YYYY-MM-DD string, or null. Handles
 * JS Dates (SheetJS { cellDates:true }), Excel serials, ISO strings,
 * dd/mm/yyyy variants, and rejects free-text placeholders.
 */
export function toIsoDateOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Use LOCAL-time parts, NOT toISOString(). SheetJS with cellDates:true
    // constructs the Date at the user's local midnight to represent the
    // Excel cell date. In a UTC+3 (Riyadh) browser that Date is 21:00 UTC
    // of the previous day, so toISOString().slice(0,10) shifts the whole
    // column back by one day. Reading local parts keeps the intended date.
    return isoFromLocalParts(v)
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const epoch = Date.UTC(1899, 11, 30)
    const ms = epoch + v * 86_400_000
    const d = new Date(ms)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return null
  }
  const s = String(v).trim()
  if (!s) return null
  if (/[؀-ۿ]/.test(s) && !/\d{4}-\d{2}-\d{2}/.test(s)) return null
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (iso) {
    const y = iso[1]
    let a = Number.parseInt(iso[2], 10) // 2nd segment (usually month)
    let b = Number.parseInt(iso[3], 10) // 3rd segment (usually day)
    // Some Excel exports write YYYY-DD-MM (typed manually or exported from
    // a locale that puts day first). Detect and correct: if the middle
    // segment can't be a valid month but the last one can, swap them.
    // Prevents "date/time field value out of range: 2024-29-09" from
    // Postgres and yields the intended 2024-09-29.
    if (a > 12 && b >= 1 && b <= 12) {
      const t = a
      a = b
      b = t
    }
    if (a < 1 || a > 12 || b < 1 || b > 31) return null
    return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`
  }
  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(s)
  if (dmy) {
    const dd = dmy[1].padStart(2, '0')
    const mm = dmy[2].padStart(2, '0')
    return `${dmy[3]}-${mm}-${dd}`
  }
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return isoFromLocalParts(d)
  return null
}

/** YYYY-MM-DD from a Date's LOCAL parts — never shifts across TZ. */
function isoFromLocalParts(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function toUnitType(v: unknown): 'villa' | 'apartment' | 'other' | null {
  const s = toStr(v)
  if (!s) return null
  const n = normAr(s)
  if (n.includes('فيلا') || n.includes('فله')) return 'villa'
  if (n.includes('شقه') || n.includes('شقة') || n.includes('شقق')) return 'apartment'
  return 'other'
}

export function toIdType(v: unknown): 'national' | 'residency' | 'passport' | null {
  const s = toStr(v)
  if (!s) return null
  const n = normAr(s)
  if (n.includes('هويه') || n.includes('وطني') || n.includes('national')) return 'national'
  if (n.includes('اقامه') || n.includes('اقاما') || n.includes('residen') || n.includes('iqama'))
    return 'residency'
  if (n.includes('جواز') || n.includes('passport')) return 'passport'
  return null
}

export function toDeliveryStatus(v: unknown): 'delivered' | 'pending' | 'other' | null {
  const s = toStr(v)
  if (!s) return null
  const n = normAr(s)
  if (n.includes('تم') || n.includes('سلم') || n.includes('deliver')) return 'delivered'
  if (n.includes('لم') || n.includes('قيد') || n.includes('انتظار') || n.includes('pend'))
    return 'pending'
  return 'other'
}

export function sheetKeyFromName(sheetName: string): SheetSource {
  const n = normAr(sheetName)
  if (
    (n.includes('ملغ') || n.includes('لغيه') || n.includes('لغيت')) &&
    (n.includes('معاد') || n.includes('بيعها') || n.includes('اعاد'))
  ) {
    return 'cancelled_resold'
  }
  if (n.includes('ملغ') || n.includes('لغيه') || n.includes('لغيت')) {
    return 'cancelled'
  }
  if (n.includes('منجز') || n.includes('مسلم') || n.includes('مسلمه')) {
    return 'completed'
  }
  return 'active'
}

export function colIndexToLetter(i: number): string {
  let n = i
  let s = ''
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

// -----------------------------------------------------------------------------
// Project lookup shape
// -----------------------------------------------------------------------------

export type ProjectLite = { id: string; name_ar: string; developer_id: string | null }
