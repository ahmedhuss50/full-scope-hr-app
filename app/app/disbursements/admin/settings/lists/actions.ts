'use server'

/**
 * Owner-only server actions for القوائم والنسب.
 *
 * Currently exposes:
 *  - Buyer-deposit distribution shares (construction / admin_marketing / escrow)
 *  - Vendor / service-provider categories (add / rename / delete)
 *
 * The lists of deposit categories and disbursement types are enum-shaped
 * values hard-coded in the application layer — surfaced read-only on the
 * page, not editable here (changing them touches the AI prompt, importer
 * mapping, and downstream tabs; treat as a code change).
 */
import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export interface DistributionShares {
  construction:    number
  admin_marketing: number
  escrow:          number
}

// Owner-guard helper — every action here calls this first.
async function resolveOwner(): Promise<
  | { tenantId: string; userId: string }
  | { error: string }
> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: 'لم يتم تسجيل الدخول.' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) return { error: 'حسابك غير مرتبط بمستأجر.' }
  if ((profile.dsb_role as string | null) !== 'owner') {
    return { error: 'هذا الإجراء متاح للمدير فقط.' }
  }
  return { tenantId: profile.tenant_id as string, userId: profile.id as string }
}

export async function updateDistributionShares(
  input: DistributionShares,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, error: 'لم يتم تسجيل الدخول.' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) return { ok: false, error: 'حسابك غير مرتبط بمستأجر.' }
  if ((profile.dsb_role as string | null) !== 'owner') {
    return { ok: false, error: 'هذا الإجراء متاح للمدير فقط.' }
  }

  // Validate all three shares are finite non-negative numbers that sum to
  // roughly 1.0. Allow a small tolerance for float rounding.
  for (const k of ['construction', 'admin_marketing', 'escrow'] as const) {
    const v = input[k]
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      return { ok: false, error: 'قيمة الحصة يجب أن تكون بين 0 و 1.' }
    }
  }
  const sum = input.construction + input.admin_marketing + input.escrow
  if (Math.abs(sum - 1.0) > 0.005) {
    return { ok: false, error: `مجموع الحصص يجب أن يكون 100٪ بالضبط (المجموع الحالي: ${(sum * 100).toFixed(2)}٪).` }
  }

  const tenantId = profile.tenant_id as string
  const { error } = await svc
    .from('tenants')
    .update({
      deposit_distribution_shares: {
        construction:    input.construction,
        admin_marketing: input.admin_marketing,
        escrow:          input.escrow,
      },
    })
    .eq('id', tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/settings/lists')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Label overrides for the fixed enum lists (migration 070).
// Owner renames what appears on screen; underlying enum codes stay fixed.
// ---------------------------------------------------------------------------

export type LabelKind = 'deposit' | 'disbursement'

export async function updateLabelOverrides(
  input: { kind: LabelKind; labels: Record<string, string> },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }

  // Normalize: trim, strip empty overrides (fall back to defaults), reject
  // pathologically long values so a mis-paste doesn't fill the DB.
  const cleaned: Record<string, string> = {}
  for (const [code, label] of Object.entries(input.labels ?? {})) {
    const c = String(code).trim()
    const l = String(label ?? '').trim()
    if (!c || !l) continue
    if (l.length > 120) return { ok: false, error: 'أحد الأسماء طويل جدًا (بحد أقصى 120 حرفًا).' }
    cleaned[c] = l
  }

  const column =
    input.kind === 'deposit'      ? 'deposit_category_labels' :
    input.kind === 'disbursement' ? 'disbursement_type_labels' :
    null
  if (!column) return { ok: false, error: 'قائمة غير معروفة.' }

  const svc = createSupabaseService()
  const { error } = await svc
    .from('tenants')
    .update({ [column]: cleaned })
    .eq('id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/settings/lists')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Add / delete CUSTOM deposit categories + disbursement types (migration 075).
//
// The shipped enum codes (buyer_collection, construction, etc.) can be
// renamed via updateLabelOverrides above but NEVER deleted. Custom entries
// are stored in the same JSONB with a `custom_<slug>` code so they're easy
// to distinguish and the DB constraint recognizes them.
// ---------------------------------------------------------------------------

// Keep in sync with lib/dsb/category-labels.ts DEFAULTS.
const DEPOSIT_DEFAULT_CODES = new Set([
  'buyer_collection', 'wrong_transfer', 'self_financing', 'bank_financing', 'other', 'auto_distribution',
])
const DISBURSEMENT_DEFAULT_CODES = new Set([
  'construction', 'admin_marketing', 'bank_financing', 'moh_incentive',
  'unit_seriousness_fees', 'vat_project_registry', 'vat_sales_payment', 'other',
])

/** Slugify Arabic/English label into a short lowercase `custom_<slug>` code. */
function toCustomCode(label: string, existing: Set<string>): string {
  const base = label
    .trim()
    .toLowerCase()
    // Keep ascii alphanumerics; drop everything else (Arabic, spaces, etc.).
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30)
  // If the label had no ascii chars at all (pure Arabic), fall back to a
  // short random suffix so we still produce a valid code.
  const seed = base || Math.random().toString(36).slice(2, 8)
  let code = `custom_${seed}`
  let i = 2
  while (existing.has(code)) {
    code = `custom_${seed}_${i}`
    i += 1
  }
  return code
}

/**
 * renameLabel — patch a single entry in the labels JSONB.
 *
 * Works for both fixed enum codes (creates/updates an override) and custom
 * codes (updates the label on the custom entry). Passing an empty label on
 * a FIXED code removes the override (row reverts to default); on a CUSTOM
 * code it's rejected (use deleteCustomLabel instead).
 */
export async function renameLabel(
  input: { kind: LabelKind; code: string; label_ar: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }

  const code  = (input.code ?? '').trim()
  const label = (input.label_ar ?? '').trim()
  if (!code) return { ok: false, error: 'الرمز مطلوب.' }
  if (label.length > 120) return { ok: false, error: 'الاسم طويل جدًا.' }

  const isCustom = code.startsWith('custom_')
  if (isCustom && !label) {
    return { ok: false, error: 'لا يمكن مسح اسم تصنيف مضاف. استخدم زر الحذف.' }
  }

  const column =
    input.kind === 'deposit'      ? 'deposit_category_labels' :
    input.kind === 'disbursement' ? 'disbursement_type_labels' :
    null
  if (!column) return { ok: false, error: 'قائمة غير معروفة.' }
  const defaults =
    input.kind === 'deposit' ? DEPOSIT_DEFAULT_CODES : DISBURSEMENT_DEFAULT_CODES
  if (!isCustom && !defaults.has(code)) {
    return { ok: false, error: 'رمز غير معروف.' }
  }

  const svc = createSupabaseService()
  const { data: t } = await svc
    .from('tenants')
    .select(column)
    .eq('id', guard.tenantId)
    .maybeSingle()
  const current = ((t as Record<string, Record<string, string> | null> | null)?.[column] ?? {}) as Record<string, string>

  // Duplicate-name guard — comparing against every OTHER entry (including
  // shipped defaults for the other codes when the label differs from theirs).
  if (label) {
    for (const [k, v] of Object.entries(current)) {
      if (k === code) continue
      if (v.trim().toLowerCase() === label.toLowerCase()) {
        return { ok: false, error: 'هذا الاسم مستخدَم من تصنيف آخر.' }
      }
    }
  }

  const next: Record<string, string> = { ...current }
  if (!label) {
    delete next[code] // fixed code: revert to shipped default
  } else {
    next[code] = label
  }

  const { error } = await svc
    .from('tenants')
    .update({ [column]: next })
    .eq('id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/settings/lists')
  return { ok: true }
}

export async function createCustomLabel(
  input: { kind: LabelKind; label_ar: string },
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }

  const label = (input.label_ar ?? '').trim()
  if (!label) return { ok: false, error: 'الاسم مطلوب.' }
  if (label.length > 120) return { ok: false, error: 'الاسم طويل جدًا (بحد أقصى 120 حرفًا).' }

  const column =
    input.kind === 'deposit'      ? 'deposit_category_labels' :
    input.kind === 'disbursement' ? 'disbursement_type_labels' :
    null
  if (!column) return { ok: false, error: 'قائمة غير معروفة.' }
  const defaults =
    input.kind === 'deposit' ? DEPOSIT_DEFAULT_CODES : DISBURSEMENT_DEFAULT_CODES

  const svc = createSupabaseService()
  const { data: t } = await svc
    .from('tenants')
    .select(column)
    .eq('id', guard.tenantId)
    .maybeSingle()
  const current = ((t as Record<string, Record<string, string> | null> | null)?.[column] ?? {}) as Record<string, string>
  // Reject a duplicate label — case/whitespace-insensitive — regardless of code.
  const dup = Object.values(current).some((l) => l.trim().toLowerCase() === label.toLowerCase())
  if (dup) return { ok: false, error: 'هذا الاسم موجود بالفعل.' }

  const taken = new Set([...defaults, ...Object.keys(current)])
  const code = toCustomCode(label, taken)
  const next = { ...current, [code]: label }

  const { error } = await svc
    .from('tenants')
    .update({ [column]: next })
    .eq('id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/settings/lists')
  return { ok: true, code }
}

/**
 * Count how many rows in the source table currently use this code.
 * Used to block deletion of a category that still has data attached.
 */
async function countUsage(
  svc: ReturnType<typeof createSupabaseService>,
  tenantId: string,
  kind: LabelKind,
  code: string,
): Promise<number> {
  if (kind === 'deposit') {
    const { count } = await svc
      .from('dsb_payments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('deposit_category', code)
    return count ?? 0
  }
  // Disbursement type lives inside dsb_cases.extracted_fields JSONB.
  const { count } = await svc
    .from('dsb_cases')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .filter('extracted_fields->>disbursement_type_code', 'eq', code)
  return count ?? 0
}

export async function deleteCustomLabel(
  input: { kind: LabelKind; code: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }

  const code = (input.code ?? '').trim()
  if (!code) return { ok: false, error: 'الرمز مطلوب.' }

  const column =
    input.kind === 'deposit'      ? 'deposit_category_labels' :
    input.kind === 'disbursement' ? 'disbursement_type_labels' :
    null
  if (!column) return { ok: false, error: 'قائمة غير معروفة.' }

  const svc = createSupabaseService()
  const usage = await countUsage(svc, guard.tenantId, input.kind, code)
  if (usage > 0) {
    const noun = input.kind === 'deposit' ? 'دفعة' : 'سند صرف'
    return { ok: false, error: `لا يمكن الحذف — التصنيف مستخدم في ${usage} ${noun}.` }
  }

  // Custom code → drop from the labels JSONB (the source of its existence).
  if (code.startsWith('custom_')) {
    const { data: t } = await svc
      .from('tenants')
      .select(column)
      .eq('id', guard.tenantId)
      .maybeSingle()
    const current = ((t as Record<string, Record<string, string> | null> | null)?.[column] ?? {}) as Record<string, string>
    if (!(code in current)) return { ok: true }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [code]: _dropped, ...rest } = current

    const { error } = await svc
      .from('tenants')
      .update({ [column]: rest })
      .eq('id', guard.tenantId)
    if (error) return { ok: false, error: error.message }
  } else {
    // Built-in code → we can't truly remove it (baked into DB CHECK + app),
    // so we add it to the hidden-codes array. Consumers filter it out at
    // read time. Restore path lives in restoreDefaultLabel below.
    const hiddenColumn =
      input.kind === 'deposit'      ? 'deposit_category_hidden' :
      input.kind === 'disbursement' ? 'disbursement_type_hidden' :
      null
    if (!hiddenColumn) return { ok: false, error: 'قائمة غير معروفة.' }

    const { data: t } = await svc
      .from('tenants')
      .select(hiddenColumn)
      .eq('id', guard.tenantId)
      .maybeSingle()
    const current = ((t as Record<string, string[] | null> | null)?.[hiddenColumn] ?? []) as string[]
    if (current.includes(code)) return { ok: true }
    const next = [...current, code]
    const { error } = await svc
      .from('tenants')
      .update({ [hiddenColumn]: next })
      .eq('id', guard.tenantId)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/app/disbursements/admin/settings/lists')
  return { ok: true }
}

/**
 * Un-hide a previously-deleted built-in code (drops it from the hidden array).
 */
export async function restoreDefaultLabel(
  input: { kind: LabelKind; code: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }
  const code = (input.code ?? '').trim()
  if (!code) return { ok: false, error: 'الرمز مطلوب.' }
  const hiddenColumn =
    input.kind === 'deposit'      ? 'deposit_category_hidden' :
    input.kind === 'disbursement' ? 'disbursement_type_hidden' :
    null
  if (!hiddenColumn) return { ok: false, error: 'قائمة غير معروفة.' }

  const svc = createSupabaseService()
  const { data: t } = await svc
    .from('tenants')
    .select(hiddenColumn)
    .eq('id', guard.tenantId)
    .maybeSingle()
  const current = ((t as Record<string, string[] | null> | null)?.[hiddenColumn] ?? []) as string[]
  const next = current.filter((c) => c !== code)

  const { error } = await svc
    .from('tenants')
    .update({ [hiddenColumn]: next })
    .eq('id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/settings/lists')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Main disbursement types (migration 088) — the outer layer that populates
// Sheet 2 «البند» + Sheet 3 debit rows of the CPA report. Owner CRUD.
// ---------------------------------------------------------------------------

const MAIN_TYPE_DEFAULT_CODES = [
  'main_construction',
  'main_admin_marketing',
  'main_customer_refund',
  'main_bank_fees',
  'main_other',
] as const

/**
 * Add a new custom main disbursement type. Custom codes get a `custom_main_`
 * prefix + 6-char random slug so they don't collide with the shipped defaults.
 */
export async function addMainDisbursementType(
  input: { label_ar: string },
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }
  const label = (input.label_ar ?? '').trim()
  if (!label) return { ok: false, error: 'اسم النوع الرئيسي مطلوب.' }
  if (label.length > 80) return { ok: false, error: 'الاسم طويل جدًا (بحد أقصى 80 حرفًا).' }

  const svc = createSupabaseService()
  const { data: t } = await svc
    .from('tenants')
    .select('disbursement_main_types')
    .eq('id', guard.tenantId)
    .maybeSingle()
  const current = ((t as { disbursement_main_types: Record<string, string> | null } | null)?.disbursement_main_types ?? {}) as Record<string, string>

  // Reject duplicate labels (case-insensitive, trimmed).
  const norm = label.replace(/\s+/g, ' ').toLowerCase()
  for (const [, v] of Object.entries(current)) {
    if (String(v).replace(/\s+/g, ' ').toLowerCase() === norm) {
      return { ok: false, error: 'يوجد نوع رئيسي بنفس الاسم.' }
    }
  }

  // Generate a stable custom code.
  const slug = Math.random().toString(36).slice(2, 8)
  const code = `custom_main_${slug}`
  const next = { ...current, [code]: label }

  const { error } = await svc
    .from('tenants')
    .update({ disbursement_main_types: next })
    .eq('id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/settings/lists')
  return { ok: true, code }
}

/** Rename a main type (shipped OR custom). */
export async function renameMainDisbursementType(
  input: { code: string; label_ar: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }
  const code = (input.code ?? '').trim()
  const label = (input.label_ar ?? '').trim()
  if (!code || !label) return { ok: false, error: 'الرمز والاسم مطلوبان.' }
  if (label.length > 80) return { ok: false, error: 'الاسم طويل جدًا.' }

  const svc = createSupabaseService()
  const { data: t } = await svc
    .from('tenants')
    .select('disbursement_main_types')
    .eq('id', guard.tenantId)
    .maybeSingle()
  const current = ((t as { disbursement_main_types: Record<string, string> | null } | null)?.disbursement_main_types ?? {}) as Record<string, string>
  const next = { ...current, [code]: label }

  const { error } = await svc
    .from('tenants')
    .update({ disbursement_main_types: next })
    .eq('id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/settings/lists')
  return { ok: true }
}

/**
 * Delete a main disbursement type.
 *   • custom_main_* codes → removed from the labels JSONB
 *   • shipped defaults    → added to disbursement_main_types_hidden array
 * Any sub-type mapped to this main gets reassigned to main_other automatically.
 */
export async function deleteMainDisbursementType(
  input: { code: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }
  const code = (input.code ?? '').trim()
  if (!code) return { ok: false, error: 'الرمز مطلوب.' }
  if (code === 'main_other') return { ok: false, error: 'لا يمكن حذف «أخرى» — تُستخدم كنوع افتراضي.' }

  const isCustom = code.startsWith('custom_main_')
  const svc = createSupabaseService()
  const { data: t } = await svc
    .from('tenants')
    .select('disbursement_main_types, disbursement_main_types_hidden, disbursement_type_main')
    .eq('id', guard.tenantId)
    .maybeSingle()
  const labels = ((t as { disbursement_main_types: Record<string, string> | null } | null)?.disbursement_main_types ?? {}) as Record<string, string>
  const hidden = (((t as { disbursement_main_types_hidden: string[] | null } | null)?.disbursement_main_types_hidden ?? []) as string[])
  const mapping = ((t as { disbursement_type_main: Record<string, string> | null } | null)?.disbursement_type_main ?? {}) as Record<string, string>

  const nextLabels = { ...labels }
  const nextHidden = [...hidden]
  if (isCustom) {
    delete nextLabels[code]
  } else if (MAIN_TYPE_DEFAULT_CODES.includes(code as typeof MAIN_TYPE_DEFAULT_CODES[number])) {
    if (!nextHidden.includes(code)) nextHidden.push(code)
  } else {
    return { ok: false, error: 'رمز غير معروف.' }
  }

  // Reassign any sub-types that pointed at this main → main_other.
  const nextMapping: Record<string, string> = {}
  for (const [subCode, mainCode] of Object.entries(mapping)) {
    nextMapping[subCode] = mainCode === code ? 'main_other' : mainCode
  }

  const { error } = await svc
    .from('tenants')
    .update({
      disbursement_main_types: nextLabels,
      disbursement_main_types_hidden: nextHidden,
      disbursement_type_main: nextMapping,
    })
    .eq('id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/settings/lists')
  return { ok: true }
}

/** Un-hide a previously deleted default main type. */
export async function restoreMainDisbursementType(
  input: { code: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }
  const code = (input.code ?? '').trim()
  if (!code) return { ok: false, error: 'الرمز مطلوب.' }

  const svc = createSupabaseService()
  const { data: t } = await svc
    .from('tenants')
    .select('disbursement_main_types_hidden')
    .eq('id', guard.tenantId)
    .maybeSingle()
  const current = (((t as { disbursement_main_types_hidden: string[] | null } | null)?.disbursement_main_types_hidden ?? []) as string[])
  const next = current.filter((c) => c !== code)

  const { error } = await svc
    .from('tenants')
    .update({ disbursement_main_types_hidden: next })
    .eq('id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/settings/lists')
  return { ok: true }
}

/**
 * Assign a sub-type to a main-type. Pass main_code = null to clear the
 * assignment (sub-type falls back to main_other at read time).
 */
export async function assignSubToMainDisbursement(
  input: { sub_code: string; main_code: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }
  const subCode = (input.sub_code ?? '').trim()
  const mainCode = (input.main_code ?? '').trim() || null
  if (!subCode) return { ok: false, error: 'الرمز الفرعي مطلوب.' }

  const svc = createSupabaseService()
  const { data: t } = await svc
    .from('tenants')
    .select('disbursement_type_main')
    .eq('id', guard.tenantId)
    .maybeSingle()
  const current = ((t as { disbursement_type_main: Record<string, string> | null } | null)?.disbursement_type_main ?? {}) as Record<string, string>
  const next = { ...current }
  if (mainCode) next[subCode] = mainCode
  else delete next[subCode]

  const { error } = await svc
    .from('tenants')
    .update({ disbursement_type_main: next })
    .eq('id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/settings/lists')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Vendor / service-provider categories — CRUD
// ---------------------------------------------------------------------------

export async function createVendorCategory(
  input: { name_ar: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }

  const name = (input.name_ar ?? '').trim()
  if (!name) return { ok: false, error: 'اسم التصنيف مطلوب.' }
  if (name.length > 80) return { ok: false, error: 'الاسم طويل جدًا (بحد أقصى 80 حرفًا).' }

  const svc = createSupabaseService()
  // Uniqueness is DB-enforced (unique constraint), but we surface a friendly
  // error instead of the raw Postgres one when the name already exists.
  const { data: existing } = await svc
    .from('dsb_vendor_categories')
    .select('id')
    .eq('tenant_id', guard.tenantId)
    .eq('name_ar', name)
    .maybeSingle()
  if (existing) return { ok: false, error: 'هذا التصنيف موجود بالفعل.' }

  const { data, error } = await svc
    .from('dsb_vendor_categories')
    .insert({ tenant_id: guard.tenantId, name_ar: name })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/settings/lists')
  return { ok: true, id: (data as { id: string }).id }
}

export async function renameVendorCategory(
  input: { id: string; name_ar: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }

  const name = (input.name_ar ?? '').trim()
  if (!input.id) return { ok: false, error: 'بيانات ناقصة.' }
  if (!name)     return { ok: false, error: 'اسم التصنيف مطلوب.' }
  if (name.length > 80) return { ok: false, error: 'الاسم طويل جدًا.' }

  const svc = createSupabaseService()
  // Prevent duplicate names within the same tenant.
  const { data: dup } = await svc
    .from('dsb_vendor_categories')
    .select('id')
    .eq('tenant_id', guard.tenantId)
    .eq('name_ar', name)
    .neq('id', input.id)
    .maybeSingle()
  if (dup) return { ok: false, error: 'تصنيف بهذا الاسم موجود بالفعل.' }

  const { error } = await svc
    .from('dsb_vendor_categories')
    .update({ name_ar: name })
    .eq('id', input.id)
    .eq('tenant_id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/settings/lists')
  return { ok: true }
}

export async function deleteVendorCategory(
  input: { id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }
  if (!input.id) return { ok: false, error: 'بيانات ناقصة.' }

  const svc = createSupabaseService()
  // Fetch the row first so we know the name — we use it to check whether
  // any vendor still references this category (free-text match on service_category).
  const { data: row } = await svc
    .from('dsb_vendor_categories')
    .select('id, name_ar, tenant_id')
    .eq('id', input.id)
    .maybeSingle()
  if (!row || (row as { tenant_id: string }).tenant_id !== guard.tenantId) {
    return { ok: false, error: 'التصنيف غير موجود.' }
  }
  const name = (row as { name_ar: string }).name_ar

  const { count } = await svc
    .from('dsb_vendors')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', guard.tenantId)
    .eq('service_category', name)
  if ((count ?? 0) > 0) {
    return { ok: false, error: `لا يمكن حذف التصنيف — مرتبط بـ ${count} مورد. غيّر تصنيفهم أولاً.` }
  }

  const { error } = await svc
    .from('dsb_vendor_categories')
    .delete()
    .eq('id', input.id)
    .eq('tenant_id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/settings/lists')
  return { ok: true }
}
