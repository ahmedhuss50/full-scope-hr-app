'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { fireDsbContractExtract } from '@/lib/n8n/fire-dsb-contract-extract'

// ----------------------------------------------------------------------------
// Units + buyers + contracts — server actions.
//
// Roles:
//   - bulkImportUnitsFromRows / deleteUnit / attachContractToSale : OWNER only
//   - updateUnit / updateSale                                     : WRITE roles
//     (employee | supervisor | owner)
//
// All actions re-verify tenant isolation via the tenant_id column on every
// query — the service client bypasses RLS so we must not skip that check.
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

// ---------------------------------------------------------------------------
// Types shared with the importer client component
// ---------------------------------------------------------------------------

/**
 * One row as parsed from an Excel master-list sheet. `project_id` is resolved
 * client-side (fuzzy-match against dsb_projects.name_ar); rows the user chose
 * to skip are filtered out on the client and never reach this action.
 */
export interface BulkImportUnitRow {
  project_id: string
  unit_number: string
  zone_number?: string | null
  block_number?: string | null
  unit_type?: string | null   // villa | apartment | other
  area_m2?: number | null
  district?: string | null
  city?: string | null
  region?: string | null

  // Sale fields — populated per row from the sheet
  sale_status: 'active' | 'cancelled' | 'cancelled_resold' | 'completed'
  sale_count?: number | null
  buyer_name_ar?: string | null
  buyer_id_type?: 'national' | 'residency' | 'passport' | null
  buyer_id_number?: string | null
  buyer_nationality?: string | null
  buyer_residency_type?: string | null
  buyer_phone?: string | null
  contract_number?: string | null
  contract_type?: string | null
  financing_type?: string | null
  financing_bank?: string | null
  sale_date?: string | null                 // YYYY-MM-DD
  price_before_tax_sar?: number | null
  vat_sar?: number | null
  price_with_vat_sar?: number | null
  delivery_status?: string | null           // delivered | pending | other
  delivery_date?: string | null             // YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// bulkImportUnitsFromRows — owner only
// ---------------------------------------------------------------------------
// Upserts units by (project_id, unit_number); appends one sale row per input
// row. Ensures every referenced project belongs to the caller's tenant before
// touching any table.
// ---------------------------------------------------------------------------

export async function bulkImportUnitsFromRows(
  input: { rows: BulkImportUnitRow[] },
): Promise<
  | { ok: true; units_upserted: number; sales_inserted: number }
  | { ok: false; error: string }
> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  const own = assertOwner(caller)
  if (!own.ok) return own

  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return { ok: false, error: 'لا توجد صفوف للاستيراد.' }
  }

  // Validate row shape.
  const badRows: number[] = []
  const normalized: BulkImportUnitRow[] = input.rows.map((r, i) => {
    const projectId = (r.project_id ?? '').trim()
    const unitNumber = (r.unit_number ?? '').trim()
    if (!projectId || !unitNumber) badRows.push(i + 1)
    return { ...r, project_id: projectId, unit_number: unitNumber }
  })
  if (badRows.length > 0) {
    return {
      ok: false,
      error: `صفوف ناقصة (مشروع أو رقم الوحدة فارغ) في المواضع: ${badRows.slice(0, 20).join(', ')}${badRows.length > 20 ? '…' : ''}`,
    }
  }

  const svc = createSupabaseService()

  // Tenant-isolation: verify every referenced project belongs to caller.
  const uniqueProjectIds = Array.from(new Set(normalized.map((r) => r.project_id)))
  const { data: projRows, error: projErr } = await svc
    .from('dsb_projects')
    .select('id')
    .eq('tenant_id', caller.tenantId)
    .in('id', uniqueProjectIds)
  if (projErr) return { ok: false, error: projErr.message }
  const validProjectIds = new Set(
    ((projRows ?? []) as { id: string }[]).map((r) => r.id),
  )
  const mismatched: number[] = []
  normalized.forEach((r, i) => {
    if (!validProjectIds.has(r.project_id)) mismatched.push(i + 1)
  })
  if (mismatched.length > 0) {
    return {
      ok: false,
      error: `صفوف تشير إلى مشاريع خارج مؤسستك (المواضع: ${mismatched.slice(0, 20).join(', ')}${mismatched.length > 20 ? '…' : ''}).`,
    }
  }

  // ---- Upsert units (by project_id + unit_number) ----
  // We deliberately upsert the spec fields; empty values from the sheet don't
  // clobber existing values because we merge into a "keep existing" policy in
  // the DB via COALESCE-like semantics: pass NULL only if the sheet has no
  // value. This keeps re-imports idempotent even if row order changes.
  //
  // In supabase-js we can't run a per-column COALESCE inside upsert, so we
  // fetch existing rows first, merge in memory, then upsert.

  type SpecKey =
    | 'zone_number'
    | 'block_number'
    | 'unit_type'
    | 'area_m2'
    | 'district'
    | 'city'
    | 'region'

  const unitSpecKeys: SpecKey[] = [
    'zone_number',
    'block_number',
    'unit_type',
    'area_m2',
    'district',
    'city',
    'region',
  ]

  // Group rows by (project_id, unit_number) — first row's spec wins if a
  // later row conflicts (should not happen inside one sheet but defensive).
  const unitBucket = new Map<string, BulkImportUnitRow>()
  for (const r of normalized) {
    const key = `${r.project_id}::${r.unit_number}`
    if (!unitBucket.has(key)) unitBucket.set(key, r)
  }

  // Fetch any pre-existing units to preserve their spec values on nulls.
  const bucketKeys = Array.from(unitBucket.keys())
  type ExistingUnit = { id: string; project_id: string; unit_number: string } & {
    [K in SpecKey]?: unknown
  }
  const existingByKey = new Map<string, ExistingUnit>()
  if (bucketKeys.length > 0) {
    // Chunked select to avoid overly-large IN() lists.
    const CHUNK = 300
    for (let i = 0; i < uniqueProjectIds.length; i += CHUNK) {
      const projSlice = uniqueProjectIds.slice(i, i + CHUNK)
      const { data: existing } = await svc
        .from('dsb_project_units')
        .select(
          'id, project_id, unit_number, zone_number, block_number, unit_type, area_m2, district, city, region',
        )
        .eq('tenant_id', caller.tenantId)
        .in('project_id', projSlice)
      for (const u of (existing ?? []) as ExistingUnit[]) {
        existingByKey.set(`${u.project_id}::${u.unit_number}`, u)
      }
    }
  }

  const unitUpsertRows: Record<string, unknown>[] = []
  for (const [key, r] of unitBucket.entries()) {
    const existing = existingByKey.get(key)
    const row: Record<string, unknown> = {
      tenant_id: caller.tenantId,
      project_id: r.project_id,
      unit_number: r.unit_number,
    }
    for (const k of unitSpecKeys) {
      const fromSheet = (r as unknown as Record<string, unknown>)[k]
      // Prefer the sheet value if present; otherwise keep the existing one.
      const chosen =
        fromSheet !== null && fromSheet !== undefined && fromSheet !== ''
          ? fromSheet
          : existing?.[k] ?? null
      row[k] = chosen ?? null
    }
    unitUpsertRows.push(row)
  }

  const { data: upserted, error: upsertErr } = await svc
    .from('dsb_project_units')
    .upsert(unitUpsertRows, { onConflict: 'project_id,unit_number' })
    .select('id, project_id, unit_number')
  if (upsertErr) return { ok: false, error: upsertErr.message }

  const unitIdByKey = new Map<string, string>()
  for (const u of (upserted ?? []) as { id: string; project_id: string; unit_number: string }[]) {
    unitIdByKey.set(`${u.project_id}::${u.unit_number}`, u.id)
  }

  // ---- Insert sales rows ----
  const salesRows = normalized
    .map((r) => {
      const unitId = unitIdByKey.get(`${r.project_id}::${r.unit_number}`)
      if (!unitId) return null
      return {
        tenant_id: caller.tenantId,
        unit_id: unitId,
        sale_count: r.sale_count ?? 1,
        sale_status: r.sale_status,
        buyer_name_ar: r.buyer_name_ar ?? null,
        buyer_id_type: r.buyer_id_type ?? null,
        buyer_id_number: r.buyer_id_number ?? null,
        buyer_nationality: r.buyer_nationality ?? null,
        buyer_residency_type: r.buyer_residency_type ?? null,
        buyer_phone: r.buyer_phone ?? null,
        contract_number: r.contract_number ?? null,
        contract_type: r.contract_type ?? null,
        financing_type: r.financing_type ?? null,
        financing_bank: r.financing_bank ?? null,
        sale_date: r.sale_date ?? null,
        price_before_tax_sar: r.price_before_tax_sar ?? null,
        vat_sar: r.vat_sar ?? null,
        price_with_vat_sar: r.price_with_vat_sar ?? null,
        delivery_status: r.delivery_status ?? null,
        delivery_date: r.delivery_date ?? null,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  if (salesRows.length > 0) {
    const { error: salesErr } = await svc.from('dsb_unit_sales').insert(salesRows)
    if (salesErr) return { ok: false, error: salesErr.message }
  }

  revalidatePath('/app/disbursements/admin')
  for (const pid of uniqueProjectIds) {
    revalidatePath(`/app/disbursements/admin/projects/${pid}`)
  }

  return {
    ok: true,
    units_upserted: unitUpsertRows.length,
    sales_inserted: salesRows.length,
  }
}

// ---------------------------------------------------------------------------
// updateUnit — write roles
// ---------------------------------------------------------------------------

export interface UpdateUnitInput {
  id: string
  patch: {
    unit_number?: string
    zone_number?: string | null
    block_number?: string | null
    unit_type?: string | null
    area_m2?: number | null
    district?: string | null
    city?: string | null
    region?: string | null
    notes?: string | null
  }
}

export async function updateUnit(
  input: UpdateUnitInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!input.id) return { ok: false, error: 'المُعرِّف مطلوب.' }

  const svc = createSupabaseService()

  // Ownership check.
  const { data: unit } = await svc
    .from('dsb_project_units')
    .select('id, tenant_id, project_id')
    .eq('id', input.id)
    .maybeSingle()
  if (!unit || (unit as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'الوحدة غير موجودة.' }
  }

  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input.patch)) {
    // Allow explicit null to clear.
    if (v === undefined) continue
    patch[k] = v === '' ? null : v
  }
  if (Object.keys(patch).length === 0) return { ok: true }

  const { error } = await svc
    .from('dsb_project_units')
    .update(patch)
    .eq('id', input.id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  const projectId = (unit as { project_id: string }).project_id
  revalidatePath(`/app/disbursements/admin/projects/${projectId}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// updateSale — write roles
// ---------------------------------------------------------------------------

export interface UpdateSaleInput {
  id: string
  patch: {
    sale_status?: 'active' | 'cancelled' | 'cancelled_resold' | 'completed'
    sale_count?: number | null
    buyer_name_ar?: string | null
    buyer_id_type?: 'national' | 'residency' | 'passport' | null
    buyer_id_number?: string | null
    buyer_nationality?: string | null
    buyer_residency_type?: string | null
    buyer_phone?: string | null
    contract_number?: string | null
    contract_type?: string | null
    financing_type?: string | null
    financing_bank?: string | null
    sale_date?: string | null
    price_before_tax_sar?: number | null
    vat_sar?: number | null
    price_with_vat_sar?: number | null
    delivery_status?: string | null
    delivery_date?: string | null
  }
}

export async function updateSale(
  input: UpdateSaleInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!input.id) return { ok: false, error: 'المُعرِّف مطلوب.' }

  const svc = createSupabaseService()

  // Ownership check + capture unit_id → project_id for revalidation.
  const { data: sale } = await svc
    .from('dsb_unit_sales')
    .select('id, tenant_id, unit_id')
    .eq('id', input.id)
    .maybeSingle()
  if (!sale || (sale as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'سجل البيع غير موجود.' }
  }

  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input.patch)) {
    if (v === undefined) continue
    patch[k] = v === '' ? null : v
  }
  if (Object.keys(patch).length === 0) return { ok: true }

  const { error } = await svc
    .from('dsb_unit_sales')
    .update(patch)
    .eq('id', input.id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  // Revalidate the project page — look up project via the unit row.
  const unitId = (sale as { unit_id: string }).unit_id
  const { data: unit } = await svc
    .from('dsb_project_units')
    .select('project_id')
    .eq('id', unitId)
    .maybeSingle()
  if (unit) {
    revalidatePath(`/app/disbursements/admin/projects/${(unit as { project_id: string }).project_id}`)
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// deleteUnit — owner only. Cascades to sales + contracts (contracts.sale_id
// / contracts.unit_id are ON DELETE SET NULL so contract *rows* survive with
// their storage_path intact; the cascade on dsb_unit_sales deletes sales).
// ---------------------------------------------------------------------------

export async function deleteUnit(
  input: { id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  const own = assertOwner(caller)
  if (!own.ok) return own
  if (!input.id) return { ok: false, error: 'المُعرِّف مطلوب.' }

  const svc = createSupabaseService()

  const { data: unit } = await svc
    .from('dsb_project_units')
    .select('id, tenant_id, project_id')
    .eq('id', input.id)
    .maybeSingle()
  if (!unit || (unit as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'الوحدة غير موجودة.' }
  }

  const { error } = await svc
    .from('dsb_project_units')
    .delete()
    .eq('id', input.id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  const projectId = (unit as { project_id: string }).project_id
  revalidatePath(`/app/disbursements/admin/projects/${projectId}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// attachContractToSale — owner only. Manual linkage for `no_match` contracts.
// ---------------------------------------------------------------------------

export async function attachContractToSale(
  input: { contract_id: string; sale_id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  const own = assertOwner(caller)
  if (!own.ok) return own
  if (!input.contract_id || !input.sale_id) {
    return { ok: false, error: 'بيانات ناقصة.' }
  }

  const svc = createSupabaseService()

  // Verify both belong to the same tenant.
  const [contractRes, saleRes] = await Promise.all([
    svc
      .from('dsb_unit_contracts')
      .select('id, tenant_id')
      .eq('id', input.contract_id)
      .maybeSingle(),
    svc
      .from('dsb_unit_sales')
      .select('id, tenant_id, unit_id')
      .eq('id', input.sale_id)
      .maybeSingle(),
  ])
  const contract = contractRes.data as { id: string; tenant_id: string } | null
  const sale = saleRes.data as { id: string; tenant_id: string; unit_id: string } | null
  if (!contract || contract.tenant_id !== caller.tenantId) {
    return { ok: false, error: 'العقد غير موجود.' }
  }
  if (!sale || sale.tenant_id !== caller.tenantId) {
    return { ok: false, error: 'سجل البيع غير موجود.' }
  }

  const { error } = await svc
    .from('dsb_unit_contracts')
    .update({
      sale_id: sale.id,
      unit_id: sale.unit_id,
      extraction_status: 'matched',
      // Manual attach → confidence 1 (human-verified)
      matched_confidence: 1,
    })
    .eq('id', contract.id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  // Revalidate the project page for the unit.
  const { data: unit } = await svc
    .from('dsb_project_units')
    .select('project_id')
    .eq('id', sale.unit_id)
    .maybeSingle()
  if (unit) {
    revalidatePath(`/app/disbursements/admin/projects/${(unit as { project_id: string }).project_id}`)
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// requestContractUploadUrl — write roles. Client uploads directly to storage
// via the signed URL, then calls registerContract to insert the DB row.
// ---------------------------------------------------------------------------

const STORAGE_BUCKET = 'Document submission'
const MAX_CONTRACT_SIZE = 50 * 1024 * 1024 // 50 MB

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180)
}

export interface RequestContractUploadUrlInput {
  project_id: string
  filename: string
  size: number
}

export type RequestContractUploadUrlResult =
  | { ok: true; signed_url: string; storage_path: string }
  | { ok: false; error: string }

export async function requestContractUploadUrl(
  input: RequestContractUploadUrlInput,
): Promise<RequestContractUploadUrlResult> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  const own = assertOwner(caller)
  if (!own.ok) return own

  if (!input.project_id) return { ok: false, error: 'المشروع مطلوب.' }
  if (!input.size || input.size <= 0) return { ok: false, error: 'حجم الملف غير صالح.' }
  if (input.size > MAX_CONTRACT_SIZE) {
    return { ok: false, error: 'حجم الملف يتجاوز الحد الأقصى (50 ميغابايت).' }
  }

  const svc = createSupabaseService()
  const { data: project } = await svc
    .from('dsb_projects')
    .select('id, tenant_id')
    .eq('id', input.project_id)
    .eq('tenant_id', caller.tenantId)
    .maybeSingle()
  if (!project) return { ok: false, error: 'المشروع غير موجود.' }

  const uuid = crypto.randomUUID()
  const safe = sanitizeFilename(input.filename || `contract-${uuid}.pdf`)
  const storagePath = `dsb-contracts/${caller.tenantId}/${input.project_id}/${uuid}-${safe}`

  const { data, error } = await svc.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath)
  if (error || !data) {
    return { ok: false, error: 'تعذّر إنشاء رابط الرفع.' }
  }
  return { ok: true, signed_url: data.signedUrl, storage_path: data.path ?? storagePath }
}

// ---------------------------------------------------------------------------
// registerContract — write roles. Inserts the pending row post-upload; the
// client then fire-and-forget POSTs to /api/dsb-contract-extract.
// ---------------------------------------------------------------------------

export interface RegisterContractInput {
  project_id: string
  storage_path: string
  filename: string
  size: number
}

export type RegisterContractResult =
  | { ok: true; contract_id: string }
  | { ok: false; error: string }

export async function registerContract(
  input: RegisterContractInput,
): Promise<RegisterContractResult> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  const own = assertOwner(caller)
  if (!own.ok) return own

  const svc = createSupabaseService()
  const { data: project } = await svc
    .from('dsb_projects')
    .select('id, tenant_id')
    .eq('id', input.project_id)
    .eq('tenant_id', caller.tenantId)
    .maybeSingle()
  if (!project) return { ok: false, error: 'المشروع غير موجود.' }

  const { data: row, error } = await svc
    .from('dsb_unit_contracts')
    .insert({
      tenant_id: caller.tenantId,
      uploaded_by_user_id: caller.userId,
      storage_path: input.storage_path,
      storage_bucket: STORAGE_BUCKET,
      filename: sanitizeFilename(input.filename),
      file_size_bytes: input.size,
      extraction_status: 'pending',
    })
    .select('id')
    .single()
  if (error || !row) {
    return { ok: false, error: error?.message ?? 'فشل تسجيل العقد.' }
  }

  revalidatePath(`/app/disbursements/admin/projects/${input.project_id}`)
  return { ok: true, contract_id: row.id as string }
}

// ---------------------------------------------------------------------------
// triggerContractExtraction — thin wrapper for the client. Fires the
// /api/dsb-contract-extract route without waiting for the AI to finish;
// separates the upload UX from the extraction latency.
// ---------------------------------------------------------------------------

export async function triggerContractExtraction(
  input: { contract_id: string; project_id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  const own = assertOwner(caller)
  if (!own.ok) return own

  const svc = createSupabaseService()
  // Verify the contract belongs to this tenant before firing.
  const { data: contract } = await svc
    .from('dsb_unit_contracts')
    .select('id, tenant_id')
    .eq('id', input.contract_id)
    .maybeSingle()
  if (!contract || (contract as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'العقد غير موجود.' }
  }

  // Fire-and-forget — do NOT await; we want the UI to return immediately.
  fireDsbContractExtract({
    contract_id: input.contract_id,
    project_id: input.project_id,
  }).catch((e) => {
    console.error('[triggerContractExtraction] fire failed', e)
  })

  return { ok: true }
}

// ---------------------------------------------------------------------------
// signContractPreviewUrl — return a short-lived signed URL for opening the
// PDF in a new tab. Owner-only, tenant-scoped.
// ---------------------------------------------------------------------------

export async function signContractPreviewUrl(
  input: { contract_id: string },
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  const own = assertOwner(caller)
  if (!own.ok) return own

  const svc = createSupabaseService()
  const { data: contract } = await svc
    .from('dsb_unit_contracts')
    .select('id, tenant_id, storage_bucket, storage_path')
    .eq('id', input.contract_id)
    .maybeSingle()
  if (!contract || (contract as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'العقد غير موجود.' }
  }

  const c = contract as { storage_bucket: string; storage_path: string }
  const { data, error } = await svc.storage
    .from(c.storage_bucket || STORAGE_BUCKET)
    .createSignedUrl(c.storage_path, 300)
  if (error || !data?.signedUrl) {
    return { ok: false, error: 'تعذّر إنشاء رابط المعاينة.' }
  }
  return { ok: true, url: data.signedUrl }
}
