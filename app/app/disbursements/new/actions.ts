'use server'

import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { sendDeveloperUploadedEmail } from '@/lib/email/disbursement-emails'
import { fireDsbBreakdownWebhook } from '@/lib/n8n/fire-dsb-breakdown'

const STORAGE_BUCKET = 'Document submission'
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

type StaffRole = 'employee' | 'supervisor' | 'owner' | 'deliverer'

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
  // Deliverer can upload too — the upload privilege isn't tied to the
  // approval chain; they just kick off a new case for someone else to review.
  if (!role || !['employee', 'supervisor', 'owner', 'deliverer'].includes(role)) {
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
/**
 * Compute the next case_number for a project.
 *
 * Per migration 059, case_numbers are per-project sequential integers
 * starting at 1. Legacy DSB-#### values from the tenant-wide era stay in
 * the DB but don't affect the counter — the AI here counts any case whose
 * case_number is a pure integer, plus any DSB-#### value's numeric suffix,
 * so a project with old rows DSB-0187, DSB-0188 followed by new "1", "2"
 * would land at "189" next (avoids surprise collisions with the old
 * numbering while keeping the counter monotonic).
 */
async function nextCaseNumber(
  tenantId: string,
  projectId: string,
): Promise<string> {
  const svc = createSupabaseService()
  // Pull every case_number in this project — normally a few hundred at most
  // per project, so this is cheap. We can't cast/regex-filter in PostgREST
  // easily, so we do the "pick max integer suffix" scan client-side.
  const { data } = await svc
    .from('dsb_cases')
    .select('case_number')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
  const rows = (data ?? []) as Array<{ case_number: string | null }>

  let max = 0
  for (const r of rows) {
    const cn = (r.case_number ?? '').trim()
    if (!cn) continue
    // Pure integer ("1", "42", "0187").
    if (/^\d+$/.test(cn)) {
      const n = parseInt(cn, 10)
      if (n > max) max = n
      continue
    }
    // Legacy DSB-#### → strip the "DSB-" prefix and use the numeric
    // suffix, so new counters skip past the old numbering.
    const m = /^DSB-(\d+)$/i.exec(cn)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
    // Anything else (imported "ST001", "MAN0066", etc.) is ignored — those
    // came from historical Excels and belong to a foreign namespace.
  }
  return String(max + 1)
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

  // Employee uploading on behalf — case lands directly in employee inbox.
  // All metadata fields are optional; the AI extraction will populate them
  // and the staff can edit manually via EditCaseInfo if needed.
  const voucherNum = input.voucher_number_text?.trim() || null
  const amountRaw = input.amount_sar
  const amount =
    typeof amountRaw === 'number' && Number.isFinite(amountRaw) && amountRaw > 0
      ? amountRaw
      : null

  // Retry loop for case_number collisions. The constraint is now
  // (project_id, case_number) per migration 059 — DB is authoritative
  // on uniqueness. Concurrent uploads to the same project can both
  // compute the same next integer, so we bump and retry on 23505.
  let caseNumber = await nextCaseNumber(caller.tenantId, input.project_id)
  let row: { id: string } | null = null
  let lastError: { code?: string; message: string } | null = null
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await svc
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
    if (!error && data) {
      row = data as { id: string }
      break
    }
    lastError = error as { code?: string; message: string }
    // 23505 = unique_violation. Anything else = give up.
    if (error?.code !== '23505') {
      console.error('[dsb.createCaseByStaff] insert failed', error)
      return { ok: false, error: error?.message ?? 'فشل إنشاء سند الصرف.' }
    }
    // Bump: increment the integer counter and retry. Since case_numbers
    // are now plain integers per project, we just parse + add 1.
    const n = parseInt(caseNumber, 10)
    caseNumber = String((Number.isFinite(n) ? n : 0) + 1)
  }
  if (!row) {
    console.error('[dsb.createCaseByStaff] exhausted case_number retries', lastError)
    return {
      ok: false,
      error:
        'تعذّر تخصيص رقم فريد للطلب بعد عدة محاولات — يُرجى المحاولة بعد قليل.',
    }
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

  // Email all assigned employees (junction members + legacy single
  // pointer for backwards compatibility), excluding the caller. With the
  // multi-assignment model a project can have many reviewers; each should
  // get the upload notification.
  //
  // We first fetch the junction; if empty we fall back to the single
  // legacy pointer so unmigrated projects keep emailing exactly one person
  // like before.
  const legacyAssignedId = project?.assigned_employee_id ?? null
  const projectId = await (async () => {
    // The select above doesn't include project.id; refetch case to get it.
    const { data: c } = await svc
      .from('dsb_cases')
      .select('project_id')
      .eq('id', input.case_id)
      .maybeSingle()
    return (c?.project_id as string | undefined) ?? null
  })()

  let recipientUserIds: string[] = []
  if (projectId) {
    const { data: junctionRows } = await svc
      .from('dsb_project_employees')
      .select('user_id')
      .eq('project_id', projectId)
    const fromJunction = ((junctionRows ?? []) as { user_id: string }[]).map((r) => r.user_id)
    if (fromJunction.length > 0) {
      recipientUserIds = fromJunction
    } else if (legacyAssignedId) {
      recipientUserIds = [legacyAssignedId]
    }
  }

  // De-dupe and exclude the uploader.
  const recipients = Array.from(new Set(recipientUserIds)).filter(
    (uid) => uid && uid !== caller.userId,
  )

  if (recipients.length > 0) {
    // Fetch role too so we can filter out deliverers — deliverers only care
    // about signed docs (ready to hand off), not fresh uploads. They'll get
    // a targeted email at the sign stage instead. See sign* actions in
    // [caseId]/actions.ts.
    const { data: empRows } = await svc
      .from('users')
      .select('email, dsb_role')
      .in('id', recipients)
    const emails = ((empRows ?? []) as { email: string | null; dsb_role: string | null }[])
      .filter((r) => r.dsb_role !== 'deliverer')
      .map((r) => r.email)
      .filter((e): e is string => !!e)
    const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fullscope.sa'
    for (const to of emails) {
      sendDeveloperUploadedEmail({
        to,
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
