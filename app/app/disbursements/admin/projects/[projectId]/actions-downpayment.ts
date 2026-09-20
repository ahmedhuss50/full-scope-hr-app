'use server'

/**
 * Server action: update a project's developer downpayment (owner-only).
 */
import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export async function updateDeveloperDownpayment(
  input: { projectId: string; amount_sar: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, error: 'لم يتم تسجيل الدخول.' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users').select('id, tenant_id, dsb_role').eq('email', user.email).maybeSingle()
  if (!profile) return { ok: false, error: 'حسابك غير مرتبط بمستأجر.' }
  if ((profile.dsb_role as string | null) !== 'owner') {
    return { ok: false, error: 'هذا الإجراء متاح للمدير فقط.' }
  }
  const tenantId = profile.tenant_id as string

  const amount = Number(input.amount_sar)
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: 'المبلغ غير صالح.' }
  }

  const { error } = await svc
    .from('dsb_projects')
    .update({ developer_downpayment_sar: amount })
    .eq('id', input.projectId)
    .eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${input.projectId}/vendors`)
  revalidatePath(`/app/disbursements/admin/projects/${input.projectId}`)
  return { ok: true }
}
