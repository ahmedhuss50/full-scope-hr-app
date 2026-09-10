/**
 * Category label resolver — merges the code-shipped defaults with the
 * per-tenant overrides stored in tenants.deposit_category_labels and
 * tenants.disbursement_type_labels (migration 070).
 *
 * Consumers should call `resolveLabels(overrides)` once per request with
 * the tenant's overrides object, then look up labels by code.
 */

// -----------------------------------------------------------------------
// Default (code-shipped) labels. Kept in sync with:
//   - DepositCategoryPicker.OPTIONS
//   - /admin/settings/lists/page.tsx DEPOSIT_CATEGORIES / DISBURSEMENT_TYPES
//   - lib/dsb/generate-rega-xlsx.ts mapDisbursementTypeToAr
// -----------------------------------------------------------------------

export const DEPOSIT_CATEGORY_DEFAULTS: Record<string, string> = {
  buyer_collection:  'تحصيل مشتري',
  wrong_transfer:    'حوالة خاطئة',
  self_financing:    'تمويل ذاتي',
  bank_financing:    'تمويل بنكي',
  other:             'أخرى',
  auto_distribution: 'توزيع تلقائي', // legacy — only appears on old split rows
}

export const DISBURSEMENT_TYPE_DEFAULTS: Record<string, string> = {
  construction:           'إنشائي (مقاول رئيسي، بنية تحتية، مواد)',
  admin_marketing:        'إداري / تسويقي (رواتب، عمولات، أتعاب)',
  bank_financing:         'تمويل بنكي',
  moh_incentive:          'حوافز وزارة الإسكان',
  unit_seriousness_fees:  'رسوم جدية شراء وحدة',
  vat_project_registry:   'ضريبة قيمة مضافة — تسجيل مشروع',
  vat_sales_payment:      'ضريبة قيمة مضافة — دفعة بيع',
  other:                  'أخرى',
}

// -----------------------------------------------------------------------
// Resolver — call once with the tenant overrides then reuse.
// -----------------------------------------------------------------------

export type LabelOverrides = Record<string, string> | null | undefined

export function resolveDepositLabel(
  code: string,
  overrides: LabelOverrides,
): string {
  return overrides?.[code] ?? DEPOSIT_CATEGORY_DEFAULTS[code] ?? code
}

export function resolveDisbursementLabel(
  code: string,
  overrides: LabelOverrides,
): string {
  return overrides?.[code] ?? DISBURSEMENT_TYPE_DEFAULTS[code] ?? code
}
