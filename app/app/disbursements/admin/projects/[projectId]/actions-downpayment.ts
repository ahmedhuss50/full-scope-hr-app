'use server'

/**
 * Server actions for the developer downpayment + its milestone-based
 * spending plan. Owner-only.
 */
import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export interface DownpaymentMilestone {
  seq: number
  label_ar: string
  completion_pct: number
  amount_sar: number
  released_at?: string | null
}

async function ownerGuard(): Promise<
  | { tenantId: string }
  | { error: string }
> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: 'لم يتم تسجيل الدخول.' }
  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users').select('id, tenant_id, dsb_role').eq('email', user.email).maybeSingle()
  if (!profile) return { error: 'حسابك غير مرتبط بمستأجر.' }
  if ((profile.dsb_role as string | null) !== 'owner') {
    return { error: 'هذا الإجراء متاح للمدير فقط.' }
  }
  return { tenantId: profile.tenant_id as string }
}

export async function updateDeveloperDownpayment(
  input: { projectId: string; amount_sar: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await ownerGuard()
  if ('error' in guard) return { ok: false, error: guard.error }

  const amount = Number(input.amount_sar)
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: 'المبلغ غير صالح.' }
  }

  const svc = createSupabaseService()
  const { error } = await svc
    .from('dsb_projects')
    .update({ developer_downpayment_sar: amount })
    .eq('id', input.projectId)
    .eq('tenant_id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${input.projectId}/vendors`)
  revalidatePath(`/app/disbursements/admin/projects/${input.projectId}`)
  return { ok: true }
}

/**
 * Save the full milestone plan (replaces existing). Empty array clears it.
 */
export async function updateDownpaymentPlan(
  input: { projectId: string; plan: DownpaymentMilestone[] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await ownerGuard()
  if ('error' in guard) return { ok: false, error: guard.error }

  const cleaned: DownpaymentMilestone[] = []
  for (const r of Array.isArray(input.plan) ? input.plan : []) {
    const seq = Number(r.seq)
    const pct = Number(r.completion_pct)
    const amt = Number(r.amount_sar)
    const lb  = String(r.label_ar ?? '').trim()
    if (!Number.isFinite(seq) || seq < 1) return { ok: false, error: 'رقم الدفعة غير صالح.' }
    if (!lb) return { ok: false, error: `اسم الدفعة رقم ${seq} فارغ.` }
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, error: `نسبة الإنجاز للدفعة ${seq} غير صالحة (0-100).` }
    if (!Number.isFinite(amt) || amt < 0) return { ok: false, error: `مبلغ الدفعة ${seq} غير صالح.` }
    cleaned.push({
      seq, label_ar: lb, completion_pct: pct, amount_sar: amt,
      released_at: r.released_at ? String(r.released_at) : null,
    })
  }
  cleaned.sort((a, b) => a.seq - b.seq)

  const svc = createSupabaseService()
  const { error } = await svc
    .from('dsb_projects')
    .update({ developer_downpayment_plan: cleaned })
    .eq('id', input.projectId)
    .eq('tenant_id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${input.projectId}/vendors`)
  return { ok: true }
}

/**
 * Toggle a specific tranche's released_at flag (pass null to un-release).
 */
export async function markMilestoneReleased(
  input: { projectId: string; seq: number; released_at: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await ownerGuard()
  if ('error' in guard) return { ok: false, error: guard.error }

  const svc = createSupabaseService()
  const { data: p } = await svc
    .from('dsb_projects')
    .select('developer_downpayment_plan')
    .eq('id', input.projectId)
    .eq('tenant_id', guard.tenantId)
    .maybeSingle()
  const plan = (((p as { developer_downpayment_plan: DownpaymentMilestone[] | null } | null)?.developer_downpayment_plan) ?? []) as DownpaymentMilestone[]
  const next = plan.map((m) => (m.seq === input.seq ? { ...m, released_at: input.released_at } : m))

  const { error } = await svc
    .from('dsb_projects')
    .update({ developer_downpayment_plan: next })
    .eq('id', input.projectId)
    .eq('tenant_id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${input.projectId}/vendors`)
  return { ok: true }
}
