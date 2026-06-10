'use server'

import crypto from 'crypto'
import { createSupabaseService } from '@/lib/supabase/server'
import { sendDeveloperUploadedEmail } from '@/lib/email/disbursement-emails'
import { fireDsbBreakdownWebhook } from '@/lib/n8n/fire-dsb-breakdown'

// ============================================================================
// Public (tokenized) disbursement upload — server actions.
//
// MIRRORS /app/developer/new/actions.ts but authenticated via the magic-link
// token instead of a logged-in user session.
//
//   1. createCaseViaToken         — inserts dsb_cases row (status='draft')
//   2. requestUploadUrlViaToken   — mints signed Storage upload URL
//   3. registerUploadViaToken     — records upload, flips status to
//                                   'with_employee', burns the token, writes
//                                   audit log, emails the assigned employee.
//
// EVERY action re-hashes and re-validates the token (not-expired, not-used,
// not-revoked). The raw token is never persisted; we only have its sha256.
// ============================================================================

const STORAGE_BUCKET = 'Document submission'
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB per file

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180)
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

// ----------------------------------------------------------------------------
// Token resolution
// ----------------------------------------------------------------------------

interface ResolvedToken {
  token_id: string
  tenant_id: string
  developer_id: string
  project_id: string | null
  case_id: string | null
  recipient_name: string
  recipient_email: string
}

async function resolveToken(token_raw: string): Promise<ResolvedToken | null> {
  if (!token_raw || token_raw.length < 16) return null
  const svc = createSupabaseService()
  const hash = hashToken(token_raw)
  const { data } = await svc
    .from('dsb_upload_tokens')
    .select(
      'id, tenant_id, developer_id, project_id, case_id, recipient_name, recipient_email, expires_at, used_at, revoked_at',
    )
    .eq('token_hash', hash)
    .maybeSingle()
  if (!data) return null
  if (data.revoked_at) return null
  if (data.used_at) return null
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null
  return {
    token_id: data.id as string,
    tenant_id: data.tenant_id as string,
    developer_id: data.developer_id as string,
    project_id: (data.project_id as string | null) ?? null,
    case_id: (data.case_id as string | null) ?? null,
    recipient_name: data.recipient_name as string,
    recipient_email: data.recipient_email as string,
  }
}

async function nextCaseNumber(tenantId: string): Promise<string> {
  const svc = createSupabaseService()
  const { data } = await svc
    .from('dsb_cases')
    .select('case_number')
    .eq('tenant_id', tenantId)
    .order('case_number', { ascending: false })
    .limit(1)
  const last = (data?.[0]?.case_number as string | undefined) ?? null
  let n = 1
  if (last) {
    const m = /(\d+)\s*$/.exec(last)
    if (m) n = parseInt(m[1], 10) + 1
  }
  return `DSB-${String(n).padStart(4, '0')}`
}

// ----------------------------------------------------------------------------
// 1) createCaseViaToken
// ----------------------------------------------------------------------------

export interface CreateCaseViaTokenInput {
  token_raw: string
  project_id: string
  voucher_number_text: string
  voucher_date: string
  amount_sar: number
  delivery_date?: string | null
  notes?: string | null
}

export type CreateCaseViaTokenResult =
  | { ok: true; case_id: string; case_number: string }
  | { ok: false; error: string }

export async function createCaseViaToken(
  input: CreateCaseViaTokenInput,
): Promise<CreateCaseViaTokenResult> {
  const tok = await resolveToken(input.token_raw)
  if (!tok) return { ok: false, error: 'الرابط غير صالح أو منتهي الصلاحية.' }

  if (!input.project_id) return { ok: false, error: 'المشروع مطلوب.' }
  if (!input.voucher_number_text?.trim()) return { ok: false, error: 'رقم سند الصرف مطلوب.' }
  if (!input.voucher_date) return { ok: false, error: 'تاريخ سند الصرف مطلوب.' }
  if (!(input.amount_sar > 0)) return { ok: false, error: 'يجب أن يكون المبلغ أكبر من صفر.' }

  const svc = createSupabaseService()

  // Project must belong to the same tenant + (be tied to this developer OR be
  // untied legacy).
  const { data: project } = await svc
    .from('dsb_projects')
    .select('id, tenant_id, developer_id')
    .eq('tenant_id', tok.tenant_id)
    .eq('id', input.project_id)
    .maybeSingle()
  if (!project) return { ok: false, error: 'المشروع غير موجود.' }
  const projDevId = (project as { developer_id: string | null }).developer_id
  if (projDevId && projDevId !== tok.developer_id) {
    return { ok: false, error: 'المشروع لا يخص هذا العميل.' }
  }

  const caseNumber = await nextCaseNumber(tok.tenant_id)

  const { data: row, error } = await svc
    .from('dsb_cases')
    .insert({
      tenant_id: tok.tenant_id,
      project_id: input.project_id,
      developer_id: tok.developer_id,
      case_number: caseNumber,
      voucher_number_text: input.voucher_number_text.trim(),
      voucher_date: input.voucher_date,
      amount_sar: input.amount_sar,
      delivery_date: input.delivery_date || null,
      status: 'draft',
      notes: input.notes?.trim() || null,
    })
    .select('id')
    .single()
  if (error || !row) {
    console.error('[dsb.createCaseViaToken] insert failed', error)
    return { ok: false, error: error?.message || 'فشل إنشاء الطلب.' }
  }

  return { ok: true, case_id: row.id as string, case_number: caseNumber }
}

// ----------------------------------------------------------------------------
// 2) requestUploadUrlViaToken
// ----------------------------------------------------------------------------

export interface RequestUploadUrlViaTokenInput {
  token_raw: string
  case_id: string
  filename: string
  mime: string
  size: number
}

export type RequestUploadUrlViaTokenResult =
  | { ok: true; signed_url: string; storage_path: string }
  | { ok: false; error: string }

export async function requestUploadUrlViaToken(
  input: RequestUploadUrlViaTokenInput,
): Promise<RequestUploadUrlViaTokenResult> {
  const tok = await resolveToken(input.token_raw)
  if (!tok) return { ok: false, error: 'الرابط غير صالح أو منتهي الصلاحية.' }

  if (!input.case_id) return { ok: false, error: 'بيانات ناقصة.' }
  if (!input.size || input.size <= 0) return { ok: false, error: 'حجم الملف غير صالح.' }
  if (input.size > MAX_FILE_SIZE) {
    return { ok: false, error: 'حجم الملف يتجاوز الحد الأقصى (50 ميغابايت).' }
  }

  const svc = createSupabaseService()
  const { data: kase } = await svc
    .from('dsb_cases')
    .select('id, tenant_id, developer_id')
    .eq('tenant_id', tok.tenant_id)
    .eq('id', input.case_id)
    .maybeSingle()
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }
  if ((kase as { developer_id: string }).developer_id !== tok.developer_id) {
    return { ok: false, error: 'الطلب لا يخص هذا الرابط.' }
  }

  const uuid = crypto.randomUUID()
  const safe = sanitizeFilename(input.filename || `upload-${uuid}.pdf`)
  const storagePath = `dsb/${tok.tenant_id}/${input.case_id}/${uuid}-${safe}`

  const { data, error } = await svc.storage.from(STORAGE_BUCKET).createSignedUploadUrl(storagePath)
  if (error || !data) {
    console.error('[dsb.requestUploadUrlViaToken] createSignedUploadUrl failed', error)
    return { ok: false, error: 'تعذّر إنشاء رابط الرفع.' }
  }
  return { ok: true, signed_url: data.signedUrl, storage_path: data.path ?? storagePath }
}

// ----------------------------------------------------------------------------
// 3) registerUploadViaToken
// ----------------------------------------------------------------------------

export interface RegisterUploadViaTokenInput {
  token_raw: string
  case_id: string
  storage_path: string
  filename: string
  size: number
  mime: string
}

export type RegisterUploadViaTokenResult =
  | { ok: true; redirect_to: string }
  | { ok: false; error: string }

export async function registerUploadViaToken(
  input: RegisterUploadViaTokenInput,
): Promise<RegisterUploadViaTokenResult> {
  const tok = await resolveToken(input.token_raw)
  if (!tok) return { ok: false, error: 'الرابط غير صالح أو منتهي الصلاحية.' }

  if (!input.case_id) return { ok: false, error: 'بيانات ناقصة.' }
  if (!input.storage_path) return { ok: false, error: 'مسار الملف غير صالح.' }

  const svc = createSupabaseService()

  type CaseSnapshot = {
    id: string
    tenant_id: string
    case_number: string
    amount_sar: number | null
    status: string
    project_id: string
    developer_id: string
    project:
      | { name_ar: string; assigned_employee_id: string | null }
      | { name_ar: string; assigned_employee_id: string | null }[]
      | null
    developer: { company_name_ar: string } | { company_name_ar: string }[] | null
  }

  const { data: kaseRaw } = await svc
    .from('dsb_cases')
    .select(
      `id, tenant_id, case_number, amount_sar, status, project_id, developer_id,
       project:dsb_projects!dsb_cases_project_id_fkey(name_ar, assigned_employee_id),
       developer:dsb_developers!dsb_cases_developer_id_fkey(company_name_ar)`,
    )
    .eq('tenant_id', tok.tenant_id)
    .eq('id', input.case_id)
    .maybeSingle()
  const kase = kaseRaw as CaseSnapshot | null
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }
  if (kase.developer_id !== tok.developer_id) {
    return { ok: false, error: 'الطلب لا يخص هذا الرابط.' }
  }

  // 1) Insert the upload row.
  const { error: upErr } = await svc.from('dsb_uploads').insert({
    tenant_id: tok.tenant_id,
    case_id: input.case_id,
    filename: sanitizeFilename(input.filename),
    storage_path: input.storage_path,
    storage_bucket: STORAGE_BUCKET,
    file_size_bytes: input.size,
    mime_type: input.mime || 'application/pdf',
    uploaded_by_user_id: null,
  })
  if (upErr) {
    console.error('[dsb.registerUploadViaToken] insert upload failed', upErr)
    return { ok: false, error: upErr.message || 'فشل تسجيل الرفع.' }
  }

  const project = Array.isArray(kase.project) ? kase.project[0] : kase.project
  const developer = Array.isArray(kase.developer) ? kase.developer[0] : kase.developer
  const fromStatus = kase.status

  // 2) Flip case status draft → with_employee (only if still draft — defensive).
  if (fromStatus === 'draft' || fromStatus === 'sent_back_to_developer') {
    const { error: updErr } = await svc
      .from('dsb_cases')
      .update({ status: 'with_employee', submitted_at: new Date().toISOString() })
      .eq('id', input.case_id)
      .eq('tenant_id', tok.tenant_id)
    if (updErr) {
      console.error('[dsb.registerUploadViaToken] case update failed', updErr)
      // Non-fatal: the upload is recorded.
    }
  }

  // 3) Burn the token + tie it to the case for audit traceability.
  const { error: tokErr } = await svc
    .from('dsb_upload_tokens')
    .update({ used_at: new Date().toISOString(), case_id: input.case_id })
    .eq('id', tok.token_id)
  if (tokErr) {
    console.error('[dsb.registerUploadViaToken] token burn failed', tokErr)
    // Non-fatal — primary write succeeded.
  }

  // 4) Audit log entry.
  await svc.from('dsb_audit_log').insert({
    tenant_id: tok.tenant_id,
    case_id: input.case_id,
    event: 'uploaded',
    actor_user_id: null,
    from_status: fromStatus,
    to_status: 'with_employee',
    notes: `Tokenized upload by ${tok.recipient_name} <${tok.recipient_email}>`,
  })

  // 5) Email the assigned employee (best-effort, fire-and-forget).
  const assignedEmpId = project?.assigned_employee_id ?? null
  if (assignedEmpId) {
    const { data: emp } = await svc
      .from('users')
      .select('email')
      .eq('id', assignedEmpId)
      .maybeSingle()
    const empEmail = (emp?.email as string | undefined) ?? null
    if (empEmail) {
      const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fullscope.sa'
      sendDeveloperUploadedEmail({
        to: empEmail,
        caseNumber: kase.case_number,
        projectName: project?.name_ar ?? '—',
        developerName: developer?.company_name_ar ?? '—',
        amountSar: kase.amount_sar,
        caseUrl: `${origin}/app/disbursements/${input.case_id}`,
      }).catch((e) => console.error('[dsb.registerUploadViaToken] email failed', e))
    }
  }

  // 6) Fire-and-forget AI breakdown.
  fireDsbBreakdownWebhook({ case_id: input.case_id, tenant_id: tok.tenant_id }).catch(
    (e) => console.error('[dsb.registerUploadViaToken] fireDsbBreakdownWebhook failed', e),
  )

  return { ok: true, redirect_to: `/upload-disbursement/${input.token_raw}/done` }
}
