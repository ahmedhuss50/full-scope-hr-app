'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { distributeBuyerDeposit } from '@/lib/dsb/distribute-buyer-deposit'

// ----------------------------------------------------------------------------
// Deposit category updater — used by the inline dropdown on the payments list
// (سجل الإيداعات). Owner-only, since the list itself is owner-only.
//
// The category is a plain text column with a CHECK constraint in the DB
// (migration 062). We re-validate the value here so a tampered client can't
// slip a rogue value past the check.
//
// Side-effect (migration 063): moving a row INTO buyer_collection triggers
// auto-distribution across the project's 4 escrow accounts. Moving a row
// OUT of buyer_collection deletes any existing split children. The
// user-facing dropdown never offers 'auto_distribution' — that value only
// appears on rows the distributor itself generated.
// ----------------------------------------------------------------------------

// Includes 'auto_distribution' so the DB-side value can round-trip through
// this type when we read a split row. It is NOT selectable in the picker
// dropdown — splits are read-only.
const ALLOWED_CATEGORIES = [
  'buyer_collection',
  'wrong_transfer',
  'self_financing',
  'bank_financing',
  'other',
  'auto_distribution',
] as const

export type DepositCategory = (typeof ALLOWED_CATEGORIES)[number]

// Subset the user is allowed to write via the inline dropdown.
const USER_SETTABLE_CATEGORIES = [
  'buyer_collection',
  'wrong_transfer',
  'self_financing',
  'bank_financing',
  'other',
] as const
export type UserSettableCategory = (typeof USER_SETTABLE_CATEGORIES)[number]

export async function updateDepositCategory(
  input: { payment_id: string; category: UserSettableCategory },
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
  if (!(USER_SETTABLE_CATEGORIES as readonly string[]).includes(input.category)) {
    return { ok: false, error: 'قيمة الحالة غير معتمدة.' }
  }

  // Fetch the row so we (a) confirm tenant ownership and (b) know the OLD
  // category — needed so we can clean up split children when moving OUT of
  // buyer_collection.
  const { data: existing } = await svc
    .from('dsb_payments')
    .select('id, tenant_id, deposit_category, split_source_payment_id')
    .eq('id', paymentId)
    .maybeSingle()
  if (!existing || (existing as { tenant_id: string }).tenant_id !== tenantId) {
    return { ok: false, error: 'الدفعة غير موجودة.' }
  }
  const oldCategory = (existing as { deposit_category: string | null }).deposit_category
  // Don't let anyone reclassify a split child — they belong to the parent.
  if ((existing as { split_source_payment_id: string | null }).split_source_payment_id) {
    return { ok: false, error: 'لا يمكن تعديل تصنيف صف من صفوف التوزيع التلقائي.' }
  }

  const { error } = await svc
    .from('dsb_payments')
    .update({ deposit_category: input.category })
    .eq('id', paymentId)
    .eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }

  // Migration 063 side-effect: sync the auto-distribution children.
  if (input.category === 'buyer_collection') {
    // Regenerate the 4 split rows (idempotent — helper deletes-then-inserts).
    // We tolerate a "not eligible" outcome silently; a hard error surfaces so
    // the owner knows their account roles are misconfigured.
    const res = await distributeBuyerDeposit(svc, tenantId, paymentId)
    if (!res.ok) return { ok: false, error: res.error }
  } else if (oldCategory === 'buyer_collection') {
    // Moved OUT of buyer_collection — nuke any children we generated before.
    const { error: delErr } = await svc
      .from('dsb_payments')
      .delete()
      .eq('split_source_payment_id', paymentId)
    if (delErr) return { ok: false, error: delErr.message }
  }

  revalidatePath('/app/disbursements/admin/lists/payments')
  return { ok: true }
}
