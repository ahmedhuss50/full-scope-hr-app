'use server'

import crypto from 'crypto'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/resend'

// ============================================================================
// Escrow — Tokenized developer-upload links
//
// A trustee generates a magic-link URL and sends it to a developer's
// controller. The developer opens the URL (no login) and uploads a voucher
// with its supporting PDFs at /upload-voucher/[token].
//
// Token storage: we mint 32 random bytes → 64-hex chars, then store ONLY a
// sha256 hash of the raw token in the DB (mirrors the secret-hashing pattern
// you'd find in webhook-verification systems). The raw token never lives at
// rest. The trustee sees the URL once at generation time.
// ============================================================================

const MIN_EXPIRES_DAYS = 1
const MAX_EXPIRES_DAYS = 90
const DEFAULT_EXPIRES_DAYS = 7

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://app.fullscope.sa'
  )
}

function generateRawToken(): string {
  // 32 bytes = 256 bits of entropy → 64 hex chars.
  return crypto.randomBytes(32).toString('hex')
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

interface Caller {
  tenantId: string
  userId: string
}

async function resolveCaller(): Promise<Caller | null> {
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
// 1) createUploadToken
// ----------------------------------------------------------------------------

export interface CreateUploadTokenInput {
  project_id: string
  recipient_name: string
  recipient_email: string
  expires_days: number
  notes?: string
  send_email?: boolean
}

export type CreateUploadTokenResult =
  | { ok: true; url: string; token_raw: string; expires_at: string; email_sent: boolean; email_reason?: string }
  | { ok: false; error: string }

export async function createUploadToken(
  input: CreateUploadTokenInput,
): Promise<CreateUploadTokenResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'Not signed in.' }
  const { tenantId, userId } = caller

  // Defensive input validation.
  if (!input.project_id) return { ok: false, error: 'Missing project.' }
  const recipientName = (input.recipient_name ?? '').trim()
  const recipientEmail = (input.recipient_email ?? '').trim().toLowerCase()
  if (!recipientName) return { ok: false, error: 'Recipient name is required.' }
  if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    return { ok: false, error: 'A valid recipient email is required.' }
  }
  const expiresDays = Math.min(
    MAX_EXPIRES_DAYS,
    Math.max(MIN_EXPIRES_DAYS, Math.round(input.expires_days || DEFAULT_EXPIRES_DAYS)),
  )

  const svc = createSupabaseService()

  // Verify the project belongs to this tenant and load its display name +
  // tenant/firm display name (for the email).
  const { data: project } = await svc
    .from('escrow_projects')
    .select('id, tenant_id, name_en, name_ar')
    .eq('tenant_id', tenantId)
    .eq('id', input.project_id)
    .maybeSingle()
  if (!project) return { ok: false, error: 'Project not found.' }

  const { data: tenantRow } = await svc
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle()
  const firmName = (tenantRow?.name as string | undefined) ?? 'Full Scope'
  const projectName = (project.name_en as string) || (project.name_ar as string) || 'project'

  // Mint the token + hash it.
  const tokenRaw = generateRawToken()
  const tokenHash = hashToken(tokenRaw)
  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString()

  const { error: insertErr } = await svc
    .from('escrow_voucher_upload_tokens')
    .insert({
      tenant_id: tenantId,
      project_id: input.project_id,
      voucher_id: null,
      token_hash: tokenHash,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      expires_at: expiresAt,
      used_at: null,
      revoked_at: null,
      created_by_user_id: userId,
    })
  if (insertErr) {
    console.error('[escrow.createUploadToken] insert failed', insertErr)
    return { ok: false, error: insertErr.message || 'Could not create upload link.' }
  }

  const url = `${siteUrl()}/upload-voucher/${tokenRaw}`

  // Optional email — best-effort.
  let emailSent = false
  let emailReason: string | undefined
  if (input.send_email !== false) {
    try {
      const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #0f172a;">Upload your voucher</h2>
  <p>Hi ${escapeHtml(recipientName)},</p>
  <p>${escapeHtml(firmName)} is requesting a payment voucher for <strong>${escapeHtml(projectName)}</strong>. Please use the link below to upload it together with the supporting PDFs. No login required.</p>
  <p dir="rtl" lang="ar" style="color: #475569;">مرحباً ${escapeHtml(recipientName)},<br/>يرجى رفع سند الصرف والمستندات الداعمة لمشروع <strong>${escapeHtml(projectName)}</strong> عبر الرابط أدناه. لا حاجة لتسجيل الدخول.</p>
  <p style="margin: 32px 0;">
    <a href="${url}" style="display: inline-block; background: #0d9488; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Upload voucher</a>
  </p>
  <p style="color: #64748b; font-size: 12px;">This link expires in ${expiresDays} days. If you have questions, reply to this email.</p>
</body></html>`

      const result = await sendEmail({
        from: 'Full Scope <notifications@fullscope.sa>',
        to: recipientEmail,
        subject: `Upload your voucher for ${projectName} — ${firmName}`,
        html,
        text: `Hi ${recipientName},

${firmName} is requesting a payment voucher for ${projectName}.

Upload it here (no login required): ${url}

This link expires in ${expiresDays} days.`,
      })
      emailSent = result.sent
      emailReason = result.reason
    } catch (err) {
      console.warn('[escrow.createUploadToken] email failed', err)
      emailSent = false
      emailReason = err instanceof Error ? err.message : 'Unknown email error'
    }
  }

  return { ok: true, url, token_raw: tokenRaw, expires_at: expiresAt, email_sent: emailSent, email_reason: emailReason }
}

// ----------------------------------------------------------------------------
// 2) revokeUploadToken
// ----------------------------------------------------------------------------

export interface RevokeUploadTokenInput {
  token_id: string
}

export type RevokeUploadTokenResult =
  | { ok: true }
  | { ok: false; error: string }

export async function revokeUploadToken(
  input: RevokeUploadTokenInput,
): Promise<RevokeUploadTokenResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'Not signed in.' }
  const { tenantId } = caller

  if (!input.token_id) return { ok: false, error: 'Missing token id.' }

  const svc = createSupabaseService()
  const { error: updErr } = await svc
    .from('escrow_voucher_upload_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', input.token_id)
  if (updErr) {
    console.error('[escrow.revokeUploadToken] update failed', updErr)
    return { ok: false, error: updErr.message || 'Could not revoke link.' }
  }
  return { ok: true }
}

// ----------------------------------------------------------------------------
// 3) listProjectTokens
// ----------------------------------------------------------------------------

export interface ListProjectTokensInput {
  project_id: string
}

export interface ProjectTokenRow {
  id: string
  recipient_name: string
  recipient_email: string
  created_at: string
  expires_at: string
  used_at: string | null
  revoked_at: string | null
  url_hint: string
}

export type ListProjectTokensResult =
  | { ok: true; tokens: ProjectTokenRow[] }
  | { ok: false; error: string }

export async function listProjectTokens(
  input: ListProjectTokensInput,
): Promise<ListProjectTokensResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'Not signed in.' }
  const { tenantId } = caller

  if (!input.project_id) return { ok: false, error: 'Missing project.' }

  const svc = createSupabaseService()
  const { data, error } = await svc
    .from('escrow_voucher_upload_tokens')
    .select('id, recipient_name, recipient_email, created_at, expires_at, used_at, revoked_at, token_hash')
    .eq('tenant_id', tenantId)
    .eq('project_id', input.project_id)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) {
    console.error('[escrow.listProjectTokens] select failed', error)
    return { ok: false, error: error.message || 'Could not load links.' }
  }

  type Row = {
    id: string
    recipient_name: string
    recipient_email: string
    created_at: string
    expires_at: string
    used_at: string | null
    revoked_at: string | null
    token_hash: string
  }
  const tokens: ProjectTokenRow[] = ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    recipient_name: r.recipient_name,
    recipient_email: r.recipient_email,
    created_at: r.created_at,
    expires_at: r.expires_at,
    used_at: r.used_at,
    revoked_at: r.revoked_at,
    // URL hint: never the raw token (we don't store it). Show a hash prefix
    // so the trustee can at least correlate rows with audit log entries.
    url_hint: `${siteUrl()}/upload-voucher/…${r.token_hash.slice(0, 8)}`,
  }))

  return { ok: true, tokens }
}
