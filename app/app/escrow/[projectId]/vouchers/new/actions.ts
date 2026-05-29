'use server'

import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

// ============================================================================
// Escrow voucher upload — server actions
//
// Mirrors the direct-to-Storage pattern used by /app/upload/[token]/actions.ts
// so the actual file bytes never traverse a Vercel server action (4.5 MB body
// cap on Hobby tier). The flow is:
//
//   1. createVoucher           — inserts the voucher header row (status='draft')
//   2. requestVoucherUploadUrls — mints one signed Supabase Storage upload URL
//                                 per file; the browser PUTs each file directly
//   3. registerVoucherUploads  — records each upload in escrow_voucher_uploads
//                                 and flips voucher status to 'uploaded'
//   4. kickoffVoucherAudit     — fires the n8n webhook (fire-and-forget) so
//                                 the audit pipeline can pick up the voucher
// ============================================================================

const STORAGE_BUCKET = 'Document submission'
const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB per file
const ALLOWED_MIME_PREFIXES = ['application/pdf', 'image/']

type ExpenseNature = 'construction' | 'non_construction' | 'preservation'

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180)
}

function isAllowedMime(mime: string): boolean {
  if (!mime) return true // octet-stream / unknown — Storage will accept the bytes
  return ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p)) || mime === 'application/octet-stream'
}

/**
 * Resolve the calling user's tenant_id + user id. Returns null on any auth
 * problem — callers translate this to a user-facing error.
 */
async function resolveCaller(): Promise<{ tenantId: string; userId: string } | null> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return null

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) return null
  return { tenantId: profile.tenant_id as string, userId: profile.id as string }
}

// ----------------------------------------------------------------------------
// 1) createVoucher
// ----------------------------------------------------------------------------

export interface CreateVoucherInput {
  project_id: string
  voucher_number: string
  voucher_date: string // ISO date
  total_sar: number
  expense_nature: ExpenseNature
  beneficiary_supplier_id: string
  source_escrow_account_id: string
  signed_by_authorized_signer_id?: string | null
  notes?: string | null
}

export type CreateVoucherResult =
  | { ok: true; voucher_id: string }
  | { ok: false; error: string }

export async function createVoucher(input: CreateVoucherInput): Promise<CreateVoucherResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'Not signed in.' }
  const { tenantId, userId } = caller

  // Defensive input validation — UI also validates.
  if (!input.project_id) return { ok: false, error: 'Missing project.' }
  if (!input.voucher_number || input.voucher_number.trim().length === 0) {
    return { ok: false, error: 'Voucher number is required.' }
  }
  if (!input.voucher_date) return { ok: false, error: 'Voucher date is required.' }
  if (!(input.total_sar > 0)) return { ok: false, error: 'Total amount must be greater than 0.' }
  if (!['construction', 'non_construction', 'preservation'].includes(input.expense_nature)) {
    return { ok: false, error: 'Invalid expense nature.' }
  }
  if (!input.beneficiary_supplier_id) return { ok: false, error: 'Beneficiary supplier is required.' }
  if (!input.source_escrow_account_id) return { ok: false, error: 'Source escrow account is required.' }

  const svc = createSupabaseService()

  // Verify the project belongs to this tenant.
  const { data: project } = await svc
    .from('escrow_projects')
    .select('id, tenant_id')
    .eq('tenant_id', tenantId)
    .eq('id', input.project_id)
    .maybeSingle()
  if (!project) return { ok: false, error: 'Project not found.' }

  const { data: row, error: insertErr } = await svc
    .from('escrow_vouchers')
    .insert({
      tenant_id: tenantId,
      project_id: input.project_id,
      voucher_number: input.voucher_number.trim(),
      voucher_date: input.voucher_date,
      total_sar: input.total_sar,
      currency: 'SAR',
      beneficiary_supplier_id: input.beneficiary_supplier_id,
      source_escrow_account_id: input.source_escrow_account_id,
      expense_nature: input.expense_nature,
      signed_by_authorized_signer_id: input.signed_by_authorized_signer_id || null,
      status: 'draft',
      submitted_by_user_id: userId,
      notes: input.notes?.trim() || null,
    })
    .select('id')
    .single()

  if (insertErr || !row) {
    console.error('[escrow.createVoucher] insert failed', insertErr)
    const msg = insertErr?.message ?? 'Insert failed'
    // Unique-violation on (tenant_id, project_id, voucher_number) gets a friendly message.
    if (insertErr?.code === '23505') {
      return { ok: false, error: 'A voucher with this number already exists for this project.' }
    }
    return { ok: false, error: msg }
  }

  return { ok: true, voucher_id: row.id as string }
}

// ----------------------------------------------------------------------------
// 2) requestVoucherUploadUrls
// ----------------------------------------------------------------------------

export interface RequestVoucherUploadUrlsInput {
  voucher_id: string
  files: { filename: string; mime: string; size: number }[]
}

export type RequestVoucherUploadUrlsResult =
  | {
      ok: true
      slots: { slot_id: string; signed_url: string; storage_path: string }[]
    }
  | { ok: false; error: string }

export async function requestVoucherUploadUrls(
  input: RequestVoucherUploadUrlsInput,
): Promise<RequestVoucherUploadUrlsResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'Not signed in.' }
  const { tenantId } = caller

  if (!input.voucher_id) return { ok: false, error: 'Missing voucher.' }
  if (!Array.isArray(input.files) || input.files.length === 0) {
    return { ok: false, error: 'No files to upload.' }
  }

  const svc = createSupabaseService()

  // Confirm voucher exists in this tenant + grab its project for the storage path.
  const { data: voucher } = await svc
    .from('escrow_vouchers')
    .select('id, project_id, tenant_id')
    .eq('tenant_id', tenantId)
    .eq('id', input.voucher_id)
    .maybeSingle()
  if (!voucher) return { ok: false, error: 'Voucher not found.' }

  const projectId = voucher.project_id as string
  const slots: { slot_id: string; signed_url: string; storage_path: string }[] = []

  for (let i = 0; i < input.files.length; i++) {
    const f = input.files[i]
    if (!f || typeof f.size !== 'number' || f.size <= 0) {
      return { ok: false, error: `Invalid file size at index ${i}.` }
    }
    if (f.size > MAX_FILE_SIZE) {
      return { ok: false, error: `File too large (max 25 MB): ${f.filename}` }
    }
    if (f.mime && !isAllowedMime(f.mime)) {
      return { ok: false, error: `Unsupported file type: ${f.mime}` }
    }

    // Path: escrow/{tenant_id}/{project_id}/{voucher_id}/{uuid}-{filename}
    const uuid = crypto.randomUUID()
    const safeName = sanitizeFilename(f.filename || `upload-${i}.bin`)
    const storagePath = `escrow/${tenantId}/${projectId}/${input.voucher_id}/${uuid}-${safeName}`

    const { data: signedData, error: signedErr } = await svc.storage
      .from(STORAGE_BUCKET)
      .createSignedUploadUrl(storagePath)
    if (signedErr || !signedData) {
      console.error('[escrow.requestVoucherUploadUrls] createSignedUploadUrl failed', signedErr)
      return { ok: false, error: `Could not generate upload URL for ${f.filename}.` }
    }

    slots.push({
      slot_id: uuid, // stable client-side key; also used as a correlation handle
      signed_url: signedData.signedUrl,
      storage_path: signedData.path ?? storagePath,
    })
  }

  return { ok: true, slots }
}

// ----------------------------------------------------------------------------
// 3) registerVoucherUploads
// ----------------------------------------------------------------------------

export interface RegisterVoucherUploadsInput {
  voucher_id: string
  uploads: {
    slot_id?: string
    storage_path: string
    declared_kind?: string
    filename: string
    size: number
    mime: string
  }[]
}

export type RegisterVoucherUploadsResult =
  | { ok: true }
  | { ok: false; error: string }

export async function registerVoucherUploads(
  input: RegisterVoucherUploadsInput,
): Promise<RegisterVoucherUploadsResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'Not signed in.' }
  const { tenantId, userId } = caller

  if (!input.voucher_id) return { ok: false, error: 'Missing voucher.' }
  if (!Array.isArray(input.uploads) || input.uploads.length === 0) {
    return { ok: false, error: 'No uploads to register.' }
  }

  const svc = createSupabaseService()

  // Confirm voucher belongs to this tenant.
  const { data: voucher } = await svc
    .from('escrow_vouchers')
    .select('id, tenant_id, status')
    .eq('tenant_id', tenantId)
    .eq('id', input.voucher_id)
    .maybeSingle()
  if (!voucher) return { ok: false, error: 'Voucher not found.' }

  const rows = input.uploads.map((u) => ({
    tenant_id: tenantId,
    voucher_id: input.voucher_id,
    declared_kind: u.declared_kind || 'unknown', // agent will reclassify
    filename: sanitizeFilename(u.filename),
    display_name: u.filename,
    storage_path: u.storage_path,
    storage_bucket: STORAGE_BUCKET,
    file_size_bytes: u.size,
    mime_type: u.mime || 'application/octet-stream',
    uploaded_by_user_id: userId,
  }))

  const { error: insertErr } = await svc.from('escrow_voucher_uploads').insert(rows)
  if (insertErr) {
    console.error('[escrow.registerVoucherUploads] insert failed', insertErr)
    return { ok: false, error: insertErr.message || 'Insert failed' }
  }

  // Flip voucher status to 'uploaded' if it's still 'draft'.
  if (voucher.status === 'draft') {
    const { error: updErr } = await svc
      .from('escrow_vouchers')
      .update({ status: 'uploaded' })
      .eq('id', input.voucher_id)
      .eq('tenant_id', tenantId)
    if (updErr) {
      console.error('[escrow.registerVoucherUploads] status flip failed', updErr)
      // Non-fatal — the uploads are recorded.
    }
  }

  return { ok: true }
}

// ----------------------------------------------------------------------------
// 4) kickoffVoucherAudit — fire n8n webhook (best-effort, 10s timeout)
// ----------------------------------------------------------------------------

export interface KickoffVoucherAuditInput {
  voucher_id: string
}

export type KickoffVoucherAuditResult =
  | { ok: true; kicked: boolean; reason?: string }
  | { ok: false; error: string }

export async function kickoffVoucherAudit(
  input: KickoffVoucherAuditInput,
): Promise<KickoffVoucherAuditResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'Not signed in.' }
  const { tenantId } = caller

  if (!input.voucher_id) return { ok: false, error: 'Missing voucher.' }

  const svc = createSupabaseService()
  const { data: voucher } = await svc
    .from('escrow_vouchers')
    .select('id, tenant_id')
    .eq('tenant_id', tenantId)
    .eq('id', input.voucher_id)
    .maybeSingle()
  if (!voucher) return { ok: false, error: 'Voucher not found.' }

  // Prefer the Phase-2 URL; fall back to the original.
  const url =
    process.env.N8N_VOUCHER_AUDIT_WEBHOOK_URL_V2 ||
    process.env.N8N_VOUCHER_AUDIT_WEBHOOK_URL ||
    null

  if (!url) {
    console.log('[escrow.kickoffVoucherAudit] no webhook url configured; skipping')
    return { ok: true, kicked: false, reason: 'no webhook url configured' }
  }

  const body = JSON.stringify({
    voucher_id: input.voucher_id,
    tenant_id: tenantId,
    fired_at: new Date().toISOString(),
  })

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      console.error('[escrow.kickoffVoucherAudit] webhook non-2xx', res.status)
      return { ok: true, kicked: false, reason: `webhook returned ${res.status}` }
    }
    console.log('[escrow.kickoffVoucherAudit] webhook fired ok')
    return { ok: true, kicked: true }
  } catch (err) {
    console.error('[escrow.kickoffVoucherAudit] webhook error', err)
    const reason = err instanceof Error ? err.message : String(err)
    return { ok: true, kicked: false, reason }
  }
}
