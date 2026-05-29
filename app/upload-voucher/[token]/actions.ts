'use server'

import crypto from 'crypto'
import { createSupabaseService } from '@/lib/supabase/server'

// ============================================================================
// Public (tokenized) escrow voucher upload — server actions.
//
// MIRRORS /app/app/escrow/[projectId]/vouchers/new/actions.ts but authenticated
// via the magic-link token instead of a logged-in user session.
//
//   1. createVoucherViaToken            — inserts the voucher header row
//   2. requestVoucherUploadUrlsViaToken — mints signed Storage upload URLs
//   3. registerVoucherUploadsViaToken   — records uploads, marks voucher
//                                         'uploaded', burns the token, fires
//                                         the n8n webhook.
//
// EVERY action re-hashes and re-validates the token (not-expired, not-used,
// not-revoked). The raw token is never persisted; we only have its sha256.
// ============================================================================

const STORAGE_BUCKET = 'Document submission'
const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB per file
const ALLOWED_MIME_PREFIXES = ['application/pdf', 'image/']

type ExpenseNature = 'construction' | 'non_construction' | 'preservation'

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180)
}

function isAllowedMime(mime: string): boolean {
  if (!mime) return true
  return ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p)) || mime === 'application/octet-stream'
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

// ----------------------------------------------------------------------------
// Token resolution
// ----------------------------------------------------------------------------

export interface ResolvedToken {
  token_id: string
  tenant_id: string
  project_id: string
  voucher_id: string | null
  recipient_name: string
  recipient_email: string
}

/**
 * Internal: look up the token by hash and verify it is active. Returns null on
 * any problem (not found, expired, used, revoked).
 */
async function resolveToken(token_raw: string): Promise<ResolvedToken | null> {
  if (!token_raw || token_raw.length < 16) return null
  const svc = createSupabaseService()
  const hash = hashToken(token_raw)
  const { data } = await svc
    .from('escrow_voucher_upload_tokens')
    .select('id, tenant_id, project_id, voucher_id, recipient_name, recipient_email, expires_at, used_at, revoked_at')
    .eq('token_hash', hash)
    .maybeSingle()
  if (!data) return null
  if (data.revoked_at) return null
  if (data.used_at) return null
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null
  return {
    token_id: data.id as string,
    tenant_id: data.tenant_id as string,
    project_id: data.project_id as string,
    voucher_id: (data.voucher_id as string | null) ?? null,
    recipient_name: data.recipient_name as string,
    recipient_email: data.recipient_email as string,
  }
}

// ----------------------------------------------------------------------------
// 1) createVoucherViaToken
// ----------------------------------------------------------------------------

export interface CreateVoucherViaTokenInput {
  token_raw: string
  voucher_number: string
  voucher_date: string
  total_sar: number
  expense_nature: ExpenseNature
  beneficiary_supplier_id: string
  source_escrow_account_id: string
  signed_by_authorized_signer_id?: string | null
  notes?: string | null
}

export type CreateVoucherViaTokenResult =
  | { ok: true; voucher_id: string }
  | { ok: false; error: string }

export async function createVoucherViaToken(
  input: CreateVoucherViaTokenInput,
): Promise<CreateVoucherViaTokenResult> {
  const tok = await resolveToken(input.token_raw)
  if (!tok) return { ok: false, error: 'Invalid or expired link.' }

  // Defensive input validation.
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

  // Sanity-check project + tenant still match.
  const { data: project } = await svc
    .from('escrow_projects')
    .select('id, tenant_id')
    .eq('tenant_id', tok.tenant_id)
    .eq('id', tok.project_id)
    .maybeSingle()
  if (!project) return { ok: false, error: 'Project not found.' }

  const { data: row, error: insertErr } = await svc
    .from('escrow_vouchers')
    .insert({
      tenant_id: tok.tenant_id,
      project_id: tok.project_id,
      voucher_number: input.voucher_number.trim(),
      voucher_date: input.voucher_date,
      total_sar: input.total_sar,
      currency: 'SAR',
      beneficiary_supplier_id: input.beneficiary_supplier_id,
      source_escrow_account_id: input.source_escrow_account_id,
      expense_nature: input.expense_nature,
      signed_by_authorized_signer_id: input.signed_by_authorized_signer_id || null,
      status: 'draft',
      submitted_by_user_id: null,
      submitted_by_external_name: tok.recipient_name,
      submitted_by_external_email: tok.recipient_email,
      notes: input.notes?.trim() || null,
    })
    .select('id')
    .single()

  if (insertErr || !row) {
    console.error('[token.createVoucher] insert failed', insertErr)
    if (insertErr?.code === '23505') {
      return { ok: false, error: 'A voucher with this number already exists for this project.' }
    }
    return { ok: false, error: insertErr?.message || 'Insert failed' }
  }

  return { ok: true, voucher_id: row.id as string }
}

// ----------------------------------------------------------------------------
// 2) requestVoucherUploadUrlsViaToken
// ----------------------------------------------------------------------------

export interface RequestVoucherUploadUrlsViaTokenInput {
  token_raw: string
  voucher_id: string
  files: { filename: string; mime: string; size: number }[]
}

export type RequestVoucherUploadUrlsViaTokenResult =
  | {
      ok: true
      slots: { slot_id: string; signed_url: string; storage_path: string }[]
    }
  | { ok: false; error: string }

export async function requestVoucherUploadUrlsViaToken(
  input: RequestVoucherUploadUrlsViaTokenInput,
): Promise<RequestVoucherUploadUrlsViaTokenResult> {
  const tok = await resolveToken(input.token_raw)
  if (!tok) return { ok: false, error: 'Invalid or expired link.' }

  if (!input.voucher_id) return { ok: false, error: 'Missing voucher.' }
  if (!Array.isArray(input.files) || input.files.length === 0) {
    return { ok: false, error: 'No files to upload.' }
  }

  const svc = createSupabaseService()

  // Confirm voucher exists in this tenant + project.
  const { data: voucher } = await svc
    .from('escrow_vouchers')
    .select('id, project_id, tenant_id')
    .eq('tenant_id', tok.tenant_id)
    .eq('project_id', tok.project_id)
    .eq('id', input.voucher_id)
    .maybeSingle()
  if (!voucher) return { ok: false, error: 'Voucher not found.' }

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

    const uuid = crypto.randomUUID()
    const safeName = sanitizeFilename(f.filename || `upload-${i}.bin`)
    const storagePath = `escrow/${tok.tenant_id}/${tok.project_id}/${input.voucher_id}/${uuid}-${safeName}`

    const { data: signedData, error: signedErr } = await svc.storage
      .from(STORAGE_BUCKET)
      .createSignedUploadUrl(storagePath)
    if (signedErr || !signedData) {
      console.error('[token.requestVoucherUploadUrls] createSignedUploadUrl failed', signedErr)
      return { ok: false, error: `Could not generate upload URL for ${f.filename}.` }
    }

    slots.push({
      slot_id: uuid,
      signed_url: signedData.signedUrl,
      storage_path: signedData.path ?? storagePath,
    })
  }

  return { ok: true, slots }
}

// ----------------------------------------------------------------------------
// 3) registerVoucherUploadsViaToken
// ----------------------------------------------------------------------------

export interface RegisterVoucherUploadsViaTokenInput {
  token_raw: string
  voucher_id: string
  uploads: { storage_path: string; declared_kind?: string; filename: string; size: number; mime: string }[]
}

export type RegisterVoucherUploadsViaTokenResult =
  | { ok: true; redirect_to: string }
  | { ok: false; error: string }

export async function registerVoucherUploadsViaToken(
  input: RegisterVoucherUploadsViaTokenInput,
): Promise<RegisterVoucherUploadsViaTokenResult> {
  const tok = await resolveToken(input.token_raw)
  if (!tok) return { ok: false, error: 'Invalid or expired link.' }

  if (!input.voucher_id) return { ok: false, error: 'Missing voucher.' }
  if (!Array.isArray(input.uploads) || input.uploads.length === 0) {
    return { ok: false, error: 'No uploads to register.' }
  }

  const svc = createSupabaseService()

  // Confirm voucher belongs to this tenant + project.
  const { data: voucher } = await svc
    .from('escrow_vouchers')
    .select('id, tenant_id, project_id, status')
    .eq('tenant_id', tok.tenant_id)
    .eq('project_id', tok.project_id)
    .eq('id', input.voucher_id)
    .maybeSingle()
  if (!voucher) return { ok: false, error: 'Voucher not found.' }

  const rows = input.uploads.map((u) => ({
    tenant_id: tok.tenant_id,
    voucher_id: input.voucher_id,
    declared_kind: u.declared_kind || 'unknown',
    filename: sanitizeFilename(u.filename),
    display_name: u.filename,
    storage_path: u.storage_path,
    storage_bucket: STORAGE_BUCKET,
    file_size_bytes: u.size,
    mime_type: u.mime || 'application/octet-stream',
    uploaded_by_user_id: null,
    uploaded_by_external_name: tok.recipient_name,
    uploaded_by_external_email: tok.recipient_email,
  }))

  const { error: insertErr } = await svc.from('escrow_voucher_uploads').insert(rows)
  if (insertErr) {
    console.error('[token.registerVoucherUploads] insert failed', insertErr)
    return { ok: false, error: insertErr.message || 'Insert failed' }
  }

  // Flip voucher status to 'uploaded' if it's still 'draft'.
  if (voucher.status === 'draft') {
    const { error: updErr } = await svc
      .from('escrow_vouchers')
      .update({ status: 'uploaded' })
      .eq('id', input.voucher_id)
      .eq('tenant_id', tok.tenant_id)
    if (updErr) {
      console.error('[token.registerVoucherUploads] status flip failed', updErr)
      // Non-fatal — uploads are recorded.
    }
  }

  // Burn the token: one-time use. Also stamp the voucher_id so we can audit
  // which voucher was uploaded with which token.
  const { error: tokErr } = await svc
    .from('escrow_voucher_upload_tokens')
    .update({
      used_at: new Date().toISOString(),
      voucher_id: input.voucher_id,
    })
    .eq('id', tok.token_id)
  if (tokErr) {
    console.error('[token.registerVoucherUploads] token burn failed', tokErr)
    // Non-fatal but worth logging — the user already saw success.
  }

  // Fire n8n webhook — best-effort, never blocks the redirect.
  const url =
    process.env.N8N_VOUCHER_AUDIT_WEBHOOK_URL_V2 ||
    process.env.N8N_VOUCHER_AUDIT_WEBHOOK_URL ||
    null

  if (url) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voucher_id: input.voucher_id,
          tenant_id: tok.tenant_id,
          source: 'tokenized_external_upload',
          fired_at: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        console.error('[token.registerVoucherUploads] webhook non-2xx', res.status)
      }
    } catch (err) {
      console.error('[token.registerVoucherUploads] webhook error', err)
    }
  } else {
    console.log('[token.registerVoucherUploads] no webhook url configured; skipping')
  }

  return { ok: true, redirect_to: `/upload-voucher/${input.token_raw}/done` }
}
