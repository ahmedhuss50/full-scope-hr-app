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

/**
 * Set the advance-deduction (خصم دفعة مقدمة) on an invoice voucher.
 * Deducts a portion of the vendor's open advance balance from this
 * specific invoice. Zero means "no deduction on this invoice".
 *
 *   amount_sar     — raw SAR amount to deduct from the vendor's advance
 *   pct            — optional completion % the user entered (audit trail)
 *
 * Business rules:
 *   • Only valid on NON-advance cases (is_downpayment=false)
 *   • Only valid when the case has a vendor_id
 *   • Cannot exceed the vendor's remaining advance balance
 *   • Cannot exceed the case's amount_sar
 */
export async function updateCaseAdvanceDeduction(
  input: { case_id: string; amount_sar: number; pct: number | null },
): Promise<{ ok: true; remaining: number } | { ok: false; error: string }> {
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

  const amount = Math.max(0, Number(input.amount_sar) || 0)
  const pct    = input.pct == null ? null : Math.max(0, Math.min(100, Number(input.pct) || 0))

  // Load target case
  const { data: kase } = await svc
    .from('dsb_cases')
    .select('id, project_id, vendor_id, amount_sar, is_downpayment, advance_deduction_sar')
    .eq('tenant_id', tenantId).eq('id', input.case_id).maybeSingle()
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }
  const k = kase as {
    project_id: string; vendor_id: string | null; amount_sar: number | null;
    is_downpayment: boolean; advance_deduction_sar: number | null
  }

  if (k.is_downpayment) return { ok: false, error: 'لا يمكن تطبيق خصم مقدم على سند دفعة مقدمة نفسه.' }
  if (!k.vendor_id)     return { ok: false, error: 'اختر المورد / المقاول أولاً.' }
  if (amount > 0 && amount > Number(k.amount_sar ?? 0)) {
    return { ok: false, error: 'الخصم أكبر من قيمة الفاتورة.' }
  }

  // Compute vendor's current open advance balance EXCLUDING this case
  // (so re-saving the same case doesn't double-count).
  const { data: downpaymentRows } = await svc
    .from('dsb_cases')
    .select('amount_sar')
    .eq('tenant_id', tenantId)
    .eq('project_id', k.project_id)
    .eq('vendor_id', k.vendor_id)
    .eq('is_downpayment', true)
  const totalAdvance = ((downpaymentRows ?? []) as Array<{ amount_sar: number | null }>)
    .reduce((s, r) => s + Number(r.amount_sar ?? 0), 0)

  const { data: deductionRows } = await svc
    .from('dsb_cases')
    .select('id, advance_deduction_sar')
    .eq('tenant_id', tenantId)
    .eq('project_id', k.project_id)
    .eq('vendor_id', k.vendor_id)
    .eq('is_downpayment', false)
    .neq('id', input.case_id)
    .gt('advance_deduction_sar', 0)
  const otherDeductions = ((deductionRows ?? []) as Array<{ advance_deduction_sar: number | null }>)
    .reduce((s, r) => s + Number(r.advance_deduction_sar ?? 0), 0)

  const remainingBefore = totalAdvance - otherDeductions
  if (amount > remainingBefore) {
    return { ok: false, error: `الخصم أكبر من الرصيد المتبقي للمقدم (${remainingBefore.toLocaleString('en')} ر.س).` }
  }

  const { error } = await svc
    .from('dsb_cases')
    .update({ advance_deduction_sar: amount, advance_deduction_pct: pct })
    .eq('id', input.case_id)
    .eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/${input.case_id}`)
  revalidatePath(`/app/disbursements/admin/projects/${k.project_id}/vendors/${k.vendor_id}`)
  return { ok: true, remaining: remainingBefore - amount }
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
