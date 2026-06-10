'use server'

import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { sendDeveloperUploadedEmail } from '@/lib/email/disbursement-emails'
import { fireDsbBreakdownWebhook } from '@/lib/n8n/fire-dsb-breakdown'

const STORAGE_BUCKET = 'Document submission'
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

type StaffRole = 'employee' | 'supervisor' | 'owner'

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180)
}

async function resolveStaff(): Promise<
  | { tenantId: string; userId: string; dsbRole: StaffRole; email: string }
  | { error: string }
> {
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
    dsbRole: role as StaffRole,
    email: user.email,
  }
}

/**
 * Compute the next case number by looking at the highest existing
 * `case_number` for this tenant and incrementing — NOT by counting rows,
 * because deletes would drop the count and let us re-collide on a number
 * we already used.
 */
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
// createCaseByStaff — employee uploads on behalf of a developer
// ----------------------------------------------------------------------------

export interface CreateCaseByStaffInput {
  developer_id: string
  project_id: string
  // The following are optional — the AI extracts them from the PDF after
  // upload. The form can omit them entirely.
  voucher_number_text?: string | null
  voucher_date?: string | null
  amount_sar?: number | null
  delivery_date?: string | null
  notes?: string | null
}

export type CreateCaseByStaffResult =
  | { ok: true; case_id: string; case_number: string }
  | { ok: false; error: string }

export async function createCaseByStaff(input: CreateCaseByStaffInput): Promise<CreateCaseByStaffResult> {
  const caller = await resolveStaff()
  if ('error' in caller) return { ok: false, error: caller.error }

  // Client + project are the only required fields up-front. Voucher number,
  // date, amount, etc. are filled in by the AI extraction after upload, and
  // can be edited manually later if anything is wrong.
  if (!input.developer_id || !input.project_id) return { ok: false, error: 'يرجى اختيار العميل والمشروع.' }

  const svc = createSupabaseService()

  // Confirm developer belongs to this tenant.
  const { data: dev } = await svc
    .from('dsb_developers')
    .select('id, tenant_id')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.developer_id)
    .maybeSingle()
  if (!dev) return { ok: false, error: 'المطور غير موجود.' }

  // Confirm project belongs to this tenant.
  const { data: project } = await svc
    .from('dsb_projects')
    .select('id, tenant_id')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.project_id)
    .maybeSingle()
  if (!project) return { ok: false, error: 'المشروع غير موجود.' }

  const caseNumber = await nextCaseNumber(caller.tenantId)

  // Employee uploading on behalf — case lands directly in employee inbox.
  // All metadata fields are optional; the AI extraction will populate them
  // and the staff can edit manually via EditCaseInfo if needed.
  const voucherNum = input.voucher_number_text?.trim() || null
  const amountRaw = input.amount_sar
  const amount =
    typeof amountRaw === 'number' && Number.isFinite(amountRaw) && amountRaw > 0
      ? amountRaw
      : null
  const { data: row, error } = await svc
    .from('dsb_cases')
    .insert({
      tenant_id: caller.tenantId,
      project_id: input.project_id,
      developer_id: input.developer_id,
      case_number: caseNumber,
      voucher_number_text: voucherNum,
      voucher_date: input.voucher_date || null,
      amount_sar: amount,
      delivery_date: input.delivery_date || null,
      status: 'with_employee',
      submitted_at: new Date().toISOString(),
      notes: input.notes?.trim() || null,
    })
    .select('id')
    .single()
  if (error || !row) {
    console.error('[dsb.createCaseByStaff] insert failed', error)
    return { ok: false, error: error?.message ?? 'فشل إنشاء سند الصرف.' }
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
  const caller = await resolveStaff()
  if ('error' in caller) return { ok: false, error: caller.error }

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
  const storagePath = `dsb/${caller.tenantId}/${input.case_id}/${uuid}-${safe}`

  const { data, error } = await svc.storage.from(STORAGE_BUCKET).createSignedUploadUrl(storagePath)
  if (error || !data) {
    console.error('[dsb.staff.requestUploadUrl] createSignedUploadUrl failed', error)
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
  const caller = await resolveStaff()
  if ('error' in caller) return { ok: false, error: caller.error }

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
    console.error('[dsb.staff.registerUpload] insert failed', error)
    return { ok: false, error: error.message }
  }

  return { ok: true }
}

// ----------------------------------------------------------------------------
// finalizeStaffUpload — audit log + email assigned employee (if not the caller)
// ----------------------------------------------------------------------------

export interface FinalizeStaffUploadInput { case_id: string }
export type FinalizeStaffUploadResult = { ok: true } | { ok: false; error: string }

export async function finalizeStaffUpload(
  input: FinalizeStaffUploadInput,
): Promise<FinalizeStaffUploadResult> {
  const caller = await resolveStaff()
  if ('error' in caller) return { ok: false, error: caller.error }

  const svc = createSupabaseService()

  type CaseSnapshot = {
    id: string
    tenant_id: string
    case_number: string
    amount_sar: number | null
    status: string
    project: { name_ar: string; assigned_employee_id: string | null } | { name_ar: string; assigned_employee_id: string | null }[] | null
    developer: { company_name_ar: string } | { company_name_ar: string }[] | null
  }

  const { data: kaseRaw } = await svc
    .from('dsb_cases')
    .select(`id, tenant_id, case_number, amount_sar, status,
             project:dsb_projects!dsb_cases_project_id_fkey(name_ar, assigned_employee_id),
             developer:dsb_developers!dsb_cases_developer_id_fkey(company_name_ar)`)
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.case_id)
    .maybeSingle()
  const kase = kaseRaw as CaseSnapshot | null
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }

  const project = Array.isArray(kase.project) ? kase.project[0] : kase.project
  const developer = Array.isArray(kase.developer) ? kase.developer[0] : kase.developer

  // Audit log: 'uploaded' (no prior status — staff created it directly).
  await svc.from('dsb_audit_log').insert({
    tenant_id: caller.tenantId,
    case_id: input.case_id,
    event: 'uploaded',
    actor_user_id: caller.userId,
    from_status: null,
    to_status: 'with_employee',
    notes: 'تم الرفع من قبل موظف فُل سكوب نيابةً عن المطوّر.',
  })

  // Email assigned employee if they aren't the uploader.
  const assignedEmpId = project?.assigned_employee_id ?? null
  if (assignedEmpId && assignedEmpId !== caller.userId) {
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
      }).catch((e) => console.error('[dsb.staff] email failed', e))
    }
  }

  // Fire-and-forget AI breakdown.
  fireDsbBreakdownWebhook({ case_id: input.case_id, tenant_id: caller.tenantId }).catch(
    (e) => console.error('[dsb.staff] fireDsbBreakdownWebhook failed', e),
  )

  return { ok: true }
}
