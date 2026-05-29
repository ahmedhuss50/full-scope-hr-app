'use server'

import crypto from 'crypto'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/resend'

// ============================================================================
// Disbursements — Tokenized client-upload links
//
// An employee/supervisor/owner generates a magic-link URL and sends it to a
// developer's controller. The developer opens the URL (no login) and uploads
// one combined PDF (voucher + invoices + proofs) at /upload-disbursement/[token].
//
// Mirrors the escrow share-upload-link pattern. We store ONLY the sha256 of the
// raw token; the raw value is shown once at generation time.
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
  dsbRole: string | null
}

async function resolveCaller(): Promise<Caller | null> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return null

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) return null
  return {
    tenantId: profile.tenant_id as string,
    userId: profile.id as string,
    dsbRole: (profile.dsb_role as string | null) ?? null,
  }
}

// ----------------------------------------------------------------------------
// 1) createDsbUploadToken
// ----------------------------------------------------------------------------

export interface CreateDsbUploadTokenInput {
  developer_id: string
  project_id?: string | null
  recipient_name: string
  recipient_email: string
  expires_days: number
  notes?: string | null
  send_email?: boolean
}

export type CreateDsbUploadTokenResult =
  | {
      ok: true
      url: string
      token_raw: string
      expires_at: string
      email_sent: boolean
      email_reason?: string
    }
  | { ok: false; error: string }

export async function createDsbUploadToken(
  input: CreateDsbUploadTokenInput,
): Promise<CreateDsbUploadTokenResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (!caller.dsbRole || !['employee', 'supervisor', 'owner'].includes(caller.dsbRole)) {
    return { ok: false, error: 'لا تملك صلاحية إنشاء روابط رفع.' }
  }

  if (!input.developer_id) return { ok: false, error: 'العميل مطلوب.' }
  const recipientName = (input.recipient_name ?? '').trim()
  const recipientEmail = (input.recipient_email ?? '').trim().toLowerCase()
  if (!recipientName) return { ok: false, error: 'اسم المستلم مطلوب.' }
  if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    return { ok: false, error: 'يرجى إدخال بريد إلكتروني صالح.' }
  }
  const expiresDays = Math.min(
    MAX_EXPIRES_DAYS,
    Math.max(MIN_EXPIRES_DAYS, Math.round(input.expires_days || DEFAULT_EXPIRES_DAYS)),
  )

  const svc = createSupabaseService()

  // Verify the developer belongs to this tenant.
  const { data: dev } = await svc
    .from('dsb_developers')
    .select('id, tenant_id, company_name_ar')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.developer_id)
    .maybeSingle()
  if (!dev) return { ok: false, error: 'العميل غير موجود.' }

  // If a project was specified, verify it belongs to this tenant + developer.
  let projectId: string | null = null
  let projectName: string | null = null
  if (input.project_id) {
    const { data: proj } = await svc
      .from('dsb_projects')
      .select('id, tenant_id, developer_id, name_ar, code')
      .eq('tenant_id', caller.tenantId)
      .eq('id', input.project_id)
      .maybeSingle()
    if (!proj) return { ok: false, error: 'المشروع غير موجود.' }
    if (proj.developer_id && proj.developer_id !== input.developer_id) {
      return { ok: false, error: 'المشروع لا يخص هذا العميل.' }
    }
    projectId = proj.id as string
    projectName = `${proj.code as string} — ${proj.name_ar as string}`
  }

  // Tenant display name for the email.
  const { data: tenantRow } = await svc
    .from('tenants')
    .select('name')
    .eq('id', caller.tenantId)
    .maybeSingle()
  const firmName = (tenantRow?.name as string | undefined) ?? 'Full Scope'
  const developerName = (dev.company_name_ar as string) ?? 'العميل'

  // Mint the token + hash it.
  const tokenRaw = generateRawToken()
  const tokenHash = hashToken(tokenRaw)
  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString()

  const { error: insertErr } = await svc
    .from('dsb_upload_tokens')
    .insert({
      tenant_id: caller.tenantId,
      developer_id: input.developer_id,
      project_id: projectId,
      case_id: null,
      token_hash: tokenHash,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      expires_at: expiresAt,
      used_at: null,
      revoked_at: null,
      created_by_user_id: caller.userId,
      notes: input.notes?.trim() || null,
    })
  if (insertErr) {
    console.error('[dsb.createDsbUploadToken] insert failed', insertErr)
    return { ok: false, error: insertErr.message || 'تعذّر إنشاء الرابط.' }
  }

  const url = `${siteUrl()}/upload-disbursement/${tokenRaw}`

  // Optional email — best-effort.
  let emailSent = false
  let emailReason: string | undefined
  if (input.send_email !== false) {
    try {
      const projectLine = projectName
        ? `<li>المشروع: <strong>${escapeHtml(projectName)}</strong></li>`
        : ''
      const html = `<!doctype html>
<html dir="rtl" lang="ar"><body style="font-family:Cairo,Tahoma,Arial,sans-serif;color:#0f172a;padding:24px;max-width:600px;margin:0 auto;line-height:1.7;">
  <h2 style="color:#0f172a;margin:0 0 12px;">رفع وثيقة صرف</h2>
  <p>مرحباً ${escapeHtml(recipientName)}،</p>
  <p>يرجى رفع سند الصرف والمستندات الداعمة لشركة <strong>${escapeHtml(developerName)}</strong> عبر الرابط أدناه. لا حاجة لتسجيل دخول.</p>
  <ul>${projectLine}</ul>
  <p style="margin:32px 0;">
    <a href="${url}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">رفع وثيقة الصرف</a>
  </p>
  <p style="color:#64748b;font-size:12px;">ينتهي هذا الرابط خلال ${expiresDays} يوم. إذا واجهت مشكلة، يمكنك الردّ على هذا البريد.</p>
  <p style="color:#94a3b8;font-size:11px;">${escapeHtml(firmName)}</p>
</body></html>`

      const text = `مرحباً ${recipientName},

يرجى رفع سند الصرف والمستندات الداعمة لـ ${developerName} عبر الرابط التالي (لا حاجة لتسجيل دخول):

${url}

ينتهي الرابط خلال ${expiresDays} يوم.

— ${firmName}`

      const result = await sendEmail({
        from: 'Full Scope <notifications@fullscope.sa>',
        to: recipientEmail,
        subject: `رفع وثيقة صرف — ${developerName}`,
        html,
        text,
        locale: 'ar',
      })
      emailSent = result.sent
      emailReason = result.reason
    } catch (err) {
      console.warn('[dsb.createDsbUploadToken] email failed', err)
      emailSent = false
      emailReason = err instanceof Error ? err.message : 'Unknown email error'
    }
  }

  return {
    ok: true,
    url,
    token_raw: tokenRaw,
    expires_at: expiresAt,
    email_sent: emailSent,
    email_reason: emailReason,
  }
}

// ----------------------------------------------------------------------------
// 2) revokeDsbUploadToken
// ----------------------------------------------------------------------------

export interface RevokeDsbUploadTokenInput {
  token_id: string
}

export type RevokeDsbUploadTokenResult = { ok: true } | { ok: false; error: string }

export async function revokeDsbUploadToken(
  input: RevokeDsbUploadTokenInput,
): Promise<RevokeDsbUploadTokenResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (!caller.dsbRole || !['employee', 'supervisor', 'owner'].includes(caller.dsbRole)) {
    return { ok: false, error: 'لا تملك الصلاحية.' }
  }

  if (!input.token_id) return { ok: false, error: 'بيانات ناقصة.' }

  const svc = createSupabaseService()
  const { error } = await svc
    .from('dsb_upload_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.token_id)
  if (error) {
    console.error('[dsb.revokeDsbUploadToken] update failed', error)
    return { ok: false, error: error.message || 'تعذّر إلغاء الرابط.' }
  }
  return { ok: true }
}

// ----------------------------------------------------------------------------
// 3) listDsbUploadTokens
// ----------------------------------------------------------------------------

export interface ListDsbUploadTokensInput {
  developer_id: string
}

export interface DsbUploadTokenRow {
  id: string
  recipient_name: string
  recipient_email: string
  project_id: string | null
  created_at: string
  expires_at: string
  used_at: string | null
  revoked_at: string | null
}

export type ListDsbUploadTokensResult =
  | { ok: true; tokens: DsbUploadTokenRow[] }
  | { ok: false; error: string }

export async function listDsbUploadTokens(
  input: ListDsbUploadTokensInput,
): Promise<ListDsbUploadTokensResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (!caller.dsbRole || !['employee', 'supervisor', 'owner'].includes(caller.dsbRole)) {
    return { ok: false, error: 'لا تملك الصلاحية.' }
  }

  if (!input.developer_id) return { ok: false, error: 'العميل مطلوب.' }

  const svc = createSupabaseService()
  const nowIso = new Date().toISOString()
  const { data, error } = await svc
    .from('dsb_upload_tokens')
    .select('id, recipient_name, recipient_email, project_id, created_at, expires_at, used_at, revoked_at')
    .eq('tenant_id', caller.tenantId)
    .eq('developer_id', input.developer_id)
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) {
    console.error('[dsb.listDsbUploadTokens] select failed', error)
    return { ok: false, error: error.message || 'تعذّر جلب الروابط.' }
  }

  type Row = {
    id: string
    recipient_name: string
    recipient_email: string
    project_id: string | null
    created_at: string
    expires_at: string
    used_at: string | null
    revoked_at: string | null
  }
  const tokens: DsbUploadTokenRow[] = ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    recipient_name: r.recipient_name,
    recipient_email: r.recipient_email,
    project_id: r.project_id,
    created_at: r.created_at,
    expires_at: r.expires_at,
    used_at: r.used_at,
    revoked_at: r.revoked_at,
  }))

  return { ok: true, tokens }
}
