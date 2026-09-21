'use server'

/**
 * Server action to assign / clear a vendor on a case (mig 084).
 * Owner + supervisor + employee can set. Deliverer / viewer read-only.
 */
import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

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
