'use server'

/**
 * Vendor receipts + contract payment-schedule — server actions.
 *
 * All owner-only (write actions). Read-side selects live in page components.
 *
 * Data model overview (see migration 078):
 *   - dsb_vendor_contracts.payment_schedule   → JSONB installment plan
 *   - dsb_vendor_receipts                     → one row per contractor invoice
 *   - dsb_cases.receipt_id                    → link case ↔ receipt
 *   - trigger: case marked signed/delivered → receipt.status = 'paid'
 */
import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export interface VendorInstallment {
  seq: number
  label_ar: string
  amount_sar: number
  paid_at?: string | null   // 'YYYY-MM-DD' when manually marked paid
}

async function resolveOwner(): Promise<
  | { tenantId: string; userId: string }
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
  return { tenantId: profile.tenant_id as string, userId: profile.id as string }
}

async function loadContractProject(
  svc: ReturnType<typeof createSupabaseService>,
  tenantId: string,
  contractId: string,
): Promise<{ project_id: string } | null> {
  const { data } = await svc
    .from('dsb_vendor_contracts')
    .select('id, tenant_id, vendor:dsb_vendors!inner(project_id)')
    .eq('id', contractId).maybeSingle()
  if (!data) return null
  const r = data as { tenant_id: string; vendor: { project_id: string } | { project_id: string }[] | null }
  if (r.tenant_id !== tenantId) return null
  const v = Array.isArray(r.vendor) ? r.vendor[0] : r.vendor
  return v ? { project_id: v.project_id } : null
}

// ---------------------------------------------------------------------------
// 1. Payment schedule editor (per contract)
// ---------------------------------------------------------------------------
export async function updateVendorContractSchedule(
  input: { contract_id: string; schedule: VendorInstallment[] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }
  const svc = createSupabaseService()

  const rows = Array.isArray(input.schedule) ? input.schedule : []
  const cleaned: VendorInstallment[] = []
  for (const r of rows) {
    const seq = Number(r.seq)
    const amt = Number(r.amount_sar)
    const lb  = String(r.label_ar ?? '').trim()
    if (!Number.isFinite(seq) || seq < 1) return { ok: false, error: 'رقم الدفعة غير صالح.' }
    if (!lb) return { ok: false, error: `اسم الدفعة رقم ${seq} فارغ.` }
    if (!Number.isFinite(amt) || amt < 0) return { ok: false, error: `مبلغ الدفعة ${seq} غير صالح.` }
    cleaned.push({
      seq,
      label_ar: lb,
      amount_sar: amt,
      paid_at: r.paid_at ? String(r.paid_at) : null,
    })
  }
  cleaned.sort((a, b) => a.seq - b.seq)

  const project = await loadContractProject(svc, guard.tenantId, input.contract_id)
  if (!project) return { ok: false, error: 'العقد غير موجود.' }

  const { error } = await svc
    .from('dsb_vendor_contracts')
    .update({ payment_schedule: cleaned })
    .eq('id', input.contract_id)
    .eq('tenant_id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${project.project_id}/vendors`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 2. Receipts — CRUD
// ---------------------------------------------------------------------------
export interface CreateVendorReceiptInput {
  vendor_id: string
  contract_id?: string | null
  installment_seq?: number | null
  receipt_number?: string | null
  receipt_date?: string | null              // 'YYYY-MM-DD'
  amount_before_tax_sar: number
  vat_sar?: number | null
  description?: string | null
}

export async function createVendorReceipt(
  input: CreateVendorReceiptInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }
  const svc = createSupabaseService()

  if (!input.vendor_id) return { ok: false, error: 'المورد مطلوب.' }
  if (!Number.isFinite(input.amount_before_tax_sar) || input.amount_before_tax_sar < 0) {
    return { ok: false, error: 'مبلغ الفاتورة غير صالح.' }
  }

  // Tenant-check vendor.
  const { data: v } = await svc
    .from('dsb_vendors').select('id, tenant_id, project_id').eq('id', input.vendor_id).maybeSingle()
  if (!v || (v as { tenant_id: string }).tenant_id !== guard.tenantId) {
    return { ok: false, error: 'المورد غير موجود.' }
  }
  const projectId = (v as { project_id: string }).project_id

  const row: Record<string, unknown> = {
    tenant_id: guard.tenantId,
    vendor_id: input.vendor_id,
    contract_id: input.contract_id ?? null,
    installment_seq: input.installment_seq ?? null,
    receipt_number: (input.receipt_number ?? '').trim() || null,
    receipt_date: input.receipt_date ?? null,
    amount_before_tax_sar: input.amount_before_tax_sar,
    vat_sar: input.vat_sar ?? 0,
    description: (input.description ?? '').trim() || null,
    status: 'pending',
  }
  const { data, error } = await svc
    .from('dsb_vendor_receipts').insert(row).select('id').single()
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${projectId}/vendors`)
  return { ok: true, id: (data as { id: string }).id }
}

export async function updateVendorReceipt(
  input: { id: string; patch: Partial<CreateVendorReceiptInput> },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }
  const svc = createSupabaseService()

  const { data: r } = await svc
    .from('dsb_vendor_receipts').select('id, tenant_id, vendor_id').eq('id', input.id).maybeSingle()
  if (!r || (r as { tenant_id: string }).tenant_id !== guard.tenantId) {
    return { ok: false, error: 'الفاتورة غير موجودة.' }
  }
  const { data: v } = await svc
    .from('dsb_vendors').select('project_id').eq('id', (r as { vendor_id: string }).vendor_id).maybeSingle()
  const projectId = (v as { project_id: string } | null)?.project_id

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const p = input.patch
  if (p.contract_id !== undefined)           patch.contract_id = p.contract_id
  if (p.installment_seq !== undefined)       patch.installment_seq = p.installment_seq
  if (p.receipt_number !== undefined)        patch.receipt_number = (p.receipt_number ?? '').toString().trim() || null
  if (p.receipt_date !== undefined)          patch.receipt_date = p.receipt_date || null
  if (p.amount_before_tax_sar !== undefined) patch.amount_before_tax_sar = p.amount_before_tax_sar
  if (p.vat_sar !== undefined)               patch.vat_sar = p.vat_sar
  if (p.description !== undefined)           patch.description = (p.description ?? '').toString().trim() || null

  const { error } = await svc
    .from('dsb_vendor_receipts').update(patch).eq('id', input.id).eq('tenant_id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  if (projectId) revalidatePath(`/app/disbursements/admin/projects/${projectId}/vendors`)
  return { ok: true }
}

export async function deleteVendorReceipt(
  input: { id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }
  const svc = createSupabaseService()

  const { data: r } = await svc
    .from('dsb_vendor_receipts').select('id, tenant_id, vendor_id, case_id, status').eq('id', input.id).maybeSingle()
  if (!r || (r as { tenant_id: string }).tenant_id !== guard.tenantId) {
    return { ok: false, error: 'الفاتورة غير موجودة.' }
  }
  if ((r as { status: string }).status === 'paid') {
    return { ok: false, error: 'لا يمكن حذف فاتورة مُسدَّدة.' }
  }
  if ((r as { case_id: string | null }).case_id) {
    return { ok: false, error: 'لا يمكن حذف فاتورة مرتبطة بسند صرف. احذف السند أولاً.' }
  }
  const { data: v } = await svc
    .from('dsb_vendors').select('project_id').eq('id', (r as { vendor_id: string }).vendor_id).maybeSingle()
  const projectId = (v as { project_id: string } | null)?.project_id

  const { error } = await svc
    .from('dsb_vendor_receipts').delete().eq('id', input.id).eq('tenant_id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  if (projectId) revalidatePath(`/app/disbursements/admin/projects/${projectId}/vendors`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 3. Create صرف case FROM a receipt (bridges to the workflow pipeline)
// ---------------------------------------------------------------------------
export async function createCaseFromReceipt(
  input: { receipt_id: string },
): Promise<{ ok: true; case_id: string } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }
  const svc = createSupabaseService()

  const { data: r } = await svc
    .from('dsb_vendor_receipts')
    .select('id, tenant_id, vendor_id, contract_id, receipt_number, amount_before_tax_sar, vat_sar, total_amount_sar, description, case_id')
    .eq('id', input.receipt_id).maybeSingle()
  if (!r || (r as { tenant_id: string }).tenant_id !== guard.tenantId) {
    return { ok: false, error: 'الفاتورة غير موجودة.' }
  }
  const receipt = r as {
    id: string; vendor_id: string; contract_id: string | null
    receipt_number: string | null; amount_before_tax_sar: number; vat_sar: number
    total_amount_sar: number; description: string | null; case_id: string | null
  }
  if (receipt.case_id) return { ok: true, case_id: receipt.case_id }   // already has one

  const { data: v } = await svc
    .from('dsb_vendors').select('id, project_id, name_ar, service_category').eq('id', receipt.vendor_id).maybeSingle()
  if (!v) return { ok: false, error: 'المورد غير موجود.' }
  const vendor = v as { id: string; project_id: string; name_ar: string; service_category: string | null }

  // Reuse createCaseByStaff-shaped insert. We stamp minimum viable fields;
  // owner can complete on the case page.
  const nowIso = new Date().toISOString()
  const insertPayload: Record<string, unknown> = {
    tenant_id: guard.tenantId,
    project_id: vendor.project_id,
    status: 'with_employee',
    amount_sar: receipt.total_amount_sar,
    voucher_number_text: receipt.receipt_number,
    receipt_id: receipt.id,
    created_at: nowIso,
    submitted_at: nowIso,
    extracted_fields: {
      beneficiary_name_ar: vendor.name_ar,
      beneficiary_capacity_ar: vendor.service_category,
      disbursement_type_code: 'construction',
      invoice_amount_sar: receipt.amount_before_tax_sar,
      vat_amount_sar: receipt.vat_sar,
    },
  }
  const { data: created, error: caseErr } = await svc
    .from('dsb_cases').insert(insertPayload).select('id').single()
  if (caseErr) return { ok: false, error: caseErr.message }

  const caseId = (created as { id: string }).id
  await svc
    .from('dsb_vendor_receipts')
    .update({ case_id: caseId, status: 'invoiced', updated_at: nowIso })
    .eq('id', receipt.id)

  revalidatePath(`/app/disbursements/admin/projects/${vendor.project_id}/vendors`)
  revalidatePath(`/app/disbursements/${caseId}`)
  return { ok: true, case_id: caseId }
}

// ---------------------------------------------------------------------------
// 4. Mark installment paid (manual milestone tick)
// ---------------------------------------------------------------------------
export async function markInstallmentPaid(
  input: { contract_id: string; seq: number; paid_at: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await resolveOwner()
  if ('error' in guard) return { ok: false, error: guard.error }
  const svc = createSupabaseService()

  const project = await loadContractProject(svc, guard.tenantId, input.contract_id)
  if (!project) return { ok: false, error: 'العقد غير موجود.' }

  const { data: c } = await svc
    .from('dsb_vendor_contracts').select('payment_schedule').eq('id', input.contract_id).maybeSingle()
  const schedule = (((c as { payment_schedule: VendorInstallment[] | null } | null)?.payment_schedule) ?? []) as VendorInstallment[]
  const next = schedule.map((i) => (i.seq === input.seq ? { ...i, paid_at: input.paid_at } : i))

  const { error } = await svc
    .from('dsb_vendor_contracts').update({ payment_schedule: next }).eq('id', input.contract_id).eq('tenant_id', guard.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${project.project_id}/vendors`)
  return { ok: true }
}
