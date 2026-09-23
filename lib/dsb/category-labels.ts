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

// -----------------------------------------------------------------------
// Main disbursement types (migration 088) — the outer layer that appears
// on Sheet 2 «البند» + Sheet 3 debit rows of the CPA report. Each sub-type
// above is assigned to one of these.
// -----------------------------------------------------------------------

export const DISBURSEMENT_MAIN_TYPE_DEFAULTS: Record<string, string> = {
  main_construction:    'تكاليف انشائية',
  main_admin_marketing: 'مصاريف ادارية وتسويقية',
  main_customer_refund: 'ايداعات عملاء مستردة',
  main_bank_fees:       'عمولات بنكية',
  main_other:           'أخرى',
}

/**
 * Default sub → main assignment. Consumers should prefer the tenant's
 * `disbursement_type_main` JSONB, then fall back to this table, then
 * finally to `main_other` if the sub-code isn't recognised at all.
 */
export const DISBURSEMENT_TYPE_MAIN_DEFAULTS: Record<string, string> = {
  construction:          'main_construction',
  admin_marketing:       'main_admin_marketing',
  bank_financing:        'main_other',
  moh_incentive:         'main_other',
  unit_seriousness_fees: 'main_other',
  vat_project_registry:  'main_other',
  vat_sales_payment:     'main_other',
  customer_refund:       'main_customer_refund',
  bank_fees:             'main_bank_fees',
  other:                 'main_other',
}

export function resolveMainDisbursementLabel(
  code: string,
  overrides: LabelOverrides,
): string {
  return overrides?.[code] ?? DISBURSEMENT_MAIN_TYPE_DEFAULTS[code] ?? code
}

/**
 * Resolve a sub-type code → its main-type code, using the tenant's
 * assignment map first, then the shipped default, then `main_other`.
 */
export function resolveMainForSub(
  subCode: string,
  assignments: Record<string, string> | null | undefined,
): string {
  const code = (subCode ?? '').trim()
  if (!code) return 'main_other'
  return assignments?.[code] ?? DISBURSEMENT_TYPE_MAIN_DEFAULTS[code] ?? 'main_other'
}
