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

export async function deleteCustomLabel(
  input: { kind: LabelKind; code: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }

  const code = (input.code ?? '').trim()
  if (!code) return { ok: false, error: 'الرمز مطلوب.' }
  if (!code.startsWith('custom_')) {
    return { ok: false, error: 'القوائم الافتراضية لا يمكن حذفها.' }
  }

  const column =
    input.kind === 'deposit'      ? 'deposit_category_labels' :
    input.kind === 'disbursement' ? 'disbursement_type_labels' :
    null
  if (!column) return { ok: false, error: 'قائمة غير معروفة.' }

  const svc = createSupabaseService()

  // For deposit categories only: refuse deletion if any payment still uses
  // this code — otherwise the label vanishes and the row shows a raw slug.
  if (input.kind === 'deposit') {
    const { count } = await svc
      .from('dsb_payments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', guard.tenantId)
      .eq('deposit_category', code)
    if ((count ?? 0) > 0) {
      return { ok: false, error: `لا يمكن الحذف — التصنيف مستخدم في ${count} دفعة.` }
    }
  }

  const { data: t } = await svc
    .from('tenants')
    .select(column)
    .eq('id', guard.tenantId)
    .maybeSingle()
  const current = ((t as Record<string, Record<string, string> | null> | null)?.[column] ?? {}) as Record<string, string>
  if (!(code in current)) return { ok: true } // already gone
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [code]: _dropped, ...rest } = current

  const { error } = await svc
    .from('tenants')
    .update({ [column]: rest })
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
