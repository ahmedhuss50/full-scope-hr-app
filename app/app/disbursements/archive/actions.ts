'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

/**
 * Server actions for the archive view.
 *
 * Currently a single action: updateDeliveryInfo — inline edit of recipient
 * name + delivery date for a case that's already been delivered. Useful for
 * fixing typos or correcting a delivery time that was entered as "now" but
 * should have been logged for an earlier moment.
 *
 * Permission: same as deliverCase — write roles (employee/supervisor/owner)
 * plus deliverer can edit. Viewer cannot.
 */

const EDITABLE_ROLES = ['employee', 'supervisor', 'owner', 'deliverer'] as const

async function resolveCaller(): Promise<
  | { tenantId: string; userId: string; dsbRole: string }
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
  const role = (profile.dsb_role as string | null) ?? null
  if (!role || !(EDITABLE_ROLES as readonly string[]).includes(role)) {
    return { error: 'لا تملك صلاحية.' }
  }
  return {
    tenantId: profile.tenant_id as string,
    userId: profile.id as string,
    dsbRole: role,
  }
}

export interface UpdateDeliveryInfoInput {
  case_id: string
  recipient_name?: string | null
  delivered_at?: string | null   // ISO timestamp (UTC) from client
}

export async function updateDeliveryInfo(
  input: UpdateDeliveryInfoInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!input.case_id) return { ok: false, error: 'بيانات ناقصة.' }

  // Build the patch. We touch ONLY the fields the caller sent — `undefined`
  // means "leave it alone", `null` means "clear it". Empty trimmed strings
  // are treated as null so an empty input doesn't store whitespace.
  const patch: Record<string, string | null> = {}
  if (input.recipient_name !== undefined) {
    const v = (input.recipient_name ?? '').trim()
    patch.recipient_name = v || null
  }
  if (input.delivered_at !== undefined) {
    const v = (input.delivered_at ?? '').trim()
    if (!v) {
      patch.delivered_at = null
    } else {
      const d = new Date(v)
      if (Number.isNaN(d.getTime())) {
        return { ok: false, error: 'تاريخ التسليم غير صالح.' }
      }
      patch.delivered_at = d.toISOString()
    }
  }
  if (Object.keys(patch).length === 0) {
    return { ok: true } // nothing to do
  }

  const svc = createSupabaseService()
  // Verify the case belongs to this tenant + is actually delivered. We don't
  // let archive edits resurrect a not-yet-delivered case.
  const { data: kase } = await svc
    .from('dsb_cases')
    .select('id, status')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.case_id)
    .maybeSingle()
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }
  if ((kase.status as string) !== 'delivered') {
    return { ok: false, error: 'هذا الإجراء متاح فقط للطلبات المسلَّمة.' }
  }

  const { error } = await svc
    .from('dsb_cases')
    .update(patch)
    .eq('id', input.case_id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  // Audit — describe what changed so the trail is meaningful.
  const changedBits: string[] = []
  if ('recipient_name' in patch) changedBits.push(`اسم المستلم: ${patch.recipient_name ?? '—'}`)
  if ('delivered_at' in patch) changedBits.push(`وقت التسليم: ${patch.delivered_at ?? '—'}`)
  await svc.from('dsb_audit_log').insert({
    tenant_id: caller.tenantId,
    case_id: input.case_id,
    event: 'delivery_info_updated',
    actor_user_id: caller.userId,
    notes: `تحديث بيانات التسليم — ${changedBits.join(' · ')}`,
    occurred_at: new Date().toISOString(),
  })

  revalidatePath('/app/disbursements/archive')
  revalidatePath(`/app/disbursements/${input.case_id}`)
  return { ok: true }
}
