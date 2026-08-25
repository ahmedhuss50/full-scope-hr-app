import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Buyer-deposit auto-distribution (migration 063).
 *
 * Business rule (Saudi real-estate escrow):
 *   Every buyer deposit lands on the project's GENERAL account, then is
 *   automatically distributed to three sub-accounts by a regulator-mandated
 *   fixed split:
 *     construction     (الانشاءات)         → 76%
 *     admin_marketing  (الاداري والتسويقي) → 20%
 *     escrow           (الحفظ)             →  4%
 *
 *   Implementation: for every eligible parent payment we generate FOUR
 *   derived rows in dsb_payments — one offset debit on the general account
 *   and three credits on the sub-accounts. `split_source_payment_id` points
 *   back to the parent (ON DELETE CASCADE). Idempotent: we always DELETE
 *   existing children first, then insert the 4 fresh rows.
 *
 *   The offset debit uses -parent.amount exactly (rather than the sum of
 *   the three rounded children) so pennies never drift when the child
 *   credits get rounded to 2 decimals.
 *
 * See lib/dsb/access.ts for the SupabaseClient generic shape reused here.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseServiceClient = SupabaseClient<any, 'public', any>

type DistributeResult =
  | { ok: true; generated: number; skipped?: 'not_eligible' }
  | { ok: false; error: string; skipped?: 'not_eligible' | 'accounts_missing' }

/** Round to 2 decimals (halalas), avoiding IEEE drift. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Short 8-char parent id for the Arabic description. */
function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8)
}

/**
 * Generate (or re-generate) the 4 split-child rows for a buyer deposit.
 *
 * Guards return `{ ok: true, generated: 0 }` when the parent simply isn't
 * eligible for a split (wrong category, not on the general account, negative
 * amount, already a child itself, missing project/account, …). Only true
 * data errors — missing sub-accounts, DB errors — return `{ ok: false }`.
 *
 * Caller is expected to be running with the service-role client (bypasses
 * RLS) and to have already verified the caller's write authority.
 */
export async function distributeBuyerDeposit(
  svc: SupabaseServiceClient,
  tenantId: string,
  paymentId: string,
): Promise<DistributeResult> {
  // ---- 1) Load parent ----
  const { data: parent, error: parentErr } = await svc
    .from('dsb_payments')
    .select(
      'id, tenant_id, project_id, account_id, amount_sar, currency, payment_date, deposit_category, split_source_payment_id',
    )
    .eq('id', paymentId)
    .maybeSingle()
  if (parentErr) return { ok: false, error: parentErr.message }
  if (!parent) return { ok: false, error: 'الدفعة غير موجودة.' }

  // ---- 2) Guards ----
  if ((parent as { tenant_id: string }).tenant_id !== tenantId) {
    return { ok: true, generated: 0, skipped: 'not_eligible' }
  }
  const p = parent as {
    id: string
    tenant_id: string
    project_id: string | null
    account_id: string | null
    amount_sar: number | string
    currency: string
    payment_date: string
    deposit_category: string | null
    split_source_payment_id: string | null
  }
  const amount = typeof p.amount_sar === 'number' ? p.amount_sar : Number(p.amount_sar)
  if (p.deposit_category !== 'buyer_collection') {
    return { ok: true, generated: 0, skipped: 'not_eligible' }
  }
  if (p.split_source_payment_id !== null) {
    // Never split a split — parent must be an original deposit.
    return { ok: true, generated: 0, skipped: 'not_eligible' }
  }
  if (!p.project_id || !p.account_id) {
    return { ok: true, generated: 0, skipped: 'not_eligible' }
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    // Negatives/zero don't distribute — refunds shouldn't cascade a split.
    return { ok: true, generated: 0, skipped: 'not_eligible' }
  }

  // ---- 3) Confirm parent's account is the general one ----
  const { data: parentAcct, error: parentAcctErr } = await svc
    .from('dsb_project_accounts')
    .select('id, account_role, project_id, tenant_id')
    .eq('id', p.account_id)
    .maybeSingle()
  if (parentAcctErr) return { ok: false, error: parentAcctErr.message }
  if (!parentAcct) return { ok: true, generated: 0, skipped: 'not_eligible' }
  const parentAcctRow = parentAcct as {
    id: string
    account_role: string | null
    project_id: string | null
    tenant_id: string
  }
  if (parentAcctRow.account_role !== 'general') {
    return { ok: true, generated: 0, skipped: 'not_eligible' }
  }

  // ---- 4) Load the 3 sub-accounts for this project ----
  const { data: subAccts, error: subErr } = await svc
    .from('dsb_project_accounts')
    .select('id, account_role')
    .eq('tenant_id', tenantId)
    .eq('project_id', p.project_id)
    .in('account_role', ['construction', 'admin_marketing', 'escrow'])
  if (subErr) return { ok: false, error: subErr.message }
  const byRole = new Map<string, string>()
  for (const a of ((subAccts ?? []) as Array<{ id: string; account_role: string }>)) {
    byRole.set(a.account_role, a.id)
  }
  const constructionId = byRole.get('construction')
  const adminMarketingId = byRole.get('admin_marketing')
  const escrowId = byRole.get('escrow')
  if (!constructionId || !adminMarketingId || !escrowId) {
    return {
      ok: false,
      error:
        'إعدادات الحسابات ناقصة — يجب تحديد الحساب العام + 3 حسابات فرعية (انشاءات، اداري وتسويقي، حفظ) قبل التوزيع.',
      skipped: 'accounts_missing',
    }
  }

  // ---- 5) Delete existing children (idempotency) ----
  const { error: delErr } = await svc
    .from('dsb_payments')
    .delete()
    .eq('split_source_payment_id', p.id)
  if (delErr) return { ok: false, error: delErr.message }

  // ---- 6) Build + insert the 4 rows atomically ----
  const short = shortId(p.id)
  const commonFields = {
    tenant_id: p.tenant_id,
    project_id: p.project_id,
    payment_date: p.payment_date,
    currency: p.currency,
    deposit_category: 'auto_distribution' as const,
    split_source_payment_id: p.id,
    beneficiary_name: null as string | null,
    reference_number: null as string | null,
    imported_from: 'auto_distribution' as const,
  }

  const rows = [
    {
      ...commonFields,
      account_id: parentAcctRow.id,
      amount_sar: -amount, // exact offset — avoids rounding drift
      split_percentage: -100,
      description: `توزيع تلقائي من دفعة #${short} — -100%`,
    },
    {
      ...commonFields,
      account_id: constructionId,
      amount_sar: round2(amount * 0.76),
      split_percentage: 76,
      description: `توزيع تلقائي من دفعة #${short} — 76%`,
    },
    {
      ...commonFields,
      account_id: adminMarketingId,
      amount_sar: round2(amount * 0.2),
      split_percentage: 20,
      description: `توزيع تلقائي من دفعة #${short} — 20%`,
    },
    {
      ...commonFields,
      account_id: escrowId,
      amount_sar: round2(amount * 0.04),
      split_percentage: 4,
      description: `توزيع تلقائي من دفعة #${short} — 4%`,
    },
  ]

  const { error: insErr } = await svc.from('dsb_payments').insert(rows)
  if (insErr) return { ok: false, error: insErr.message }

  return { ok: true, generated: 4 }
}
