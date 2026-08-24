'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

// ----------------------------------------------------------------------------
// Deposit category updater — used by the inline dropdown on the payments list
// (سجل الإيداعات). Owner-only, since the list itself is owner-only.
//
// The category is a plain text column with a CHECK constraint in the DB
// (migration 062). We re-validate the value here so a tampered client can't
// slip a rogue value past the check.
// ----------------------------------------------------------------------------

const ALLOWED_CATEGORIES = [
  'buyer_collection',
  'wrong_transfer',
  'self_financing',
  'bank_financing',
  'other',
] as const

export type DepositCategory = (typeof ALLOWED_CATEGORIES)[number]

export async function updateDepositCategory(
  input: { payment_id: string; category: DepositCategory },
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

  const tenantId = profile.tenant_id as string
  const paymentId = (input.payment_id ?? '').trim()
  if (!paymentId) return { ok: false, error: 'بيانات ناقصة.' }
  if (!ALLOWED_CATEGORIES.includes(input.category)) {
    return { ok: false, error: 'قيمة الحالة غير معتمدة.' }
  }

  const { error } = await svc
    .from('dsb_payments')
    .update({ deposit_category: input.category })
    .eq('id', paymentId)
    .eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/lists/payments')
  return { ok: true }
}
