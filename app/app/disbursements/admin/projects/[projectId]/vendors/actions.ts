'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { assignedProjectIds } from '@/lib/dsb/access'

// ----------------------------------------------------------------------------
// Per-project vendor directory — server actions.
//
// Auth model (mirrors task #185):
//   - ADD / EDIT (vendors + their contracts + PDF upload) → any staff role,
//     but employees / supervisors only on projects they're assigned to.
//     Contract-side actions (addVendorContract, updateVendorContract,
//     requestVendorContractUploadUrl, attachContractPdf) resolve the vendor's
//     project first and scope-check against that.
//   - DELETE (vendors + contracts) → owner only.
//
// Every write includes `.eq('tenant_id', tenantId)` — the service client
// bypasses RLS so we must never skip that check.
// ----------------------------------------------------------------------------

type WriteRole = 'employee' | 'supervisor' | 'owner'

interface CallerCtx {
  tenantId: string
  userId: string
  dsbRole: WriteRole
}

async function resolveCaller(): Promise<CallerCtx | { error: string }> {
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
  if (!role || !['employee', 'supervisor', 'owner'].includes(role)) {
    return { error: 'لا تملك صلاحية.' }
  }
  return {
    tenantId: profile.tenant_id as string,
    userId: profile.id as string,
    dsbRole: role as WriteRole,
  }
}

function assertOwner(caller: CallerCtx): { ok: true } | { ok: false; error: string } {
  if (caller.dsbRole !== 'owner') {
    return { ok: false, error: 'هذه العملية متاحة للمدير فقط.' }
  }
  return { ok: true }
}

/**
 * Owner bypasses. Employee / supervisor must be assigned to every project id
 * in the list. Viewers / deliverers are rejected up-front.
 */
async function assertCanWriteToProjects(
  caller: CallerCtx,
  projectIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (caller.dsbRole === 'owner') return { ok: true }
  if (!['employee', 'supervisor'].includes(caller.dsbRole)) {
    return { ok: false, error: 'ليست لديك صلاحية الإضافة.' }
  }
  const uniq = Array.from(new Set(projectIds.filter(Boolean)))
  if (uniq.length === 0) return { ok: true }
  const svc = createSupabaseService()
  const allowed = await assignedProjectIds({
    svc,
    tenantId: caller.tenantId,
    userId: caller.userId,
    dsbRole: caller.dsbRole,
  })
  if (allowed === null) return { ok: true }
  const outOfScope = uniq.filter((id) => !allowed.includes(id))
  if (outOfScope.length > 0) {
    return { ok: false, error: 'ليست لديك صلاحية على هذا المشروع.' }
  }
  return { ok: true }
}

/**
 * Given a vendor id, return the vendor + its project_id after verifying
 * tenant isolation. Used by every contract-side action so the caller can be
 * scope-checked against the vendor's project.
 */
async function resolveVendorForCaller(
  caller: CallerCtx,
  vendorId: string,
): Promise<
  | { ok: true; vendor: { id: string; tenant_id: string; project_id: string } }
  | { ok: false; error: string }
> {
  if (!vendorId) return { ok: false, error: 'المُعرِّف مطلوب.' }
  const svc = createSupabaseService()
  const { data: vendor } = await svc
    .from('dsb_vendors')
    .select('id, tenant_id, project_id')
    .eq('id', vendorId)
    .maybeSingle()
  if (!vendor || (vendor as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'المورد غير موجود.' }
  }
  return {
    ok: true,
    vendor: vendor as { id: string; tenant_id: string; project_id: string },
  }
}

// ---------------------------------------------------------------------------
// addVendor — write roles + project scope
// ---------------------------------------------------------------------------

export interface AddVendorInput {
  project_id: string
  name_ar: string
  service_category?: string | null
  tax_number?: string | null
  commercial_registration?: string | null
  phone?: string | null
  email?: string | null
  iban?: string | null
  references_text?: string | null
  contact_person_name?: string | null
  contact_person_phone?: string | null
  notes?: string | null
}

export async function addVendor(
  input: AddVendorInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }

  const projectId = (input.project_id ?? '').trim()
  const nameAr = (input.name_ar ?? '').trim()
  if (!projectId) return { ok: false, error: 'المشروع مطلوب.' }
  if (!nameAr) return { ok: false, error: 'اسم المورد مطلوب.' }

  const guard = await assertCanWriteToProjects(caller, [projectId])
  if (!guard.ok) return guard

  const svc = createSupabaseService()
  // Verify project belongs to caller's tenant.
  const { data: project } = await svc
    .from('dsb_projects')
    .select('id, tenant_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project || (project as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'المشروع غير موجود.' }
  }

  const { data, error } = await svc
    .from('dsb_vendors')
    .insert({
      tenant_id: caller.tenantId,
      project_id: projectId,
      name_ar: nameAr,
      service_category: (input.service_category ?? '').trim() || null,
      tax_number: (input.tax_number ?? '').trim() || null,
      commercial_registration: (input.commercial_registration ?? '').trim() || null,
      phone: (input.phone ?? '').trim() || null,
      email: (input.email ?? '').trim().toLowerCase() || null,
      iban: (input.iban ?? '').trim().toUpperCase() || null,
      references_text: (input.references_text ?? '').trim() || null,
      contact_person_name: (input.contact_person_name ?? '').trim() || null,
      contact_person_phone: (input.contact_person_phone ?? '').trim() || null,
      notes: (input.notes ?? '').trim() || null,
      created_by_user_id: caller.userId,
    })
    .select('id')
    .single()
  if (error || !data) {
    return { ok: false, error: error?.message ?? 'تعذّر إضافة المورد.' }
  }

  revalidatePath(`/app/disbursements/admin/projects/${projectId}/vendors`)
  return { ok: true, id: data.id as string }
}

// ---------------------------------------------------------------------------
// updateVendor — write roles + project scope. Patch semantics: undefined =
// leave alone, '' or null = clear, string = set.
// ---------------------------------------------------------------------------

export interface UpdateVendorInput {
  id: string
  patch: {
    name_ar?: string
    service_category?: string | null
    tax_number?: string | null
    commercial_registration?: string | null
    phone?: string | null
    email?: string | null
    iban?: string | null
    references_text?: string | null
    contact_person_name?: string | null
    contact_person_phone?: string | null
    notes?: string | null
  }
}

export async function updateVendor(
  input: UpdateVendorInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!input.id) return { ok: false, error: 'المُعرِّف مطلوب.' }

  const resolved = await resolveVendorForCaller(caller, input.id)
  if (!resolved.ok) return resolved
  const guard = await assertCanWriteToProjects(caller, [resolved.vendor.project_id])
  if (!guard.ok) return guard

  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input.patch)) {
    if (v === undefined) continue
    if (k === 'name_ar') {
      const trimmed = (v as string).trim()
      if (!trimmed) return { ok: false, error: 'اسم المورد مطلوب.' }
      patch.name_ar = trimmed
      continue
    }
    if (v === null || v === '') {
      patch[k] = null
      continue
    }
    if (typeof v === 'string') {
      const trimmed = v.trim()
      if (k === 'email') patch[k] = trimmed.toLowerCase() || null
      else if (k === 'iban') patch[k] = trimmed.toUpperCase() || null
      else patch[k] = trimmed || null
    } else {
      patch[k] = v
    }
  }
  if (Object.keys(patch).length === 0) return { ok: true }

  const svc = createSupabaseService()
  const { error } = await svc
    .from('dsb_vendors')
    .update(patch)
    .eq('id', input.id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${resolved.vendor.project_id}/vendors`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// deleteVendor — owner only. Cascades to dsb_vendor_contracts via FK.
// ---------------------------------------------------------------------------

export async function deleteVendor(
  input: { id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  const own = assertOwner(caller)
  if (!own.ok) return own
  if (!input.id) return { ok: false, error: 'المُعرِّف مطلوب.' }

  const resolved = await resolveVendorForCaller(caller, input.id)
  if (!resolved.ok) return resolved

  const svc = createSupabaseService()
  const { error } = await svc
    .from('dsb_vendors')
    .delete()
    .eq('id', input.id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${resolved.vendor.project_id}/vendors`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// addVendorContract — write roles + project scope
// ---------------------------------------------------------------------------

export interface AddVendorContractInput {
  vendor_id: string
  contract_number?: string | null
  work_type?: string | null
  start_date?: string | null
  end_date?: string | null
  total_amount_sar?: number | null
  status?: 'active' | 'completed' | 'cancelled' | null
  notes?: string | null
}

export async function addVendorContract(
  input: AddVendorContractInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!input.vendor_id) return { ok: false, error: 'المورد مطلوب.' }

  const resolved = await resolveVendorForCaller(caller, input.vendor_id)
  if (!resolved.ok) return resolved
  const guard = await assertCanWriteToProjects(caller, [resolved.vendor.project_id])
  if (!guard.ok) return guard

  const status = (input.status ?? 'active') as string
  if (!['active', 'completed', 'cancelled'].includes(status)) {
    return { ok: false, error: 'حالة العقد غير صالحة.' }
  }
  const startDate = (input.start_date ?? '').trim() || null
  const endDate = (input.end_date ?? '').trim() || null
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return { ok: false, error: 'تاريخ البدء غير صالح.' }
  }
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { ok: false, error: 'تاريخ الانتهاء غير صالح.' }
  }
  const amount =
    input.total_amount_sar === null || input.total_amount_sar === undefined
      ? null
      : Number(input.total_amount_sar)
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
    return { ok: false, error: 'قيمة العقد غير صالحة.' }
  }

  const svc = createSupabaseService()
  const { data, error } = await svc
    .from('dsb_vendor_contracts')
    .insert({
      tenant_id: caller.tenantId,
      vendor_id: input.vendor_id,
      contract_number: (input.contract_number ?? '').trim() || null,
      work_type: (input.work_type ?? '').trim() || null,
      start_date: startDate,
      end_date: endDate,
      total_amount_sar: amount,
      status,
      notes: (input.notes ?? '').trim() || null,
      created_by_user_id: caller.userId,
    })
    .select('id')
    .single()
  if (error || !data) {
    return { ok: false, error: error?.message ?? 'تعذّر إضافة العقد.' }
  }

  revalidatePath(`/app/disbursements/admin/projects/${resolved.vendor.project_id}/vendors`)
  return { ok: true, id: data.id as string }
}

// ---------------------------------------------------------------------------
// updateVendorContract — write roles + project scope. Patch semantics same as
// updateVendor.
// ---------------------------------------------------------------------------

export interface UpdateVendorContractInput {
  id: string
  patch: {
    contract_number?: string | null
    work_type?: string | null
    start_date?: string | null
    end_date?: string | null
    total_amount_sar?: number | null
    status?: 'active' | 'completed' | 'cancelled'
    notes?: string | null
  }
}

async function resolveContractForCaller(
  caller: CallerCtx,
  contractId: string,
): Promise<
  | {
      ok: true
      contract: {
        id: string
        tenant_id: string
        vendor_id: string
        storage_bucket: string | null
        storage_path: string | null
      }
      projectId: string
    }
  | { ok: false; error: string }
> {
  if (!contractId) return { ok: false, error: 'المُعرِّف مطلوب.' }
  const svc = createSupabaseService()
  const { data: contract } = await svc
    .from('dsb_vendor_contracts')
    .select('id, tenant_id, vendor_id, storage_bucket, storage_path')
    .eq('id', contractId)
    .maybeSingle()
  if (!contract || (contract as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'العقد غير موجود.' }
  }
  const c = contract as {
    id: string
    tenant_id: string
    vendor_id: string
    storage_bucket: string | null
    storage_path: string | null
  }
  const vendor = await resolveVendorForCaller(caller, c.vendor_id)
  if (!vendor.ok) return vendor
  return { ok: true, contract: c, projectId: vendor.vendor.project_id }
}

export async function updateVendorContract(
  input: UpdateVendorContractInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!input.id) return { ok: false, error: 'المُعرِّف مطلوب.' }

  const resolved = await resolveContractForCaller(caller, input.id)
  if (!resolved.ok) return resolved
  const guard = await assertCanWriteToProjects(caller, [resolved.projectId])
  if (!guard.ok) return guard

  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input.patch)) {
    if (v === undefined) continue
    if (k === 'status') {
      if (!['active', 'completed', 'cancelled'].includes(v as string)) {
        return { ok: false, error: 'حالة العقد غير صالحة.' }
      }
      patch.status = v
      continue
    }
    if (k === 'total_amount_sar') {
      if (v === null || v === '') {
        patch.total_amount_sar = null
        continue
      }
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, error: 'قيمة العقد غير صالحة.' }
      }
      patch.total_amount_sar = n
      continue
    }
    if (k === 'start_date' || k === 'end_date') {
      if (v === null || v === '') {
        patch[k] = null
        continue
      }
      const s = String(v).trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return { ok: false, error: 'التاريخ غير صالح.' }
      }
      patch[k] = s
      continue
    }
    if (v === null || v === '') {
      patch[k] = null
      continue
    }
    if (typeof v === 'string') {
      patch[k] = v.trim() || null
    } else {
      patch[k] = v
    }
  }
  if (Object.keys(patch).length === 0) return { ok: true }

  const svc = createSupabaseService()
  const { error } = await svc
    .from('dsb_vendor_contracts')
    .update(patch)
    .eq('id', input.id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${resolved.projectId}/vendors`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// deleteVendorContract — owner only.
// ---------------------------------------------------------------------------

export async function deleteVendorContract(
  input: { id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  const own = assertOwner(caller)
  if (!own.ok) return own
  if (!input.id) return { ok: false, error: 'المُعرِّف مطلوب.' }

  const resolved = await resolveContractForCaller(caller, input.id)
  if (!resolved.ok) return resolved

  const svc = createSupabaseService()
  const { error } = await svc
    .from('dsb_vendor_contracts')
    .delete()
    .eq('id', input.id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${resolved.projectId}/vendors`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// PDF storage helpers — mirrors units/actions.ts
// ---------------------------------------------------------------------------

const STORAGE_BUCKET = 'Document submission'
const MAX_CONTRACT_SIZE = 50 * 1024 * 1024 // 50 MB

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180)
}

export interface RequestVendorContractUploadUrlInput {
  vendor_id: string
  filename: string
  size: number
}

export type RequestVendorContractUploadUrlResult =
  | { ok: true; signed_url: string; storage_path: string }
  | { ok: false; error: string }

export async function requestVendorContractUploadUrl(
  input: RequestVendorContractUploadUrlInput,
): Promise<RequestVendorContractUploadUrlResult> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!input.vendor_id) return { ok: false, error: 'المورد مطلوب.' }
  if (!input.size || input.size <= 0) return { ok: false, error: 'حجم الملف غير صالح.' }
  if (input.size > MAX_CONTRACT_SIZE) {
    return { ok: false, error: 'حجم الملف يتجاوز الحد الأقصى (50 ميغابايت).' }
  }

  const resolved = await resolveVendorForCaller(caller, input.vendor_id)
  if (!resolved.ok) return resolved
  const guard = await assertCanWriteToProjects(caller, [resolved.vendor.project_id])
  if (!guard.ok) return guard

  const svc = createSupabaseService()
  const uuid = crypto.randomUUID()
  const safe = sanitizeFilename(input.filename || `contract-${uuid}.pdf`)
  const storagePath = `dsb-vendor-contracts/${caller.tenantId}/${resolved.vendor.project_id}/${resolved.vendor.id}/${uuid}-${safe}`

  const { data, error } = await svc.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath)
  if (error || !data) {
    return { ok: false, error: 'تعذّر إنشاء رابط الرفع.' }
  }
  return { ok: true, signed_url: data.signedUrl, storage_path: data.path ?? storagePath }
}

// ---------------------------------------------------------------------------
// attachContractPdf — write roles + project scope. Called after the client
// PUTs the file to the signed URL. Updates the contract row with storage
// metadata.
// ---------------------------------------------------------------------------

export interface AttachContractPdfInput {
  contract_id: string
  storage_path: string
  filename: string
  size: number
}

export async function attachContractPdf(
  input: AttachContractPdfInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!input.contract_id) return { ok: false, error: 'العقد مطلوب.' }
  if (!input.storage_path) return { ok: false, error: 'مسار الملف مطلوب.' }
  if (!input.size || input.size <= 0) return { ok: false, error: 'حجم الملف غير صالح.' }

  const resolved = await resolveContractForCaller(caller, input.contract_id)
  if (!resolved.ok) return resolved
  const guard = await assertCanWriteToProjects(caller, [resolved.projectId])
  if (!guard.ok) return guard

  const svc = createSupabaseService()
  const { error } = await svc
    .from('dsb_vendor_contracts')
    .update({
      storage_bucket: STORAGE_BUCKET,
      storage_path: input.storage_path,
      filename: sanitizeFilename(input.filename || 'contract.pdf'),
      file_size_bytes: input.size,
    })
    .eq('id', input.contract_id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${resolved.projectId}/vendors`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// signVendorContractPreviewUrl — 60-minute signed URL for opening the PDF.
// Any tenant staff can preview; tenant-isolation enforced by the tenant_id
// equality check.
// ---------------------------------------------------------------------------

export async function signVendorContractPreviewUrl(
  input: { contract_id: string },
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!input.contract_id) return { ok: false, error: 'العقد مطلوب.' }

  const svc = createSupabaseService()
  const { data: contract } = await svc
    .from('dsb_vendor_contracts')
    .select('id, tenant_id, storage_bucket, storage_path')
    .eq('id', input.contract_id)
    .maybeSingle()
  if (!contract || (contract as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'العقد غير موجود.' }
  }
  const c = contract as { storage_bucket: string | null; storage_path: string | null }
  if (!c.storage_path) {
    return { ok: false, error: 'لا يوجد ملف PDF مرفق بهذا العقد.' }
  }

  const { data, error } = await svc.storage
    .from(c.storage_bucket || STORAGE_BUCKET)
    .createSignedUrl(c.storage_path, 3600)
  if (error || !data?.signedUrl) {
    return { ok: false, error: 'تعذّر إنشاء رابط المعاينة.' }
  }
  return { ok: true, url: data.signedUrl }
}
