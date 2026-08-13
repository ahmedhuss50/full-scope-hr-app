'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { fireDsbContractExtract } from '@/lib/n8n/fire-dsb-contract-extract'
import { assignedProjectIds } from '@/lib/dsb/access'

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

/**
 * Verify the caller can act on every project in `projectIds`.
 *
 *   - owner       → always allowed
 *   - supervisor  → must have every id in their assigned-projects list
 *   - employee    → same rule as supervisor
 *   - other role  → rejected up-front (viewer / deliverer can't add)
 *
 * Used by the bulk-import add flows (task #185) so an employee/supervisor
 * can import units/buyers/contracts scoped to their designated project(s),
 * while still refusing any row that references a project outside their scope.
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
  if (allowed === null) return { ok: true }   // shouldn't happen (owner branch)
  const outOfScope = uniq.filter((id) => !allowed.includes(id))
  if (outOfScope.length > 0) {
    return {
      ok: false,
      error: 'الاستيراد يحتوي مشاريع خارج نطاق صلاحيتك — أزل الصفوف التي تخص مشاريع أخرى ثم أعد المحاولة.',
    }
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

  // Financial tracking (migration 055). All optional — many older files
  // won't ship every field, and rows without them should still import.
  retention_percentage?: number | null
  installment_number?: number | null
  total_collected_before_tax_sar?: number | null
  total_collected_with_tax_sar?: number | null
  remaining_amount_sar?: number | null
  collection_percentage?: number | null
  price_per_meter_sar?: number | null
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

  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return { ok: false, error: 'لا توجد صفوف للاستيراد.' }
  }
  // Task #185: allow assigned staff.
  const guard = await assertCanWriteToProjects(caller, input.rows.map((r) => r.project_id))
  if (!guard.ok) return guard

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
        // Financial tracking (055).
        retention_percentage: r.retention_percentage ?? null,
        installment_number: r.installment_number ?? null,
        total_collected_before_tax_sar: r.total_collected_before_tax_sar ?? null,
        total_collected_with_tax_sar: r.total_collected_with_tax_sar ?? null,
        remaining_amount_sar: r.remaining_amount_sar ?? null,
        collection_percentage: r.collection_percentage ?? null,
        price_per_meter_sar: r.price_per_meter_sar ?? null,
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
// checkExistingUnits — owner only. Used by the buyers/contracts importers'
// preview to flag rows whose (project_id, unit_number) doesn't exist yet in
// dsb_project_units, so the UI can render an amber warning next to them.
//
// Returns the SUBSET of the input pairs that DO exist. Any missing pair is
// implicitly "not found". Tenant-scoped.
// ---------------------------------------------------------------------------

export async function checkExistingUnits(
  input: { pairs: Array<{ project_id: string; unit_number: string }> },
): Promise<
  | { ok: true; existing: Array<{ project_id: string; unit_number: string }> }
  | { ok: false; error: string }
> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  const pairs = Array.isArray(input.pairs) ? input.pairs : []
  if (pairs.length === 0) return { ok: true, existing: [] }
  // Task #185: allow assigned staff. Scope-check by every project referenced
  // in the pairs — if any is outside the caller's scope we reject up-front.
  const guard = await assertCanWriteToProjects(
    caller,
    pairs.map((p) => (p.project_id ?? '').trim()).filter(Boolean),
  )
  if (!guard.ok) return guard

  // Group by project so we can use one IN() per project instead of a
  // per-pair query. Also validates tenant-scoping on the projects side.
  const byProject = new Map<string, Set<string>>()
  for (const p of pairs) {
    const pid = (p.project_id ?? '').trim()
    const un = (p.unit_number ?? '').trim()
    if (!pid || !un) continue
    const set = byProject.get(pid) ?? new Set<string>()
    set.add(un)
    byProject.set(pid, set)
  }
  if (byProject.size === 0) return { ok: true, existing: [] }

  const svc = createSupabaseService()

  // Verify all project ids belong to caller's tenant in one query.
  const projectIds = Array.from(byProject.keys())
  const { data: projRows, error: projErr } = await svc
    .from('dsb_projects')
    .select('id')
    .eq('tenant_id', caller.tenantId)
    .in('id', projectIds)
  if (projErr) return { ok: false, error: projErr.message }
  const validProjectIds = new Set(((projRows ?? []) as { id: string }[]).map((r) => r.id))

  const existing: Array<{ project_id: string; unit_number: string }> = []
  for (const [pid, unitSet] of byProject.entries()) {
    if (!validProjectIds.has(pid)) continue
    const units = Array.from(unitSet)
    // Chunk very large lists to stay under PostgREST URL length limits.
    const CHUNK = 200
    for (let i = 0; i < units.length; i += CHUNK) {
      const slice = units.slice(i, i + CHUNK)
      const { data: found, error } = await svc
        .from('dsb_project_units')
        .select('project_id, unit_number')
        .eq('tenant_id', caller.tenantId)
        .eq('project_id', pid)
        .in('unit_number', slice)
      if (error) return { ok: false, error: error.message }
      for (const r of (found ?? []) as { project_id: string; unit_number: string }[]) {
        existing.push(r)
      }
    }
  }
  return { ok: true, existing }
}

// ---------------------------------------------------------------------------
// bulkImportUnitsOnly — owner only. Focused importer #1 of 3.
// ---------------------------------------------------------------------------
// Upserts JUST the unit-spec fields into dsb_project_units. Leaves
// dsb_unit_sales untouched. Use when the owner wants to correct/enrich
// specs (block, zone, area, district) without changing buyer/contract data.
//
// Match key: (project_id, unit_number). Rows missing unit_number are
// silently skipped and reported back to the client.
// ---------------------------------------------------------------------------

export interface BulkImportUnitOnlyRow {
  project_id: string
  unit_number: string
  zone_number?: string | null
  block_number?: string | null
  // Widened to string: parser preserves whatever the Excel says (e.g.
  // "شقة تجارية", "دوبلكس", "استوديو") instead of forcing to a 3-value enum.
  unit_type?: string | null
  area_m2?: number | null
  district?: string | null
  city?: string | null
  region?: string | null
}

export async function bulkImportUnitsOnly(
  input: { rows: BulkImportUnitOnlyRow[] },
): Promise<
  | { ok: true; upsertedUnits: number; skippedRows: number }
  | { ok: false; error: string }
> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }

  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return { ok: false, error: 'لا توجد صفوف للاستيراد.' }
  }
  // Task #185: allow assigned staff.
  const guard = await assertCanWriteToProjects(caller, input.rows.map((r) => r.project_id))
  if (!guard.ok) return guard

  // Normalize + partition into usable vs. skipped.
  const usable: BulkImportUnitOnlyRow[] = []
  let skipped = 0
  for (const r of input.rows) {
    const projectId = (r.project_id ?? '').trim()
    const unitNumber = (r.unit_number ?? '').trim()
    if (!projectId || !unitNumber) {
      skipped++
      continue
    }
    usable.push({ ...r, project_id: projectId, unit_number: unitNumber })
  }
  if (usable.length === 0) {
    return { ok: false, error: 'كل الصفوف تفتقد رقم الوحدة أو المشروع.' }
  }

  const svc = createSupabaseService()

  // Tenant-isolation check up-front.
  const uniqueProjectIds = Array.from(new Set(usable.map((r) => r.project_id)))
  const { data: projRows, error: projErr } = await svc
    .from('dsb_projects')
    .select('id')
    .eq('tenant_id', caller.tenantId)
    .in('id', uniqueProjectIds)
  if (projErr) return { ok: false, error: projErr.message }
  const validProjectIds = new Set(
    ((projRows ?? []) as { id: string }[]).map((r) => r.id),
  )
  const mismatched = usable
    .map((r, i) => (validProjectIds.has(r.project_id) ? -1 : i + 1))
    .filter((x) => x > 0)
  if (mismatched.length > 0) {
    return {
      ok: false,
      error: `صفوف تشير إلى مشاريع خارج مؤسستك (المواضع: ${mismatched.slice(0, 20).join(', ')}${mismatched.length > 20 ? '…' : ''}).`,
    }
  }

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

  // Dedupe by (project_id, unit_number) — first row wins.
  const bucket = new Map<string, BulkImportUnitOnlyRow>()
  for (const r of usable) {
    const key = `${r.project_id}::${r.unit_number}`
    if (!bucket.has(key)) bucket.set(key, r)
  }

  // Fetch existing to preserve non-null spec fields when the sheet is empty.
  type ExistingUnit = { project_id: string; unit_number: string } & {
    [K in SpecKey]?: unknown
  }
  const existingByKey = new Map<string, ExistingUnit>()
  const CHUNK = 300
  for (let i = 0; i < uniqueProjectIds.length; i += CHUNK) {
    const slice = uniqueProjectIds.slice(i, i + CHUNK)
    const { data: existing } = await svc
      .from('dsb_project_units')
      .select(
        'project_id, unit_number, zone_number, block_number, unit_type, area_m2, district, city, region',
      )
      .eq('tenant_id', caller.tenantId)
      .in('project_id', slice)
    for (const u of (existing ?? []) as ExistingUnit[]) {
      existingByKey.set(`${u.project_id}::${u.unit_number}`, u)
    }
  }

  const upsertRows: Record<string, unknown>[] = []
  for (const [key, r] of bucket.entries()) {
    const existing = existingByKey.get(key)
    const row: Record<string, unknown> = {
      tenant_id: caller.tenantId,
      project_id: r.project_id,
      unit_number: r.unit_number,
    }
    for (const k of unitSpecKeys) {
      const fromSheet = (r as unknown as Record<string, unknown>)[k]
      const chosen =
        fromSheet !== null && fromSheet !== undefined && fromSheet !== ''
          ? fromSheet
          : existing?.[k] ?? null
      row[k] = chosen ?? null
    }
    upsertRows.push(row)
  }

  const { error: upsertErr } = await svc
    .from('dsb_project_units')
    .upsert(upsertRows, { onConflict: 'project_id,unit_number' })
  if (upsertErr) return { ok: false, error: upsertErr.message }

  revalidatePath('/app/disbursements/admin')
  for (const pid of uniqueProjectIds) {
    revalidatePath(`/app/disbursements/admin/projects/${pid}`)
  }
  return {
    ok: true,
    upsertedUnits: upsertRows.length,
    skippedRows: skipped,
  }
}

// ---------------------------------------------------------------------------
// bulkImportBuyersFromRows — owner only. Focused importer #2 of 3.
// ---------------------------------------------------------------------------
// Match each row by (project_id, unit_number) → dsb_project_units.id. Then
// for that unit, find the ACTIVE dsb_unit_sales row (sale_status='active').
//   - If exists → UPDATE buyer fields.
//   - If missing → INSERT a fresh active sale row with just the buyer fields.
// Rows whose unit doesn't exist yet are returned in `unmatched` so the UI
// can surface them; those rows must be created via the units-only importer.
// ---------------------------------------------------------------------------

export interface BulkImportBuyerRow {
  project_id: string
  unit_number: string
  sale_count?: number | null
  buyer_name_ar?: string | null
  buyer_id_type?: 'national' | 'residency' | 'passport' | null
  buyer_id_number?: string | null
  buyer_nationality?: string | null
  buyer_residency_type?: string | null
  buyer_phone?: string | null
}

export interface UnmatchedRowRef {
  project_id: string
  unit_number: string
}

export async function bulkImportBuyersFromRows(
  input: { rows: BulkImportBuyerRow[] },
): Promise<
  | {
      ok: true
      updatedSales: number
      insertedSales: number
      unmatched: UnmatchedRowRef[]
      skippedRows: number
    }
  | { ok: false; error: string }
> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }

  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return { ok: false, error: 'لا توجد صفوف للاستيراد.' }
  }
  // Task #185: allow assigned staff.
  const guard = await assertCanWriteToProjects(caller, input.rows.map((r) => r.project_id))
  if (!guard.ok) return guard

  // Normalize + drop rows missing the match key.
  const usable: BulkImportBuyerRow[] = []
  let skipped = 0
  for (const r of input.rows) {
    const projectId = (r.project_id ?? '').trim()
    const unitNumber = (r.unit_number ?? '').trim()
    if (!projectId || !unitNumber) {
      skipped++
      continue
    }
    usable.push({ ...r, project_id: projectId, unit_number: unitNumber })
  }
  if (usable.length === 0) {
    return { ok: false, error: 'كل الصفوف تفتقد رقم الوحدة أو المشروع.' }
  }

  const svc = createSupabaseService()

  // Tenant-isolation.
  const uniqueProjectIds = Array.from(new Set(usable.map((r) => r.project_id)))
  const { data: projRows, error: projErr } = await svc
    .from('dsb_projects')
    .select('id')
    .eq('tenant_id', caller.tenantId)
    .in('id', uniqueProjectIds)
  if (projErr) return { ok: false, error: projErr.message }
  const validProjectIds = new Set(
    ((projRows ?? []) as { id: string }[]).map((r) => r.id),
  )
  const mismatched = usable
    .map((r, i) => (validProjectIds.has(r.project_id) ? -1 : i + 1))
    .filter((x) => x > 0)
  if (mismatched.length > 0) {
    return {
      ok: false,
      error: `صفوف تشير إلى مشاريع خارج مؤسستك (المواضع: ${mismatched.slice(0, 20).join(', ')}${mismatched.length > 20 ? '…' : ''}).`,
    }
  }

  // Load ALL units for these projects. Chunked to be safe.
  type UnitLite = { id: string; project_id: string; unit_number: string }
  const unitByKey = new Map<string, UnitLite>()
  const CHUNK = 300
  for (let i = 0; i < uniqueProjectIds.length; i += CHUNK) {
    const slice = uniqueProjectIds.slice(i, i + CHUNK)
    const { data: units } = await svc
      .from('dsb_project_units')
      .select('id, project_id, unit_number')
      .eq('tenant_id', caller.tenantId)
      .in('project_id', slice)
    for (const u of (units ?? []) as UnitLite[]) {
      unitByKey.set(`${u.project_id}::${u.unit_number}`, u)
    }
  }

  // Partition rows: matched (unit exists) vs unmatched.
  const matched: Array<{ row: BulkImportBuyerRow; unit: UnitLite }> = []
  const unmatched: UnmatchedRowRef[] = []
  for (const r of usable) {
    const u = unitByKey.get(`${r.project_id}::${r.unit_number}`)
    if (!u) {
      unmatched.push({ project_id: r.project_id, unit_number: r.unit_number })
      continue
    }
    matched.push({ row: r, unit: u })
  }

  if (matched.length === 0) {
    return {
      ok: true,
      updatedSales: 0,
      insertedSales: 0,
      unmatched,
      skippedRows: skipped,
    }
  }

  // Load existing active sales for matched units (one query).
  const unitIds = Array.from(new Set(matched.map((m) => m.unit.id)))
  type SaleLite = { id: string; unit_id: string }
  const activeSaleByUnitId = new Map<string, SaleLite>()
  for (let i = 0; i < unitIds.length; i += CHUNK) {
    const slice = unitIds.slice(i, i + CHUNK)
    const { data: sales } = await svc
      .from('dsb_unit_sales')
      .select('id, unit_id')
      .eq('tenant_id', caller.tenantId)
      .in('unit_id', slice)
      .eq('sale_status', 'active')
    for (const s of (sales ?? []) as SaleLite[]) {
      // First active sale per unit wins; ties shouldn't happen in practice.
      if (!activeSaleByUnitId.has(s.unit_id)) activeSaleByUnitId.set(s.unit_id, s)
    }
  }

  const buyerFieldKeys = [
    'sale_count',
    'buyer_name_ar',
    'buyer_id_type',
    'buyer_id_number',
    'buyer_nationality',
    'buyer_residency_type',
    'buyer_phone',
  ] as const

  // Partition matched → update vs insert.
  const toUpdate: Array<{ saleId: string; patch: Record<string, unknown> }> = []
  const toInsert: Record<string, unknown>[] = []

  // Dedupe by unit_id — last row for a given unit wins on updates (they
  // typically arrive in file order, so the last is the freshest).
  const rowByUnitId = new Map<string, BulkImportBuyerRow>()
  const unitById = new Map<string, UnitLite>()
  for (const { row, unit } of matched) {
    rowByUnitId.set(unit.id, row)
    unitById.set(unit.id, unit)
  }

  for (const [unitId, row] of rowByUnitId.entries()) {
    const patch: Record<string, unknown> = {}
    for (const k of buyerFieldKeys) {
      const v = (row as unknown as Record<string, unknown>)[k]
      if (v !== undefined) patch[k] = v === '' ? null : v
    }
    const existingSale = activeSaleByUnitId.get(unitId)
    if (existingSale) {
      if (Object.keys(patch).length > 0) {
        toUpdate.push({ saleId: existingSale.id, patch })
      }
    } else {
      // Fresh active sale — copy in the buyer fields plus defaults.
      toInsert.push({
        tenant_id: caller.tenantId,
        unit_id: unitId,
        sale_count: row.sale_count ?? 1,
        sale_status: 'active',
        buyer_name_ar: row.buyer_name_ar ?? null,
        buyer_id_type: row.buyer_id_type ?? null,
        buyer_id_number: row.buyer_id_number ?? null,
        buyer_nationality: row.buyer_nationality ?? null,
        buyer_residency_type: row.buyer_residency_type ?? null,
        buyer_phone: row.buyer_phone ?? null,
      })
    }
  }

  // Apply updates one-by-one (no bulk UPDATE by-id in supabase-js). N stays
  // in the low hundreds so this is acceptable; if it becomes hot we can move
  // to a stored procedure.
  let updated = 0
  for (const { saleId, patch } of toUpdate) {
    const { error } = await svc
      .from('dsb_unit_sales')
      .update(patch)
      .eq('id', saleId)
      .eq('tenant_id', caller.tenantId)
    if (error) return { ok: false, error: error.message }
    updated++
  }

  let inserted = 0
  if (toInsert.length > 0) {
    const { error } = await svc.from('dsb_unit_sales').insert(toInsert)
    if (error) return { ok: false, error: error.message }
    inserted = toInsert.length
  }

  revalidatePath('/app/disbursements/admin')
  for (const pid of uniqueProjectIds) {
    revalidatePath(`/app/disbursements/admin/projects/${pid}`)
  }
  return {
    ok: true,
    updatedSales: updated,
    insertedSales: inserted,
    unmatched,
    skippedRows: skipped,
  }
}

// ---------------------------------------------------------------------------
// linkSalesToUnitsForProject — internal helper (not a server action).
// ---------------------------------------------------------------------------
// After contracts are imported, some sales have unit_id=null because the
// exact-match at import time didn't find a corresponding unit_number.
//
// This helper:
//   1. Fetches every unlinked sale in the project (unit_number_raw NOT null)
//   2. Loads every unit in the project
//   3. Pass 1: exact-match + normalized-match (strip tatweel, spaces, common
//      Arabic prefixes like "فيلا"/"شقة")
//   4. Pass 2: (optional) Claude call for the leftovers — one API call for
//      the whole batch, not per row
//   5. Updates matched sales, respecting the check constraints from mig 057
//
// Called from bulkImportContractsFromRows (auto-link on import) and from
// /api/dsb-link-sales-to-units (button-triggered re-link).
// ---------------------------------------------------------------------------
export async function linkSalesToUnitsForProject(input: {
  tenantId: string
  projectId: string
  useAi?: boolean // defaults to true — worth ~$0.001/project for the fuzzy pass
}): Promise<{ linkedCount: number; remaining: number; aiUsed: boolean }> {
  const svc = createSupabaseService()
  const useAi = input.useAi !== false

  // Fetch unlinked sales in this project.
  const { data: salesData } = await svc
    .from('dsb_unit_sales')
    .select('id, unit_number_raw')
    .eq('tenant_id', input.tenantId)
    .eq('project_id', input.projectId)
    .is('unit_id', null)
  const unlinked = ((salesData ?? []) as Array<{
    id: string
    unit_number_raw: string | null
  }>).filter((s) => (s.unit_number_raw ?? '').trim().length > 0)

  if (unlinked.length === 0) {
    return { linkedCount: 0, remaining: 0, aiUsed: false }
  }

  // Load all units in the project.
  const { data: unitsData } = await svc
    .from('dsb_project_units')
    .select('id, unit_number')
    .eq('tenant_id', input.tenantId)
    .eq('project_id', input.projectId)
  const units = ((unitsData ?? []) as Array<{
    id: string
    unit_number: string | null
  }>).filter((u) => (u.unit_number ?? '').trim().length > 0)

  if (units.length === 0) {
    return { linkedCount: 0, remaining: unlinked.length, aiUsed: false }
  }

  // Build lookup maps for pass 1.
  const normalize = (s: string): string =>
    s
      .replace(/[ـ]/g, '')           // strip tatweel
      .replace(/\s+/g, '')           // strip whitespace
      .replace(/[.,\-_/]/g, '')      // strip common punctuation
      .toLowerCase()
      .trim()
  const stripArabicPrefix = (s: string): string =>
    s
      .replace(/^(فيلا|شقه|شقة|قطعه|قطعة|وحده|وحدة)/i, '')
      .trim()

  const exactByRaw = new Map<string, string>()      // unit_number → unit.id
  const exactByNorm = new Map<string, string>()     // normalized → unit.id
  const exactByStripped = new Map<string, string>() // stripped-prefix normalized → unit.id
  for (const u of units) {
    exactByRaw.set(u.unit_number!.trim(), u.id)
    exactByNorm.set(normalize(u.unit_number!), u.id)
    exactByStripped.set(normalize(stripArabicPrefix(u.unit_number!)), u.id)
  }

  // Pass 1: exact / normalized / stripped-prefix match.
  const linkNow: Array<{ saleId: string; unitId: string }> = []
  const stillUnmatched: typeof unlinked = []
  for (const s of unlinked) {
    const raw = s.unit_number_raw!.trim()
    const hit =
      exactByRaw.get(raw) ??
      exactByNorm.get(normalize(raw)) ??
      exactByStripped.get(normalize(stripArabicPrefix(raw)))
    if (hit) {
      linkNow.push({ saleId: s.id, unitId: hit })
    } else {
      stillUnmatched.push(s)
    }
  }

  // Pass 2: Claude for the remaining fuzzy cases (small batch — one call).
  let aiUsed = false
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (useAi && apiKey && stillUnmatched.length > 0 && units.length <= 500) {
    // Cap on units — for very large projects (>500 units) the prompt would
    // get too long. In that case we just skip AI; exact match is what runs.
    aiUsed = true
    try {
      const model = process.env.DSB_MAP_COLUMNS_MODEL || 'claude-haiku-4-5-20251001'
      const body = {
        model,
        max_tokens: 4000,
        temperature: 0,
        system: [
          {
            type: 'text',
            text: `You match "raw" unit identifiers coming from an Arabic real-estate contracts Excel to the canonical unit numbers stored in our database. The raws are often variants: "فيلا 12" ↔ "V-12", "١٠٥" ↔ "105", "01-01-0049-0000000001" ↔ "1" or similar codes. Return ONE JSON object with a "matches" array. Each item: { "raw_id": string, "unit_id": string|null } where raw_id is the input sale.id and unit_id is the best-matching unit.id or null if no confident match. Only match when you are 90%+ confident.`,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  `Project units:\n` +
                  JSON.stringify(units) +
                  `\n\nUnlinked sales (each with raw unit number):\n` +
                  JSON.stringify(
                    stillUnmatched.map((s) => ({ id: s.id, raw: s.unit_number_raw })),
                  ) +
                  `\n\nReturn JSON only.`,
              },
            ],
          },
        ],
      }
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      })
      if (resp.ok) {
        const json = (await resp.json()) as {
          content?: Array<{ type: string; text?: string }>
        }
        const text = (json.content ?? []).find((b) => b.type === 'text')?.text ?? ''
        // Extract JSON object.
        const first = text.indexOf('{')
        const last = text.lastIndexOf('}')
        if (first >= 0 && last > first) {
          const parsed = JSON.parse(text.slice(first, last + 1)) as {
            matches?: Array<{ raw_id?: string; unit_id?: string | null }>
          }
          const matches = Array.isArray(parsed.matches) ? parsed.matches : []
          const validUnitIds = new Set(units.map((u) => u.id))
          for (const m of matches) {
            if (
              typeof m.raw_id === 'string' &&
              typeof m.unit_id === 'string' &&
              validUnitIds.has(m.unit_id)
            ) {
              linkNow.push({ saleId: m.raw_id, unitId: m.unit_id })
            }
          }
        }
      }
    } catch (err) {
      console.error('[linkSalesToUnitsForProject] AI pass failed', err)
      // Non-fatal — Pass 1 links still get written.
    }
  }

  // Apply the links.
  let linkedCount = 0
  for (const { saleId, unitId } of linkNow) {
    const { error } = await svc
      .from('dsb_unit_sales')
      .update({ unit_id: unitId })
      .eq('id', saleId)
      .eq('tenant_id', input.tenantId)
    if (!error) linkedCount += 1
  }

  return {
    linkedCount,
    remaining: unlinked.length - linkedCount,
    aiUsed,
  }
}

// ---------------------------------------------------------------------------
// bulkImportContractsFromRows — owner only. Focused importer #3 of 3.
// ---------------------------------------------------------------------------
// Now insert-then-link: rows insert with unit_id=null when no exact-match
// unit exists; the linker (above) runs after all inserts and attaches
// unit_id to any sales it can identify. Rows are never rejected outright.
// ---------------------------------------------------------------------------

export interface BulkImportContractRow {
  project_id: string
  unit_number: string
  contract_number?: string | null
  contract_type?: string | null
  financing_type?: string | null
  financing_bank?: string | null
  sale_date?: string | null
  price_before_tax_sar?: number | null
  vat_sar?: number | null
  price_with_vat_sar?: number | null
  delivery_status?: 'delivered' | 'pending' | 'other' | null
  delivery_date?: string | null

  // Financial tracking (migration 055). All optional.
  retention_percentage?: number | null
  installment_number?: number | null
  total_collected_before_tax_sar?: number | null
  total_collected_with_tax_sar?: number | null
  remaining_amount_sar?: number | null
  collection_percentage?: number | null
  price_per_meter_sar?: number | null

  // Buyer fields (optional — filled when the Excel combines
  // buyer + contract per row, aka "عقود المشترين"). Post-migration 058
  // sales can exist without a linked unit, so these fields live on the
  // sale row directly.
  buyer_name_ar?: string | null
  buyer_id_type?: string | null
  buyer_id_number?: string | null
  buyer_nationality?: string | null
  buyer_residency_type?: string | null
  buyer_phone?: string | null
}

export async function bulkImportContractsFromRows(
  input: { rows: BulkImportContractRow[] },
): Promise<
  | {
      ok: true
      updatedSales: number
      insertedSales: number
      insertedUnlinked: number    // NEW: how many rows inserted with unit_id=null
      linkedByAI: number          // NEW: how many the post-import linker attached
      unmatched: UnmatchedRowRef[]
      skippedRows: number
    }
  | { ok: false; error: string }
> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }

  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return { ok: false, error: 'لا توجد صفوف للاستيراد.' }
  }
  // Task #185: allow assigned staff.
  const guard = await assertCanWriteToProjects(caller, input.rows.map((r) => r.project_id))
  if (!guard.ok) return guard

  const usable: BulkImportContractRow[] = []
  let skipped = 0
  for (const r of input.rows) {
    const projectId = (r.project_id ?? '').trim()
    const unitNumber = (r.unit_number ?? '').trim()
    // Require project_id (we need SOME anchor). unit_number is now optional —
    // a sale can exist without a matched unit; the AI linker will resolve it
    // later. But we still need SOMETHING to identify the row, so also allow
    // rows that at least have a buyer name.
    if (!projectId) {
      skipped++
      continue
    }
    if (!unitNumber && !(r.buyer_name_ar ?? '').trim() && !(r.contract_number ?? '').trim()) {
      skipped++
      continue
    }
    usable.push({ ...r, project_id: projectId, unit_number: unitNumber })
  }
  if (usable.length === 0) {
    return { ok: false, error: 'كل الصفوف فارغة أو تفتقد المشروع.' }
  }

  const svc = createSupabaseService()

  // Tenant-isolation.
  const uniqueProjectIds = Array.from(new Set(usable.map((r) => r.project_id)))
  const { data: projRows, error: projErr } = await svc
    .from('dsb_projects')
    .select('id')
    .eq('tenant_id', caller.tenantId)
    .in('id', uniqueProjectIds)
  if (projErr) return { ok: false, error: projErr.message }
  const validProjectIds = new Set(
    ((projRows ?? []) as { id: string }[]).map((r) => r.id),
  )
  const mismatched = usable
    .map((r, i) => (validProjectIds.has(r.project_id) ? -1 : i + 1))
    .filter((x) => x > 0)
  if (mismatched.length > 0) {
    return {
      ok: false,
      error: `صفوف تشير إلى مشاريع خارج مؤسستك (المواضع: ${mismatched.slice(0, 20).join(', ')}${mismatched.length > 20 ? '…' : ''}).`,
    }
  }

  // Load units in the referenced projects (for exact-match attempt at
  // import time — the AI linker below handles the fuzzy leftovers).
  type UnitLite = { id: string; project_id: string; unit_number: string }
  const unitByKey = new Map<string, UnitLite>()
  const CHUNK = 300
  for (let i = 0; i < uniqueProjectIds.length; i += CHUNK) {
    const slice = uniqueProjectIds.slice(i, i + CHUNK)
    const { data: units } = await svc
      .from('dsb_project_units')
      .select('id, project_id, unit_number')
      .eq('tenant_id', caller.tenantId)
      .in('project_id', slice)
    for (const u of (units ?? []) as UnitLite[]) {
      unitByKey.set(`${u.project_id}::${u.unit_number}`, u)
    }
  }

  // Partition rows into (matched unit / unmatched). Unmatched still gets
  // inserted — with unit_id NULL and unit_number_raw preserved — so the AI
  // linker can attach it later.
  const matched: Array<{ row: BulkImportContractRow; unit: UnitLite }> = []
  const unmatched: Array<{ row: BulkImportContractRow }> = []
  const unmatchedRefs: UnmatchedRowRef[] = []
  for (const r of usable) {
    const key = `${r.project_id}::${r.unit_number}`
    const u = r.unit_number ? unitByKey.get(key) : undefined
    if (u) {
      matched.push({ row: r, unit: u })
    } else {
      unmatched.push({ row: r })
      unmatchedRefs.push({ project_id: r.project_id, unit_number: r.unit_number || '(بدون رقم)' })
    }
  }

  // For matched rows, prefer updating the existing active sale (avoid
  // duplicates). Only load actives for the units we're touching.
  const matchedUnitIds = Array.from(new Set(matched.map((m) => m.unit.id)))
  type SaleLite = { id: string; unit_id: string }
  const activeSaleByUnitId = new Map<string, SaleLite>()
  for (let i = 0; i < matchedUnitIds.length; i += CHUNK) {
    const slice = matchedUnitIds.slice(i, i + CHUNK)
    if (slice.length === 0) continue
    const { data: sales } = await svc
      .from('dsb_unit_sales')
      .select('id, unit_id')
      .eq('tenant_id', caller.tenantId)
      .in('unit_id', slice)
      .eq('sale_status', 'active')
    for (const s of (sales ?? []) as SaleLite[]) {
      if (!activeSaleByUnitId.has(s.unit_id)) activeSaleByUnitId.set(s.unit_id, s)
    }
  }

  // Fields that get copied from an import row onto a sale row (both for
  // update and insert paths).
  const salePatchFromRow = (row: BulkImportContractRow): Record<string, unknown> => ({
    contract_number: row.contract_number ?? null,
    contract_type: row.contract_type ?? null,
    financing_type: row.financing_type ?? null,
    financing_bank: row.financing_bank ?? null,
    sale_date: row.sale_date ?? null,
    price_before_tax_sar: row.price_before_tax_sar ?? null,
    vat_sar: row.vat_sar ?? null,
    price_with_vat_sar: row.price_with_vat_sar ?? null,
    delivery_status: row.delivery_status ?? null,
    delivery_date: row.delivery_date ?? null,
    retention_percentage: row.retention_percentage ?? null,
    installment_number: row.installment_number ?? null,
    total_collected_before_tax_sar: row.total_collected_before_tax_sar ?? null,
    total_collected_with_tax_sar: row.total_collected_with_tax_sar ?? null,
    remaining_amount_sar: row.remaining_amount_sar ?? null,
    collection_percentage: row.collection_percentage ?? null,
    price_per_meter_sar: row.price_per_meter_sar ?? null,
    // Buyer fields (optional — set only if the row carries them).
    buyer_name_ar: row.buyer_name_ar ?? null,
    buyer_id_type: row.buyer_id_type ?? null,
    buyer_id_number: row.buyer_id_number ?? null,
    buyer_nationality: row.buyer_nationality ?? null,
    buyer_residency_type: row.buyer_residency_type ?? null,
    buyer_phone: row.buyer_phone ?? null,
  })

  const toUpdate: Array<{ saleId: string; patch: Record<string, unknown> }> = []
  const toInsert: Record<string, unknown>[] = []

  // Matched rows — dedupe by unit_id so the last row wins on updates.
  const matchedRowByUnitId = new Map<string, { row: BulkImportContractRow; unit: UnitLite }>()
  for (const m of matched) matchedRowByUnitId.set(m.unit.id, m)

  for (const [unitId, { row, unit }] of matchedRowByUnitId.entries()) {
    const patch = salePatchFromRow(row)
    // Always keep unit_number_raw fresh in case it changes.
    patch.unit_number_raw = row.unit_number || null
    const existingSale = activeSaleByUnitId.get(unitId)
    if (existingSale) {
      toUpdate.push({ saleId: existingSale.id, patch })
    } else {
      toInsert.push({
        tenant_id: caller.tenantId,
        project_id: unit.project_id,
        unit_id: unitId,
        unit_number_raw: row.unit_number || null,
        sale_count: 1,
        sale_status: 'active',
        ...patch,
      })
    }
  }

  // Unmatched rows — always INSERT with unit_id NULL. The AI linker below
  // will try to attach them to units in a second pass.
  for (const { row } of unmatched) {
    toInsert.push({
      tenant_id: caller.tenantId,
      project_id: row.project_id,
      unit_id: null,
      unit_number_raw: row.unit_number || null,
      sale_count: 1,
      sale_status: 'active',
      ...salePatchFromRow(row),
    })
  }

  let updated = 0
  for (const { saleId, patch } of toUpdate) {
    const { error } = await svc
      .from('dsb_unit_sales')
      .update(patch)
      .eq('id', saleId)
      .eq('tenant_id', caller.tenantId)
    if (error) return { ok: false, error: error.message }
    updated++
  }

  let inserted = 0
  // Count how many of the fresh inserts land with unit_id=null — those are
  // the ones the AI linker below will try to attach to units.
  const insertedUnlinkedCount = toInsert.filter((r) => r.unit_id === null).length
  if (toInsert.length > 0) {
    const { error } = await svc.from('dsb_unit_sales').insert(toInsert)
    if (error) return { ok: false, error: error.message }
    inserted = toInsert.length
  }

  // Post-import AI linker: for each project touched, try to attach any
  // sales that still have unit_id=null. Runs synchronously so the response
  // reports the final linked count.
  let linkedByAI = 0
  for (const pid of uniqueProjectIds) {
    try {
      const result = await linkSalesToUnitsForProject({
        tenantId: caller.tenantId,
        projectId: pid,
      })
      linkedByAI += result.linkedCount
    } catch (err) {
      console.error('[bulkImportContracts] auto-link failed', pid, err)
    }
  }

  revalidatePath('/app/disbursements/admin')
  for (const pid of uniqueProjectIds) {
    revalidatePath(`/app/disbursements/admin/projects/${pid}`)
  }
  return {
    ok: true,
    updatedSales: updated,
    insertedSales: inserted,
    insertedUnlinked: insertedUnlinkedCount,
    linkedByAI,
    unmatched: unmatchedRefs,
    skippedRows: skipped,
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
    // Financial tracking (055) — read-only in the drawer today, but the
    // update surface is here so an owner can correct a stray value.
    retention_percentage?: number | null
    installment_number?: number | null
    total_collected_before_tax_sar?: number | null
    total_collected_with_tax_sar?: number | null
    remaining_amount_sar?: number | null
    collection_percentage?: number | null
    price_per_meter_sar?: number | null
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

  // The check constraint from migration 057 says a contract in status
  // 'matched' MUST have unit_id set. When we delete this unit, the FK's
  // ON DELETE SET NULL would try to null the contract's unit_id and the
  // check would fire, aborting the delete. Downgrade any matched contracts
  // referencing this unit first.
  await svc
    .from('dsb_unit_contracts')
    .update({ extraction_status: 'no_match' })
    .eq('tenant_id', caller.tenantId)
    .eq('unit_id', input.id)
    .eq('extraction_status', 'matched')

  const { error } = await svc
    .from('dsb_project_units')
    .delete()
    .eq('id', input.id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  const projectId = (unit as { project_id: string }).project_id
  revalidatePath(`/app/disbursements/admin/projects/${projectId}`)
  revalidatePath(`/app/disbursements/admin/projects/${projectId}/units`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// deleteSale — owner only. Removes a single row from dsb_unit_sales.
// Cascade: dsb_cases.sale_id (SET NULL), dsb_unit_contracts.sale_id (SET NULL).
// The unit itself is untouched.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// updateSaleDelivery — inline toggle on the buyer-contracts list.
//
// The developer's Excel usually ships every row as "مُسلَّمة" regardless of
// whether the unit was actually handed over. Reviewers need a fast way to
// flip individual rows to reflect reality without re-importing.
//
// Rules:
//   - delivered=true  → sets delivery_status='delivered'; if the row has no
//     delivery_date yet, stamps today
//   - delivered=false → clears both delivery_status and delivery_date so
//     the row cleanly reports "not delivered" everywhere it renders
// ---------------------------------------------------------------------------
export async function updateSaleDelivery(
  input: {
    sale_id: string
    delivered: boolean
    // Optional YYYY-MM-DD. If omitted while delivered=true we keep any
    // existing delivery_date, else default to today. Ignored when
    // delivered=false (date always cleared).
    delivery_date?: string | null
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!['employee', 'supervisor', 'owner'].includes(caller.dsbRole ?? '')) {
    return { ok: false, error: 'لا تملك صلاحية.' }
  }
  if (!input.sale_id) return { ok: false, error: 'المُعرِّف مطلوب.' }

  const svc = createSupabaseService()
  const { data: sale } = await svc
    .from('dsb_unit_sales')
    .select('id, tenant_id, project_id, delivery_date')
    .eq('id', input.sale_id)
    .maybeSingle()
  if (!sale || (sale as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'العقد غير موجود.' }
  }

  // Resolve the date to write. Priority:
  //   1. explicit date passed in (when the operator edits the date field)
  //   2. existing delivery_date on the row (preserve historical value)
  //   3. today's date (first time marking delivered)
  const explicitDate = (input.delivery_date ?? '').trim()
  if (explicitDate && !/^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) {
    return { ok: false, error: 'تاريخ التسليم غير صالح.' }
  }

  const patch: Record<string, string | null> = input.delivered
    ? {
        delivery_status: 'delivered',
        delivery_date:
          explicitDate ||
          ((sale as { delivery_date: string | null }).delivery_date) ||
          new Date().toISOString().slice(0, 10),
      }
    : {
        delivery_status: null,
        delivery_date: null,
      }

  const { error } = await svc
    .from('dsb_unit_sales')
    .update(patch)
    .eq('id', input.sale_id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  // Audit trail — every delivery flip is attributable to a user + time so
  // "who marked unit V-101 delivered?" is answerable later. Uses the same
  // dsb_audit_log table the case workflow uses; case_id stays null since
  // this is a sale-level action.
  await svc.from('dsb_audit_log').insert({
    tenant_id: caller.tenantId,
    case_id: null,
    event: input.delivered ? 'sale_marked_delivered' : 'sale_marked_undelivered',
    actor_user_id: caller.userId,
    notes: `sale_id=${input.sale_id}`,
    occurred_at: new Date().toISOString(),
  })

  const projectId = (sale as { project_id: string }).project_id
  revalidatePath(`/app/disbursements/admin/projects/${projectId}/buyer-contracts`)
  revalidatePath(`/app/disbursements/admin/projects/${projectId}/reports/buyers-register`)
  return { ok: true }
}

export async function deleteSale(
  input: { id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  const own = assertOwner(caller)
  if (!own.ok) return own
  if (!input.id) return { ok: false, error: 'المُعرِّف مطلوب.' }

  const svc = createSupabaseService()
  const { data: sale } = await svc
    .from('dsb_unit_sales')
    .select('id, tenant_id, project_id')
    .eq('id', input.id)
    .maybeSingle()
  if (!sale || (sale as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'العقد غير موجود.' }
  }

  const { error } = await svc
    .from('dsb_unit_sales')
    .delete()
    .eq('id', input.id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  const projectId = (sale as { project_id: string }).project_id
  revalidatePath(`/app/disbursements/admin/projects/${projectId}`)
  revalidatePath(`/app/disbursements/admin/projects/${projectId}/buyer-contracts`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// deleteAllSalesForProject — owner only. Bulk wipe of عقود المشترين data
// for a project. Requires the caller to pass confirm='DELETE' so a stray
// button click can't nuke everything. The units themselves stay.
// ---------------------------------------------------------------------------
export async function deleteAllSalesForProject(
  input: { project_id: string; confirm: string },
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  const own = assertOwner(caller)
  if (!own.ok) return own
  if (input.confirm !== 'DELETE') {
    return { ok: false, error: 'تأكيد الحذف مطلوب (اكتب DELETE).' }
  }
  if (!input.project_id) return { ok: false, error: 'المشروع مطلوب.' }

  const svc = createSupabaseService()
  // Verify project ownership.
  const { data: project } = await svc
    .from('dsb_projects')
    .select('id, tenant_id')
    .eq('id', input.project_id)
    .maybeSingle()
  if (!project || (project as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'المشروع غير موجود.' }
  }

  // Count first so we can report exactly what was removed.
  const { count } = await svc
    .from('dsb_unit_sales')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', caller.tenantId)
    .eq('project_id', input.project_id)

  const { error } = await svc
    .from('dsb_unit_sales')
    .delete()
    .eq('tenant_id', caller.tenantId)
    .eq('project_id', input.project_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${input.project_id}`)
  revalidatePath(`/app/disbursements/admin/projects/${input.project_id}/buyer-contracts`)
  return { ok: true, deleted: count ?? 0 }
}

// ---------------------------------------------------------------------------
// deleteAllUnitsForProject — owner only. Full wipe of physical units for a
// project. Cascades to dsb_unit_sales via the FK; dsb_unit_contracts and
// dsb_cases unit_id are ON DELETE SET NULL. First downgrades any matched
// contracts so the check constraint doesn't block the cascade.
// Same 'DELETE' confirm gate.
// ---------------------------------------------------------------------------
export async function deleteAllUnitsForProject(
  input: { project_id: string; confirm: string },
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
  const own = assertOwner(caller)
  if (!own.ok) return own
  if (input.confirm !== 'DELETE') {
    return { ok: false, error: 'تأكيد الحذف مطلوب (اكتب DELETE).' }
  }
  if (!input.project_id) return { ok: false, error: 'المشروع مطلوب.' }

  const svc = createSupabaseService()
  const { data: project } = await svc
    .from('dsb_projects')
    .select('id, tenant_id')
    .eq('id', input.project_id)
    .maybeSingle()
  if (!project || (project as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'المشروع غير موجود.' }
  }

  // Collect unit ids for this project.
  const { data: unitRows } = await svc
    .from('dsb_project_units')
    .select('id')
    .eq('tenant_id', caller.tenantId)
    .eq('project_id', input.project_id)
  const unitIds = ((unitRows ?? []) as { id: string }[]).map((r) => r.id)
  if (unitIds.length === 0) return { ok: true, deleted: 0 }

  // Downgrade matched contracts referencing these units so the SET NULL
  // cascade from unit delete doesn't fire the check constraint.
  await svc
    .from('dsb_unit_contracts')
    .update({ extraction_status: 'no_match' })
    .eq('tenant_id', caller.tenantId)
    .in('unit_id', unitIds)
    .eq('extraction_status', 'matched')

  const { error } = await svc
    .from('dsb_project_units')
    .delete()
    .eq('tenant_id', caller.tenantId)
    .eq('project_id', input.project_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${input.project_id}`)
  revalidatePath(`/app/disbursements/admin/projects/${input.project_id}/units`)
  revalidatePath(`/app/disbursements/admin/projects/${input.project_id}/buyer-contracts`)
  return { ok: true, deleted: unitIds.length }
}

// ---------------------------------------------------------------------------
// attachContractToSale — owner only. Manual linkage for `no_match` contracts.
// ---------------------------------------------------------------------------

export async function attachContractToSale(
  input: { contract_id: string; sale_id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if ('error' in caller) return { ok: false, error: caller.error }
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
  // Task #185: allow assigned staff. Resolve the sale's project via its unit
  // so we can scope-check the caller before mutating.
  const { data: unitRow } = await svc
    .from('dsb_project_units')
    .select('project_id')
    .eq('id', sale.unit_id)
    .maybeSingle()
  const projectId = (unitRow as { project_id: string } | null)?.project_id
  if (!projectId) return { ok: false, error: 'المشروع غير معروف.' }
  const guard = await assertCanWriteToProjects(caller, [projectId])
  if (!guard.ok) return guard

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

  if (!input.project_id) return { ok: false, error: 'المشروع مطلوب.' }
  // Task #185: allow assigned staff.
  const guard = await assertCanWriteToProjects(caller, [input.project_id])
  if (!guard.ok) return guard
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
  if (!input.project_id) return { ok: false, error: 'المشروع مطلوب.' }
  // Task #185: allow assigned staff.
  const guard = await assertCanWriteToProjects(caller, [input.project_id])
  if (!guard.ok) return guard

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
  if (!input.project_id) return { ok: false, error: 'المشروع مطلوب.' }
  // Task #185: allow assigned staff.
  const guard = await assertCanWriteToProjects(caller, [input.project_id])
  if (!guard.ok) return guard

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
  // Read-only preview. Any tenant staff can preview; tenant-isolation is
  // enforced by the tenant_id equality check below. Owner-only lock lifted
  // as part of task #185 so scoped staff can inspect the PDF they uploaded.

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
