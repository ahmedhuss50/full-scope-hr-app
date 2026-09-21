/**
 * Unit-type canonical list (نوع الوحدة).
 *
 * The Saudi CPA quarterly report workbook (Sheet 4 «وحدات المشروع»)
 * expects one of these 14 values. Field remains free text in DB
 * (dsb_project_units.unit_type) to preserve historical rows; the picker
 * offers the standardized list first and falls back to «أخرى» → free
 * text so nothing gets erased.
 */

export const UNIT_TYPE_OPTIONS: readonly string[] = [
  'شقق',
  'فلل',
  'دوبلكس',
  'أراضي سكنية',
  'أراضي تجارية',
  'أراضي صناعية',
  'أراضي زراعية',
  'أراضي سياحية',
  'أدوار',
  'مكاتب تجارية',
  'تاون هاوس',
  'غرف فندقية',
  'أجنحة فندقية',
  'بنت هاوس',
  'أخرى',
] as const

export function isCanonicalUnitType(value: string | null | undefined): boolean {
  if (!value) return false
  return UNIT_TYPE_OPTIONS.includes(value.trim())
}
