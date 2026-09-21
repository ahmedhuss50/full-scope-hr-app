/**
 * Beneficiary-capacity canonical list (صفة المستفيد).
 *
 * The Saudi CPA quarterly report workbook (Sheet 2 column «صفة المستفيد»)
 * expects one of these 8 values. Before this file, the field was free
 * text on dsb_cases.extracted_fields.beneficiary_capacity_ar; existing
 * rows keep whatever was typed. The BeneficiaryCapacityPicker offers the
 * standardized list first and falls back to «أخرى» → free text so we don't
 * break historical data.
 */

export const BENEFICIARY_CAPACITY_OPTIONS: readonly string[] = [
  'مقاول',
  'مورد',
  'ممول',
  'مشتري',
  'مسوق',
  'استشاري هندسي',
  'محاسب قانوني',
  'أخرى',
] as const

/**
 * True when the value is one of the canonical dropdown choices. Used by
 * the picker to decide whether to preselect an item or start in
 * «أخرى» / free-text mode.
 */
export function isCanonicalBeneficiaryCapacity(value: string | null | undefined): boolean {
  if (!value) return false
  return BENEFICIARY_CAPACITY_OPTIONS.includes(value.trim())
}
