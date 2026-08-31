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

// ----------------------------------------------------------------------------
// updatePayment — owner-only inline edit for a payment ledger row.
// ----------------------------------------------------------------------------
// Powers the pencil-button expander on the payments list (see
// EditPaymentRow.tsx). Every field on dsb_payments that a human actually
// authored (date, amount, VAT, description, project/account, links to
// sale/case) is settable here. Split children refuse the update — they're
// regenerated from the parent by distributeBuyerDeposit.
//
// contract_number resolves to sale_id server-side using the same policy the
// importer uses (migration 064): tenant-scoped case-insensitive match on
// dsb_unit_sales.contract_number. case_number resolves the same way against
// dsb_cases. When sale_id is set we also refresh the deprecated unit_id
// column from sale.unit_id so older readers keep displaying a unit.
//
// If the parent is a `buyer_collection` payment and either the amount OR the
// account_id changed, we re-run distributeBuyerDeposit to keep the four
// split-child rows in sync (mig 063).
// ----------------------------------------------------------------------------

export interface UpdatePaymentInput {
  payment_id: string
  payment_date: string | null       // 'YYYY-MM-DD'
  amount_sar: number | null
  vat_sar: number | null
  beneficiary_name: string | null
  description: string | null
  reference_number: string | null
  payment_method: string | null
  project_id: string | null
  account_id: string | null
  contract_number: string | null    // resolves server-side to sale_id
  case_number: string | null        // resolves to case_id
}

export async function updatePayment(
  input: UpdatePaymentInput,
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

  // ---- Load the existing row (tenant confirm + split-child guard) ----
  const { data: existing } = await svc
    .from('dsb_payments')
    .select(
      'id, tenant_id, project_id, account_id, amount_sar, deposit_category, split_source_payment_id',
    )
    .eq('id', paymentId)
    .maybeSingle()
  if (!existing || (existing as { tenant_id: string }).tenant_id !== tenantId) {
    return { ok: false, error: 'الدفعة غير موجودة.' }
  }
  const ex = existing as {
    id: string
    project_id: string | null
    account_id: string | null
    amount_sar: number
    deposit_category: string | null
    split_source_payment_id: string | null
  }
  if (ex.split_source_payment_id) {
    return {
      ok: false,
      error: 'صف توزيع تلقائي — يُعدَّل بتعديل الأصل',
    }
  }

  // ---- Validate scalars ----
  const paymentDate = (input.payment_date ?? '').trim()
  if (!paymentDate) {
    // dsb_payments.payment_date is NOT NULL — a blank value would fail the
    // DB check anyway, so we reject early with a friendly message.
    return { ok: false, error: 'تاريخ الدفع مطلوب.' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    return { ok: false, error: 'تاريخ الدفع غير صالح (الصيغة YYYY-MM-DD).' }
  }
  const amount = input.amount_sar
  if (amount === null || !Number.isFinite(amount)) {
    return { ok: false, error: 'المبلغ غير صالح.' }
  }
  const vat = input.vat_sar
  if (vat !== null && !Number.isFinite(vat)) {
    return { ok: false, error: 'قيمة الضريبة غير صالحة.' }
  }

  // ---- Validate project + account belong to tenant ----
  const projectId = (input.project_id ?? '').trim() || null
  const accountId = (input.account_id ?? '').trim() || null
  if (projectId) {
    const { data: proj } = await svc
      .from('dsb_projects')
      .select('id')
      .eq('id', projectId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!proj) return { ok: false, error: 'المشروع غير موجود.' }
  }
  if (accountId) {
    if (!projectId) {
      return { ok: false, error: 'الحساب لا ينتمي للمشروع' }
    }
    const { data: acct } = await svc
      .from('dsb_project_accounts')
      .select('id, project_id')
      .eq('id', accountId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!acct) return { ok: false, error: 'الحساب غير موجود.' }
    if ((acct as { project_id: string }).project_id !== projectId) {
      return { ok: false, error: 'الحساب لا ينتمي للمشروع' }
    }
  }

  // ---- Resolve contract_number → sale_id (mirrors importer policy) ----
  let saleId: string | null = null
  let saleUnitId: string | null = null
  const contractRaw = (input.contract_number ?? '').trim()
  if (contractRaw) {
    const { data: sale } = await svc
      .from('dsb_unit_sales')
      .select('id, unit_id')
      .eq('tenant_id', tenantId)
      .ilike('contract_number', contractRaw)
      .limit(1)
      .maybeSingle()
    if (!sale) return { ok: false, error: 'رقم العقد غير موجود' }
    saleId = (sale as { id: string }).id
    saleUnitId = (sale as { unit_id: string | null }).unit_id ?? null
  }

  // ---- Resolve case_number → case_id ----
  let caseId: string | null = null
  const caseRaw = (input.case_number ?? '').trim()
  if (caseRaw) {
    const { data: kase } = await svc
      .from('dsb_cases')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('case_number', caseRaw)
      .limit(1)
      .maybeSingle()
    if (!kase) return { ok: false, error: 'رقم الطلب غير موجود.' }
    caseId = (kase as { id: string }).id
  }

  // ---- Build patch. When a sale is set we also refresh the deprecated
  //      unit_id column so older readers still see a unit until they migrate
  //      to using sale.unit_id. When no sale is set we leave unit_id alone
  //      to avoid clobbering pre-migration values.
  const patch: Record<string, unknown> = {
    payment_date: paymentDate,
    amount_sar: amount,
    vat_sar: vat,
    beneficiary_name: (input.beneficiary_name ?? '').trim() || null,
    description: (input.description ?? '').trim() || null,
    reference_number: (input.reference_number ?? '').trim() || null,
    payment_method: (input.payment_method ?? '').trim() || null,
    project_id: projectId,
    account_id: accountId,
    sale_id: saleId,
    case_id: caseId,
  }
  if (saleId) patch.unit_id = saleUnitId

  const { error: updErr } = await svc
    .from('dsb_payments')
    .update(patch)
    .eq('id', paymentId)
    .eq('tenant_id', tenantId)
  if (updErr) return { ok: false, error: updErr.message }

  // ---- Re-run auto-distribution when the parent's money or destination
  //      account moved. Only fires on buyer_collection parents (skips split
  //      children — those are refused above anyway).
  const amountChanged = Number(ex.amount_sar) !== Number(amount)
  const accountChanged = (ex.account_id ?? null) !== accountId
  if (
    ex.deposit_category === 'buyer_collection' &&
    ex.split_source_payment_id === null &&
    (amountChanged || accountChanged)
  ) {
    const res = await distributeBuyerDeposit(svc, tenantId, paymentId)
    if (!res.ok) return { ok: false, error: res.error }
  }

  revalidatePath('/app/disbursements/admin/lists/payments')
  return { ok: true }
}
