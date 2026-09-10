'use server'

/**
 * Owner-only server actions for القوائم والنسب.
 *
 * Currently exposes just the buyer-deposit distribution shares
 * (construction / admin_marketing / escrow). The list of deposit
 * categories and the list of disbursement types are enum-shaped values
 * hard-coded in the application layer — surfaced read-only on the page,
 * not editable here (changing them touches the AI prompt, importer
 * mapping, and downstream tabs; treat as a code change).
 */
import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export interface DistributionShares {
  construction:    number
  admin_marketing: number
  escrow:          number
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
