'use server'

import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { sendDeveloperUploadedEmail } from '@/lib/email/disbursement-emails'
import { fireDsbBreakdownWebhook } from '@/lib/n8n/fire-dsb-breakdown'

const STORAGE_BUCKET = 'Document submission'
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180)
}

async function resolveCaller(): Promise<
  | { tenantId: string; userId: string; dsbRole: string | null }
  | null
> {
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

async function nextCaseNumber(tenantId: string): Promise<string> {
  const svc = createSupabaseService()
  const { count } = await svc
    .from('dsb_cases')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
  const n = (count ?? 0) + 1
  return `DSB-${String(n).padStart(4, '0')}`
}

// ----------------------------------------------------------------------------
// createDisbursementCase
// ----------------------------------------------------------------------------

export interface CreateDisbursementCaseInput {
  developer_id: string
  project_id: string
  voucher_number_text: string
  voucher_date: string
  amount_sar: number
  notes?: string | null
}

export type CreateDisbursementCaseResult =
  | { ok: true; case_id: string; case_number: string }
  | { ok: false; error: string }

export async function createDisbursementCase(
  input: CreateDisbursementCaseInput,
): Promise<CreateDisbursementCaseResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (caller.dsbRole !== 'developer') return { ok: false, error: 'لا تملك صلاحية إنشاء طلب.' }

  if (!input.developer_id || !input.project_id) return { ok: false, error: 'بيانات ناقصة.' }
  if (!input.voucher_number_text?.trim()) return { ok: false, error: 'رقم السند مطلوب.' }
  if (!input.voucher_date) return { ok: false, error: 'تاريخ السند مطلوب.' }
  if (!(input.amount_sar > 0)) return { ok: false, error: 'يجب أن يكون المبلغ أكبر من صفر.' }

  const svc = createSupabaseService()

  // Confirm developer belongs to this tenant + this user.
  const { data: dev } = await svc
    .from('dsb_developers')
    .select('id, tenant_id, user_id')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.developer_id)
    .maybeSingle()
  if (!dev || dev.user_id !== caller.userId) {
    return { ok: false, error: 'لا يمكنك إنشاء طلب باسم هذا المطوّر.' }
  }

  // Confirm project belongs to tenant.
  const { data: project } = await svc
    .from('dsb_projects')
    .select('id, tenant_id')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.project_id)
    .maybeSingle()
  if (!project) return { ok: false, error: 'المشروع غير موجود.' }

  const caseNumber = await nextCaseNumber(caller.tenantId)

  const { data: row, error } = await svc
    .from('dsb_cases')
    .insert({
      tenant_id: caller.tenantId,
      project_id: input.project_id,
      developer_id: input.developer_id,
      case_number: caseNumber,
      voucher_number_text: input.voucher_number_text.trim(),
      voucher_date: input.voucher_date,
      amount_sar: input.amount_sar,
      status: 'draft',
      notes: input.notes?.trim() || null,
    })
    .select('id')
    .single()
  if (error || !row) {
    console.error('[dsb.createDisbursementCase] insert failed', error)
    return { ok: false, error: error?.message ?? 'فشل إنشاء الطلب.' }
  }

  return { ok: true, case_id: row.id as string, case_number: caseNumber }
}

// ----------------------------------------------------------------------------
// requestUploadUrl
// ----------------------------------------------------------------------------

export interface RequestUploadUrlInput {
  case_id: string
  filename: string
  mime: string
  size: number
}

export type RequestUploadUrlResult =
  | { ok: true; signed_url: string; storage_path: string }
  | { ok: false; error: string }

export async function requestUploadUrl(input: RequestUploadUrlInput): Promise<RequestUploadUrlResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (caller.dsbRole !== 'developer') return { ok: false, error: 'لا تملك صلاحية.' }

  if (!input.case_id) return { ok: false, error: 'بيانات ناقصة.' }
  if (!input.size || input.size <= 0) return { ok: false, error: 'حجم الملف غير صالح.' }
  if (input.size > MAX_FILE_SIZE) return { ok: false, error: 'حجم الملف يتجاوز الحد الأقصى (50 ميغابايت).' }

  const svc = createSupabaseService()
  const { data: kase } = await svc
    .from('dsb_cases')
    .select('id, tenant_id, project_id, developer_id')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.case_id)
    .maybeSingle()
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }

  const uuid = crypto.randomUUID()
  const safe = sanitizeFilename(input.filename || `upload-${uuid}.pdf`)
  const storagePath = `dsb/${caller.tenantId}/${kase.project_id}/${input.case_id}/${uuid}-${safe}`

  const { data, error } = await svc.storage.from(STORAGE_BUCKET).createSignedUploadUrl(storagePath)
  if (error || !data) {
    console.error('[dsb.requestUploadUrl] createSignedUploadUrl failed', error)
    return { ok: false, error: 'تعذّر إنشاء رابط الرفع.' }
  }
  return { ok: true, signed_url: data.signedUrl, storage_path: data.path ?? storagePath }
}

// ----------------------------------------------------------------------------
// registerUpload
// ----------------------------------------------------------------------------

export interface RegisterUploadInput {
  case_id: string
  storage_path: string
  filename: string
  size: number
  mime: string
}

export type RegisterUploadResult = { ok: true } | { ok: false; error: string }

export async function registerUpload(input: RegisterUploadInput): Promise<RegisterUploadResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }

  const svc = createSupabaseService()
  const { data: kase } = await svc
    .from('dsb_cases')
    .select('id, tenant_id')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.case_id)
    .maybeSingle()
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }

  const { error } = await svc.from('dsb_uploads').insert({
    tenant_id: caller.tenantId,
    case_id: input.case_id,
    filename: sanitizeFilename(input.filename),
    storage_path: input.storage_path,
    storage_bucket: STORAGE_BUCKET,
    file_size_bytes: input.size,
    mime_type: input.mime || 'application/pdf',
    uploaded_by_user_id: caller.userId,
  })
  if (error) {
    console.error('[dsb.registerUpload] insert failed', error)
    return { ok: false, error: error.message }
  }

  return { ok: true }
}

// ----------------------------------------------------------------------------
// submitDisbursement — flips status draft → with_employee + emails employee
// ----------------------------------------------------------------------------

export interface SubmitDisbursementInput { case_id: string }
export type SubmitDisbursementResult = { ok: true } | { ok: false; error: string }

export async function submitDisbursement(input: SubmitDisbursementInput): Promise<SubmitDisbursementResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (caller.dsbRole !== 'developer') return { ok: false, error: 'لا تملك صلاحية.' }

  const svc = createSupabaseService()

  type CaseSnapshot = {
    id: string
    tenant_id: string
    case_number: string
    amount_sar: number | null
    status: string
    project_id: string
    developer_id: string
    project: { name_ar: string; assigned_employee_id: string | null } | { name_ar: string; assigned_employee_id: string | null }[] | null
    developer: { company_name_ar: string } | { company_name_ar: string }[] | null
  }

  const { data: kaseRaw } = await svc
    .from('dsb_cases')
    .select(`id, tenant_id, case_number, amount_sar, status, project_id, developer_id,
             project:dsb_projects!dsb_cases_project_id_fkey(name_ar, assigned_employee_id),
             developer:dsb_developers!dsb_cases_developer_id_fkey(company_name_ar)`)
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.case_id)
    .maybeSingle()
  const kase = kaseRaw as CaseSnapshot | null
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }
  if (!['draft', 'sent_back_to_developer'].includes(kase.status)) {
    return { ok: false, error: 'حالة الطلب لا تسمح بالإرسال.' }
  }

  const project = Array.isArray(kase.project) ? kase.project[0] : kase.project
  const developer = Array.isArray(kase.developer) ? kase.developer[0] : kase.developer
  const fromStatus = kase.status
  const wasResubmit = fromStatus === 'sent_back_to_developer'

  const { error: updErr } = await svc
    .from('dsb_cases')
    .update({ status: 'with_employee', submitted_at: new Date().toISOString() })
    .eq('id', input.case_id)
    .eq('tenant_id', caller.tenantId)
  if (updErr) {
    console.error('[dsb.submitDisbursement] update failed', updErr)
    return { ok: false, error: updErr.message }
  }

  // Audit log.
  await svc.from('dsb_audit_log').insert({
    tenant_id: caller.tenantId,
    case_id: input.case_id,
    event: wasResubmit ? 'resubmitted' : 'uploaded',
    actor_user_id: caller.userId,
    from_status: fromStatus,
    to_status: 'with_employee',
  })

  // Email the assigned employee (if any).
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
      }).catch((e) => console.error('[dsb] email failed', e))
    }
  }

  // Fire-and-forget AI breakdown — never block the user's redirect on n8n latency.
  fireDsbBreakdownWebhook({ case_id: input.case_id, tenant_id: caller.tenantId }).catch(
    (e) => console.error('[dsb] fireDsbBreakdownWebhook failed', e),
  )

  return { ok: true }
}
