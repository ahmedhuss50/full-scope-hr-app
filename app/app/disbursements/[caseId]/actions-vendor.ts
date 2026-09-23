'use server'

/**
 * Server action to assign / clear a vendor on a case (mig 084).
 * Owner + supervisor + employee can set. Deliverer / viewer read-only.
 */
import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

/**
 * Toggle the "this voucher is a developer downpayment" flag (mig 085).
 * Owner + supervisor + employee can set.
 */
export async function updateCaseIsDownpayment(
  input: { case_id: string; is_downpayment: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, error: 'لم يتم تسجيل الدخول.' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users').select('id, tenant_id, dsb_role').eq('email', user.email).maybeSingle()
  if (!profile) return { ok: false, error: 'حسابك غير مرتبط بمستأجر.' }
  const role = (profile.dsb_role as string | null) ?? ''
  if (!['employee', 'supervisor', 'owner'].includes(role)) {
    return { ok: false, error: 'لا تملك صلاحية.' }
  }
  const tenantId = profile.tenant_id as string

  const { data: kase } = await svc
    .from('dsb_cases').select('id, project_id, vendor_id')
    .eq('tenant_id', tenantId).eq('id', input.case_id).maybeSingle()
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }
  const k = kase as { project_id: string; vendor_id: string | null }

  const { error } = await svc
    .from('dsb_cases')
    .update({ is_downpayment: !!input.is_downpayment })
    .eq('id', input.case_id)
    .eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/${input.case_id}`)
  revalidatePath(`/app/disbursements/admin/projects/${k.project_id}/vendors`)
  if (k.vendor_id) {
    revalidatePath(`/app/disbursements/admin/projects/${k.project_id}/vendors/${k.vendor_id}`)
  }
  return { ok: true }
}

/**
 * Set the نوع الوثيقة (disbursement type code) on a case. Writes the code
 * into extracted_fields.disbursement_type_code — the same slot the AI
 * autofills during extraction, so the dropdown just becomes a manual
 * override / fill-in when the AI missed it.
 *
 * Owner + supervisor + employee can set. Accepts:
 *   • any of the shipped enum codes (construction, admin_marketing, …)
 *   • any custom code owner has added under القوائم والنسب (custom_*)
 *   • empty string / null to clear
 */
export async function updateCaseDisbursementType(
  input: { case_id: string; type_code: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, error: 'لم يتم تسجيل الدخول.' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users').select('id, tenant_id, dsb_role').eq('email', user.email).maybeSingle()
  if (!profile) return { ok: false, error: 'حسابك غير مرتبط بمستأجر.' }
  const role = (profile.dsb_role as string | null) ?? ''
  if (!['employee', 'supervisor', 'owner'].includes(role)) {
    return { ok: false, error: 'لا تملك صلاحية.' }
  }
  const tenantId = profile.tenant_id as string

  // Validate the code shape — either blank, one of the fixed enum values,
  // or a custom_* code matching the same pattern used elsewhere.
  const raw = (input.type_code ?? '').trim()
  const FIXED = ['construction', 'admin_marketing', 'bank_financing', 'moh_incentive', 'unit_seriousness_fees', 'vat_project_registry', 'vat_sales_payment', 'other']
  if (raw && !FIXED.includes(raw) && !/^custom_[a-z0-9_]{1,40}$/.test(raw)) {
    return { ok: false, error: 'قيمة نوع الوثيقة غير صالحة.' }
  }

  // Fetch existing extracted_fields to merge — don't blow away other AI data.
  const { data: kase } = await svc
    .from('dsb_cases')
    .select('id, project_id, extracted_fields')
    .eq('tenant_id', tenantId).eq('id', input.case_id).maybeSingle()
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }
  const k = kase as { project_id: string; extracted_fields: Record<string, unknown> | null }

  const merged = { ...(k.extracted_fields ?? {}) }
  if (raw) merged.disbursement_type_code = raw
  else delete merged.disbursement_type_code

  const { error } = await svc
    .from('dsb_cases')
    .update({ extracted_fields: merged })
    .eq('id', input.case_id)
    .eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/${input.case_id}`)
  revalidatePath(`/app/disbursements/admin/projects/${k.project_id}`)
  return { ok: true }
}

export async function updateCaseVendor(
  input: { case_id: string; vendor_id: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, error: 'لم يتم تسجيل الدخول.' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users').select('id, tenant_id, dsb_role').eq('email', user.email).maybeSingle()
  if (!profile) return { ok: false, error: 'حسابك غير مرتبط بمستأجر.' }
  const role = (profile.dsb_role as string | null) ?? ''
  if (!['employee', 'supervisor', 'owner'].includes(role)) {
    return { ok: false, error: 'لا تملك صلاحية.' }
  }
  const tenantId = profile.tenant_id as string

  const { data: kase } = await svc
    .from('dsb_cases')
    .select('id, project_id')
    .eq('tenant_id', tenantId).eq('id', input.case_id).maybeSingle()
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }
  const projectId = (kase as { project_id: string }).project_id

  // If vendor is provided, ensure it belongs to the same tenant + project.
  if (input.vendor_id) {
    const { data: v } = await svc
      .from('dsb_vendors').select('id, tenant_id, project_id')
      .eq('id', input.vendor_id).maybeSingle()
    if (!v || (v as { tenant_id: string }).tenant_id !== tenantId) {
      return { ok: false, error: 'المورد غير موجود.' }
    }
    if ((v as { project_id: string }).project_id !== projectId) {
      return { ok: false, error: 'المورد ليس من نفس مشروع السند.' }
    }
  }

  const { error } = await svc
    .from('dsb_cases')
    .update({ vendor_id: input.vendor_id })
    .eq('id', input.case_id)
    .eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/${input.case_id}`)
  revalidatePath(`/app/disbursements/admin/projects/${projectId}/vendors`)
  if (input.vendor_id) {
    revalidatePath(`/app/disbursements/admin/projects/${projectId}/vendors/${input.vendor_id}`)
  }
  return { ok: true }
}
