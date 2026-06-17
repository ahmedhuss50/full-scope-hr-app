'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import {
  sendDeveloperUploadedEmail,
  sendEmployeeApprovedEmail,
  sendSupervisorApprovedEmail,
  sendSentBackToDeveloperEmail,
  sendSignedEmail,
} from '@/lib/email/disbursement-emails'

type CaseStatus =
  | 'draft'
  | 'with_employee'
  | 'with_supervisor'
  | 'with_owner'
  | 'sent_back_to_developer'
  | 'signed'
  | 'cancelled'

type DsbRole = 'developer' | 'employee' | 'supervisor' | 'owner'

const STORAGE_BUCKET = 'Document submission'

async function resolveCaller(): Promise<
  | { tenantId: string; userId: string; dsbRole: DsbRole | null; email: string }
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
    dsbRole: (profile.dsb_role as DsbRole | null) ?? null,
    email: user.email,
  }
}

type CaseSnapshot = {
  id: string
  tenant_id: string
  case_number: string
  amount_sar: number | null
  status: CaseStatus
  project: { id: string; name_ar: string; assigned_employee_id: string | null } | { id: string; name_ar: string; assigned_employee_id: string | null }[] | null
  developer: { id: string; company_name_ar: string; contact_email: string | null; user_id: string | null } | { id: string; company_name_ar: string; contact_email: string | null; user_id: string | null }[] | null
}

async function loadCase(tenantId: string, caseId: string): Promise<CaseSnapshot | null> {
  const svc = createSupabaseService()
  const { data } = await svc
    .from('dsb_cases')
    .select(`id, tenant_id, case_number, amount_sar, status,
             project:dsb_projects!dsb_cases_project_id_fkey(id, name_ar, assigned_employee_id),
             developer:dsb_developers!dsb_cases_developer_id_fkey(id, company_name_ar, contact_email, user_id)`)
    .eq('tenant_id', tenantId)
    .eq('id', caseId)
    .maybeSingle()
  return (data as CaseSnapshot | null) ?? null
}

function single<T>(maybe: T | T[] | null | undefined): T | null {
  if (!maybe) return null
  return Array.isArray(maybe) ? (maybe[0] ?? null) : maybe
}

async function userEmail(svc: ReturnType<typeof createSupabaseService>, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  const { data } = await svc.from('users').select('email').eq('id', userId).maybeSingle()
  return (data?.email as string | undefined) ?? null
}

function appUrl(path: string): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fullscope.sa'
  return `${origin}${path}`
}

// ----------------------------------------------------------------------------
// upsertBreakdownItem
// ----------------------------------------------------------------------------

export interface UpsertBreakdownItemInput {
  case_id: string
  id?: string | null
  kind: string
  page_from: number | null
  page_to: number | null
  summary_ar: string | null
  order_index?: number
}

export type UpsertBreakdownItemResult = { ok: true; id: string } | { ok: false; error: string }

export async function upsertBreakdownItem(input: UpsertBreakdownItemInput): Promise<UpsertBreakdownItemResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (!['employee', 'supervisor', 'owner'].includes(caller.dsbRole ?? '')) {
    return { ok: false, error: 'لا تملك صلاحية تعديل التصنيف.' }
  }

  const svc = createSupabaseService()
  const kase = await loadCase(caller.tenantId, input.case_id)
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }

  const validKinds = ['voucher', 'invoice', 'proof_of_payment', 'completion_certificate', 'contract', 'receipt', 'other']
  if (!validKinds.includes(input.kind)) return { ok: false, error: 'نوع غير صالح.' }

  if (input.id) {
    const { data, error } = await svc
      .from('dsb_breakdown_items')
      .update({
        kind: input.kind,
        page_from: input.page_from,
        page_to: input.page_to,
        summary_ar: input.summary_ar,
        order_index: input.order_index ?? 0,
      })
      .eq('tenant_id', caller.tenantId)
      .eq('id', input.id)
      .eq('case_id', input.case_id)
      .select('id')
      .single()
    if (error || !data) return { ok: false, error: error?.message ?? 'فشل التحديث.' }
    revalidatePath(`/app/disbursements/${input.case_id}`)
    return { ok: true, id: data.id as string }
  }

  const { data, error } = await svc
    .from('dsb_breakdown_items')
    .insert({
      tenant_id: caller.tenantId,
      case_id: input.case_id,
      kind: input.kind,
      page_from: input.page_from,
      page_to: input.page_to,
      summary_ar: input.summary_ar,
      source: 'human',
      order_index: input.order_index ?? 0,
      created_by_user_id: caller.userId,
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'فشل الإنشاء.' }
  revalidatePath(`/app/disbursements/${input.case_id}`)
  return { ok: true, id: data.id as string }
}

// ----------------------------------------------------------------------------
// deleteBreakdownItem
// ----------------------------------------------------------------------------

export async function deleteBreakdownItem(input: { case_id: string; id: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (!['employee', 'supervisor', 'owner'].includes(caller.dsbRole ?? '')) {
    return { ok: false, error: 'لا تملك صلاحية الحذف.' }
  }
  const svc = createSupabaseService()
  const { error } = await svc
    .from('dsb_breakdown_items')
    .delete()
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.id)
    .eq('case_id', input.case_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/app/disbursements/${input.case_id}`)
  return { ok: true }
}

// ----------------------------------------------------------------------------
// approveCase — moves to next stage
// ----------------------------------------------------------------------------

export async function approveCase(input: { case_id: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }

  const svc = createSupabaseService()
  const kase = await loadCase(caller.tenantId, input.case_id)
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }

  const project = single(kase.project)
  const developer = single(kase.developer)

  let nextStatus: CaseStatus
  if (kase.status === 'with_employee') {
    // At the "with_employee" stage, the assigned user must act — regardless of
    // their role. This lets supervisors / owners run small clients themselves
    // without needing a separate employee account in the middle.
    if (!['employee', 'supervisor', 'owner'].includes(caller.dsbRole ?? '')) {
      return { ok: false, error: 'لا تملك صلاحية الاعتماد.' }
    }
    if (project?.assigned_employee_id !== caller.userId) {
      return { ok: false, error: 'هذا الطلب غير مُسند إليك.' }
    }
    nextStatus = 'with_supervisor'
  } else if (kase.status === 'with_supervisor') {
    if (caller.dsbRole !== 'supervisor') return { ok: false, error: 'لا تملك صلاحية الاعتماد.' }
    nextStatus = 'with_owner'
  } else {
    return { ok: false, error: 'حالة الطلب الحالية لا تسمح بالاعتماد.' }
  }

  const fromStatus = kase.status
  const { error: updErr } = await svc
    .from('dsb_cases')
    .update({ status: nextStatus })
    .eq('id', input.case_id)
    .eq('tenant_id', caller.tenantId)
  if (updErr) return { ok: false, error: updErr.message }

  await svc.from('dsb_audit_log').insert({
    tenant_id: caller.tenantId,
    case_id: input.case_id,
    event: fromStatus === 'with_employee' ? 'employee_approved' : 'supervisor_approved',
    actor_user_id: caller.userId,
    from_status: fromStatus,
    to_status: nextStatus,
  })

  // Email next role.
  const url = appUrl(`/app/disbursements/${input.case_id}`)
  const ctx = {
    caseNumber: kase.case_number,
    projectName: project?.name_ar ?? '—',
    developerName: developer?.company_name_ar ?? '—',
    amountSar: kase.amount_sar,
    caseUrl: url,
  }

  if (nextStatus === 'with_supervisor') {
    // Email all supervisors.
    const { data: sups } = await svc
      .from('users')
      .select('email')
      .eq('tenant_id', caller.tenantId)
      .eq('dsb_role', 'supervisor')
    const emails = ((sups ?? []) as { email: string | null }[])
      .map((s) => s.email)
      .filter((e): e is string => !!e)
    for (const to of emails) {
      sendEmployeeApprovedEmail({ to, ...ctx }).catch((e) => console.error('[dsb] email failed', e))
    }
  } else if (nextStatus === 'with_owner') {
    const { data: owners } = await svc
      .from('users')
      .select('email')
      .eq('tenant_id', caller.tenantId)
      .eq('dsb_role', 'owner')
    const emails = ((owners ?? []) as { email: string | null }[])
      .map((s) => s.email)
      .filter((e): e is string => !!e)
    for (const to of emails) {
      sendSupervisorApprovedEmail({ to, ...ctx }).catch((e) => console.error('[dsb] email failed', e))
    }
  }

  revalidatePath(`/app/disbursements/${input.case_id}`)
  revalidatePath('/app/disbursements')
  return { ok: true }
}

// ----------------------------------------------------------------------------
// sendBackToDeveloper
// ----------------------------------------------------------------------------

export async function sendBackToDeveloper(input: { case_id: string; reason: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (!['employee', 'supervisor', 'owner'].includes(caller.dsbRole ?? '')) {
    return { ok: false, error: 'لا تملك صلاحية إعادة الطلب.' }
  }
  if (!input.reason || !input.reason.trim()) {
    return { ok: false, error: 'السبب مطلوب عند الإعادة.' }
  }

  const svc = createSupabaseService()
  const kase = await loadCase(caller.tenantId, input.case_id)
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }
  if (!['with_employee', 'with_supervisor', 'with_owner'].includes(kase.status)) {
    return { ok: false, error: 'لا يمكن إعادة الطلب في حالته الحالية.' }
  }

  const project = single(kase.project)
  const developer = single(kase.developer)
  const fromStatus = kase.status

  const { error: updErr } = await svc
    .from('dsb_cases')
    .update({ status: 'sent_back_to_developer' })
    .eq('id', input.case_id)
    .eq('tenant_id', caller.tenantId)
  if (updErr) return { ok: false, error: updErr.message }

  await svc.from('dsb_notes').insert({
    tenant_id: caller.tenantId,
    case_id: input.case_id,
    from_user_id: caller.userId,
    from_role: caller.dsbRole,
    to_role: 'developer',
    body_ar: input.reason.trim(),
    is_change_request: true,
  })

  await svc.from('dsb_audit_log').insert({
    tenant_id: caller.tenantId,
    case_id: input.case_id,
    event: 'sent_back',
    actor_user_id: caller.userId,
    from_status: fromStatus,
    to_status: 'sent_back_to_developer',
    notes: input.reason.trim(),
  })

  // Email the developer (via their user account if linked, else contact_email).
  const devEmail = (await userEmail(svc, developer?.user_id)) ?? developer?.contact_email ?? null
  if (devEmail) {
    sendSentBackToDeveloperEmail({
      to: devEmail,
      caseNumber: kase.case_number,
      projectName: project?.name_ar ?? '—',
      developerName: developer?.company_name_ar ?? '—',
      amountSar: kase.amount_sar,
      caseUrl: appUrl(`/developer/${input.case_id}`),
      reason: input.reason.trim(),
    }).catch((e) => console.error('[dsb] email failed', e))
  }

  revalidatePath(`/app/disbursements/${input.case_id}`)
  revalidatePath('/app/disbursements')
  return { ok: true }
}

// ----------------------------------------------------------------------------
// signCase — owner final sign
// ----------------------------------------------------------------------------

export async function signCase(input: { case_id: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (caller.dsbRole !== 'owner') return { ok: false, error: 'التوقيع متاح للمدير فقط.' }

  const svc = createSupabaseService()
  const kase = await loadCase(caller.tenantId, input.case_id)
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }
  if (kase.status !== 'with_owner') return { ok: false, error: 'لا يمكن التوقيع في الحالة الحالية.' }

  const project = single(kase.project)
  const developer = single(kase.developer)

  const { error: updErr } = await svc
    .from('dsb_cases')
    .update({
      status: 'signed',
      signed_at: new Date().toISOString(),
      signed_by_user_id: caller.userId,
    })
    .eq('id', input.case_id)
    .eq('tenant_id', caller.tenantId)
  if (updErr) return { ok: false, error: updErr.message }

  await svc.from('dsb_audit_log').insert({
    tenant_id: caller.tenantId,
    case_id: input.case_id,
    event: 'signed',
    actor_user_id: caller.userId,
    from_status: 'with_owner',
    to_status: 'signed',
  })

  // Email developer (and assigned employee for record).
  const devEmail = (await userEmail(svc, developer?.user_id)) ?? developer?.contact_email ?? null
  const ctx = {
    caseNumber: kase.case_number,
    projectName: project?.name_ar ?? '—',
    developerName: developer?.company_name_ar ?? '—',
    amountSar: kase.amount_sar,
    caseUrl: appUrl(`/app/disbursements/${input.case_id}`),
  }
  if (devEmail) {
    sendSignedEmail({ to: devEmail, ...ctx, caseUrl: appUrl(`/developer/${input.case_id}`) })
      .catch((e) => console.error('[dsb] email failed', e))
  }
  const empEmail = await userEmail(svc, project?.assigned_employee_id)
  if (empEmail) {
    sendSignedEmail({ to: empEmail, ...ctx }).catch((e) => console.error('[dsb] email failed', e))
  }

  revalidatePath(`/app/disbursements/${input.case_id}`)
  revalidatePath('/app/disbursements')
  return { ok: true }
}

// ----------------------------------------------------------------------------
// upsertChecklistResponse — per-case checklist item response
// ----------------------------------------------------------------------------

type ChecklistStatus = 'pending' | 'verified' | 'issue' | 'not_mentioned' | 'not_attached'

const CHECKLIST_STATUSES: ChecklistStatus[] = [
  'pending',
  'verified',
  'issue',
  'not_mentioned',
  'not_attached',
]

export interface UpsertChecklistResponseInput {
  case_id: string
  checklist_item_id: string
  status: ChecklistStatus
  notes: string | null
}

export type UpsertChecklistResponseResult = { ok: true } | { ok: false; error: string }

export async function upsertChecklistResponse(
  input: UpsertChecklistResponseInput,
): Promise<UpsertChecklistResponseResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (!['employee', 'supervisor', 'owner'].includes(caller.dsbRole ?? '')) {
    return { ok: false, error: 'لا تملك صلاحية تعديل قائمة المراجعة.' }
  }
  if (!CHECKLIST_STATUSES.includes(input.status)) {
    return { ok: false, error: 'حالة غير صالحة.' }
  }

  const svc = createSupabaseService()

  // Confirm the case belongs to this tenant.
  const kase = await loadCase(caller.tenantId, input.case_id)
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }

  // Confirm the checklist item is visible to this tenant
  // (global tenant_id IS NULL or own tenant).
  const { data: item } = await svc
    .from('dsb_checklist_items')
    .select('id, tenant_id')
    .eq('id', input.checklist_item_id)
    .maybeSingle()
  if (!item) return { ok: false, error: 'بند غير موجود.' }
  const itemTenant = (item.tenant_id as string | null) ?? null
  if (itemTenant !== null && itemTenant !== caller.tenantId) {
    return { ok: false, error: 'بند غير متاح لمؤسستك.' }
  }

  const now = new Date().toISOString()
  const { error } = await svc
    .from('dsb_case_checklist_responses')
    .upsert(
      {
        tenant_id: caller.tenantId,
        case_id: input.case_id,
        checklist_item_id: input.checklist_item_id,
        status: input.status,
        notes: input.notes,
        responded_by_user_id: caller.userId,
        responded_at: now,
      },
      { onConflict: 'case_id,checklist_item_id' },
    )
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/${input.case_id}`)
  return { ok: true }
}

// ----------------------------------------------------------------------------
// getSignedPdfUrl — short-lived signed URL for the uploaded PDF
// ----------------------------------------------------------------------------

export async function getSignedPdfUrl(input: { case_id: string; upload_id: string }): Promise<
  | { ok: true; url: string }
  | { ok: false; error: string }
> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }

  const svc = createSupabaseService()
  const { data: up } = await svc
    .from('dsb_uploads')
    .select('id, storage_path, storage_bucket')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.upload_id)
    .eq('case_id', input.case_id)
    .maybeSingle()
  if (!up || !up.storage_path) return { ok: false, error: 'الملف غير موجود.' }

  const bucket = (up.storage_bucket as string) || STORAGE_BUCKET
  const { data, error } = await svc.storage.from(bucket).createSignedUrl(up.storage_path as string, 60 * 10)
  if (error || !data?.signedUrl) {
    console.error('[dsb.getSignedPdfUrl] createSignedUrl failed', error)
    return { ok: false, error: 'تعذّر إنشاء الرابط.' }
  }
  return { ok: true, url: data.signedUrl }
}

// ----------------------------------------------------------------------------
// moveCaseToStage — explicit stage routing
// ----------------------------------------------------------------------------

type MoveTargetStatus =
  | 'with_employee'
  | 'with_supervisor'
  | 'with_owner'
  | 'sent_back_to_developer'
  | 'signed'

const MOVE_TARGET_STATUSES: MoveTargetStatus[] = [
  'with_employee',
  'with_supervisor',
  'with_owner',
  'sent_back_to_developer',
  'signed',
]

const MOVE_ALLOWED_BY_ROLE: Record<'employee' | 'supervisor' | 'owner', MoveTargetStatus[]> = {
  employee:   ['with_supervisor', 'sent_back_to_developer'],
  supervisor: ['with_employee', 'with_owner', 'sent_back_to_developer'],
  owner:      ['with_employee', 'with_supervisor', 'with_owner', 'sent_back_to_developer', 'signed'],
}

export interface MoveCaseToStageInput {
  case_id: string
  target_status: MoveTargetStatus
  notes?: string
}

export async function moveCaseToStage(
  input: MoveCaseToStageInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }

  const role = caller.dsbRole
  if (!role || !['employee', 'supervisor', 'owner'].includes(role)) {
    return { ok: false, error: 'دورك لا يسمح بهذه النقلة.' }
  }
  if (!MOVE_TARGET_STATUSES.includes(input.target_status)) {
    return { ok: false, error: 'مرحلة غير صالحة.' }
  }
  const allowed = MOVE_ALLOWED_BY_ROLE[role as 'employee' | 'supervisor' | 'owner']
  if (!allowed.includes(input.target_status)) {
    return { ok: false, error: 'دورك لا يسمح بهذه النقلة.' }
  }

  const trimmedNotes = (input.notes ?? '').trim()
  if (input.target_status === 'sent_back_to_developer' && !trimmedNotes) {
    return { ok: false, error: 'الملاحظة مطلوبة عند الإعادة إلى المطور.' }
  }

  const svc = createSupabaseService()
  const kase = await loadCase(caller.tenantId, input.case_id)
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }

  const project = single(kase.project)
  const developer = single(kase.developer)
  const fromStatus = kase.status

  // Build update payload — include signed_at/signed_by_user_id when signing.
  const updatePayload: Record<string, unknown> = { status: input.target_status }
  if (input.target_status === 'signed') {
    updatePayload.signed_at = new Date().toISOString()
    updatePayload.signed_by_user_id = caller.userId
  }

  const { error: updErr } = await svc
    .from('dsb_cases')
    .update(updatePayload)
    .eq('id', input.case_id)
    .eq('tenant_id', caller.tenantId)
  if (updErr) return { ok: false, error: updErr.message }

  // For send-back, also create a dsb_notes row mirroring sendBackToDeveloper.
  if (input.target_status === 'sent_back_to_developer') {
    await svc.from('dsb_notes').insert({
      tenant_id: caller.tenantId,
      case_id: input.case_id,
      from_user_id: caller.userId,
      from_role: caller.dsbRole,
      to_role: 'developer',
      body_ar: trimmedNotes,
      is_change_request: true,
    })
  }

  await svc.from('dsb_audit_log').insert({
    tenant_id: caller.tenantId,
    case_id: input.case_id,
    event: 'manual_move',
    actor_user_id: caller.userId,
    from_status: fromStatus,
    to_status: input.target_status,
    notes: trimmedNotes || null,
  })

  // Fire the appropriate email — best-effort.
  const ctx = {
    caseNumber: kase.case_number,
    projectName: project?.name_ar ?? '—',
    developerName: developer?.company_name_ar ?? '—',
    amountSar: kase.amount_sar,
    caseUrl: appUrl(`/app/disbursements/${input.case_id}`),
  }

  if (input.target_status === 'with_supervisor') {
    const { data: sups } = await svc
      .from('users')
      .select('email')
      .eq('tenant_id', caller.tenantId)
      .eq('dsb_role', 'supervisor')
    const emails = ((sups ?? []) as { email: string | null }[])
      .map((s) => s.email)
      .filter((e): e is string => !!e)
    for (const to of emails) {
      sendEmployeeApprovedEmail({ to, ...ctx }).catch((e) => console.error('[dsb] email failed', e))
    }
  } else if (input.target_status === 'with_owner') {
    const { data: owners } = await svc
      .from('users')
      .select('email')
      .eq('tenant_id', caller.tenantId)
      .eq('dsb_role', 'owner')
    const emails = ((owners ?? []) as { email: string | null }[])
      .map((s) => s.email)
      .filter((e): e is string => !!e)
    for (const to of emails) {
      sendSupervisorApprovedEmail({ to, ...ctx }).catch((e) => console.error('[dsb] email failed', e))
    }
  } else if (input.target_status === 'with_employee') {
    // Re-route to the assigned employee's inbox (treat as developer-uploaded).
    const empEmail = await userEmail(svc, project?.assigned_employee_id)
    if (empEmail) {
      sendDeveloperUploadedEmail({ to: empEmail, ...ctx })
        .catch((e) => console.error('[dsb] email failed', e))
    }
  } else if (input.target_status === 'sent_back_to_developer') {
    const devEmail = (await userEmail(svc, developer?.user_id)) ?? developer?.contact_email ?? null
    if (devEmail) {
      sendSentBackToDeveloperEmail({
        to: devEmail,
        caseNumber: kase.case_number,
        projectName: project?.name_ar ?? '—',
        developerName: developer?.company_name_ar ?? '—',
        amountSar: kase.amount_sar,
        caseUrl: appUrl(`/developer/${input.case_id}`),
        reason: trimmedNotes,
      }).catch((e) => console.error('[dsb] email failed', e))
    }
  } else if (input.target_status === 'signed') {
    const devEmail = (await userEmail(svc, developer?.user_id)) ?? developer?.contact_email ?? null
    if (devEmail) {
      sendSignedEmail({ ...ctx, to: devEmail, caseUrl: appUrl(`/developer/${input.case_id}`) })
        .catch((e) => console.error('[dsb] email failed', e))
    }
    const empEmail = await userEmail(svc, project?.assigned_employee_id)
    if (empEmail) {
      sendSignedEmail({ to: empEmail, ...ctx }).catch((e) => console.error('[dsb] email failed', e))
    }
  }

  revalidatePath(`/app/disbursements/${input.case_id}`)
  revalidatePath('/app/disbursements')
  return { ok: true }
}

// ----------------------------------------------------------------------------
// updateExtractedFields — edit the AI-extracted block stored on
// dsb_cases.extracted_fields. Any staff role can correct mistakes the AI
// made (e.g. wrong IBAN, missed VAT, wrong disbursement type).
//
// The shape of `fields` is loose JSON; we accept whatever the client sends
// and merge it into the existing JSONB column. Validation lives client-side
// in the EditExtractedFields component.
// ----------------------------------------------------------------------------

export interface UpdateExtractedFieldsInput {
  case_id: string
  fields: Record<string, unknown>
}

export async function updateExtractedFields(
  input: UpdateExtractedFieldsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (!['employee', 'supervisor', 'owner'].includes(caller.dsbRole ?? '')) {
    return { ok: false, error: 'لا تملك صلاحية.' }
  }
  if (!input.case_id) return { ok: false, error: 'بيانات ناقصة.' }
  if (!input.fields || typeof input.fields !== 'object') {
    return { ok: false, error: 'البيانات غير صحيحة.' }
  }

  const svc = createSupabaseService()
  const { data: kase } = await svc
    .from('dsb_cases')
    .select('id, extracted_fields')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.case_id)
    .maybeSingle()
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }

  // Merge: keep any fields the editor didn't touch (e.g. confidence_overall)
  // and overwrite the ones it sent.
  const existing = (kase.extracted_fields ?? {}) as Record<string, unknown>
  const merged = { ...existing, ...input.fields, edited_by_human: true, edited_at: new Date().toISOString() }

  const { error } = await svc
    .from('dsb_cases')
    .update({ extracted_fields: merged })
    .eq('id', input.case_id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  await svc.from('dsb_audit_log').insert({
    tenant_id: caller.tenantId,
    case_id: input.case_id,
    event: 'extracted_fields_edited',
    actor_user_id: caller.userId,
    notes: 'تم تعديل البيانات المستخرجة من الذكاء الاصطناعي.',
  })

  revalidatePath(`/app/disbursements/${input.case_id}`)
  return { ok: true }
}

// ----------------------------------------------------------------------------
// updateCaseFields — edit the top-level case metadata (voucher number, date,
// amount, delivery date, notes). Open to ALL staff roles so an employee can
// correct typos on a case they're reviewing without escalating. The status,
// signed_at, signed_by_user_id are NOT touched here — workflow transitions
// stay role-gated through approveCase / signCase / etc.
// ----------------------------------------------------------------------------

export interface UpdateCaseFieldsInput {
  case_id: string
  voucher_number_text: string | null
  voucher_date: string | null
  amount_sar: number | null
  delivery_date: string | null
  notes: string | null
}

export async function updateCaseFields(
  input: UpdateCaseFieldsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (!['employee', 'supervisor', 'owner'].includes(caller.dsbRole ?? '')) {
    return { ok: false, error: 'لا تملك صلاحية.' }
  }
  if (!input.case_id) return { ok: false, error: 'بيانات ناقصة.' }

  const svc = createSupabaseService()
  const { data: kase } = await svc
    .from('dsb_cases')
    .select('id')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.case_id)
    .maybeSingle()
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }

  // Build the patch — only include fields that pass basic validation. Null
  // values are explicitly allowed so the user can clear an existing field.
  const patch: Record<string, string | number | null> = {}

  const voucherNumber = (input.voucher_number_text ?? '').trim()
  patch.voucher_number_text = voucherNumber ? voucherNumber : null

  if (input.voucher_date === null || input.voucher_date === '') {
    patch.voucher_date = null
  } else if (typeof input.voucher_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.voucher_date)) {
    patch.voucher_date = input.voucher_date
  } else {
    return { ok: false, error: 'تاريخ السند غير صالح.' }
  }

  if (input.amount_sar === null) {
    patch.amount_sar = null
  } else if (typeof input.amount_sar === 'number' && Number.isFinite(input.amount_sar) && input.amount_sar >= 0) {
    patch.amount_sar = input.amount_sar
  } else {
    return { ok: false, error: 'المبلغ غير صالح.' }
  }

  if (input.delivery_date === null || input.delivery_date === '') {
    patch.delivery_date = null
  } else if (typeof input.delivery_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.delivery_date)) {
    patch.delivery_date = input.delivery_date
  } else {
    return { ok: false, error: 'تاريخ التسليم غير صالح.' }
  }

  const notes = (input.notes ?? '').trim()
  patch.notes = notes ? notes : null

  const { error } = await svc
    .from('dsb_cases')
    .update(patch)
    .eq('id', input.case_id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  await svc.from('dsb_audit_log').insert({
    tenant_id: caller.tenantId,
    case_id: input.case_id,
    event: 'case_fields_edited',
    actor_user_id: caller.userId,
    notes: 'تم تعديل بيانات الطلب.',
  })

  revalidatePath(`/app/disbursements/${input.case_id}`)
  revalidatePath('/app/disbursements')
  revalidatePath('/app/disbursements/documents')
  return { ok: true }
}

// ----------------------------------------------------------------------------
// Document replacement — staff can swap the case's PDF for an updated
// version during review (developer sent wrong file, scan was unclear, etc.).
// Old version stays in Storage; superseded_at marks it as historical. The
// new version becomes the current upload (one current per case enforced by
// a partial unique index). Any staff role can do this.
// ----------------------------------------------------------------------------

export interface RequestReplacementUploadUrlInput {
  case_id: string
  filename: string
  size: number
}

export type RequestReplacementUploadUrlResult =
  | { ok: true; signed_url: string; storage_path: string }
  | { ok: false; error: string }

export async function requestReplacementUploadUrl(
  input: RequestReplacementUploadUrlInput,
): Promise<RequestReplacementUploadUrlResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (!['employee', 'supervisor', 'owner'].includes(caller.dsbRole ?? '')) {
    return { ok: false, error: 'لا تملك صلاحية.' }
  }
  if (!input.case_id) return { ok: false, error: 'بيانات ناقصة.' }
  if (!input.size || input.size <= 0) return { ok: false, error: 'حجم الملف غير صالح.' }
  if (input.size > 50 * 1024 * 1024) {
    return { ok: false, error: 'حجم الملف يتجاوز الحد الأقصى (50 ميغابايت).' }
  }

  const svc = createSupabaseService()
  const { data: kase } = await svc
    .from('dsb_cases')
    .select('id, tenant_id')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.case_id)
    .maybeSingle()
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }

  const uuid = crypto.randomUUID()
  const safe = (input.filename || `replacement-${uuid}.pdf`).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180)
  const storagePath = `dsb/${caller.tenantId}/${input.case_id}/${uuid}-${safe}`

  const { data, error } = await svc.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath)
  if (error || !data) {
    console.error('[dsb.requestReplacementUploadUrl] failed', error)
    return { ok: false, error: 'تعذّر إنشاء رابط الرفع.' }
  }
  return { ok: true, signed_url: data.signedUrl, storage_path: data.path ?? storagePath }
}

export interface FinalizeReplacementInput {
  case_id: string
  storage_path: string
  filename: string
  size: number
  mime: string
  reason: string | null
}

export type FinalizeReplacementResult =
  | { ok: true; new_upload_id: string; superseded_count: number }
  | { ok: false; error: string }

export async function finalizeReplacementUpload(
  input: FinalizeReplacementInput,
): Promise<FinalizeReplacementResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (!['employee', 'supervisor', 'owner'].includes(caller.dsbRole ?? '')) {
    return { ok: false, error: 'لا تملك صلاحية.' }
  }
  if (!input.case_id || !input.storage_path) {
    return { ok: false, error: 'بيانات ناقصة.' }
  }

  const svc = createSupabaseService()
  const { data: kase } = await svc
    .from('dsb_cases')
    .select('id, tenant_id, case_number')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.case_id)
    .maybeSingle()
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }

  const now = new Date().toISOString()
  const reason = (input.reason ?? '').trim().slice(0, 500) || null

  // Step 1: mark every currently-active upload for this case as superseded.
  // The partial unique index would otherwise reject the new INSERT.
  const { data: currentRows, error: supErr } = await svc
    .from('dsb_uploads')
    .update({
      superseded_at: now,
      replaced_by_user_id: caller.userId,
      replacement_reason: reason,
    })
    .eq('tenant_id', caller.tenantId)
    .eq('case_id', input.case_id)
    .is('superseded_at', null)
    .select('id')
  if (supErr) {
    console.error('[dsb.finalizeReplacementUpload] supersede failed', supErr)
    return { ok: false, error: supErr.message }
  }
  const supersededCount = (currentRows ?? []).length

  // Step 2: insert the new upload as the new current version.
  const safeName = (input.filename ?? '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180)
  const { data: newRow, error: insErr } = await svc
    .from('dsb_uploads')
    .insert({
      tenant_id: caller.tenantId,
      case_id: input.case_id,
      filename: safeName || 'replacement.pdf',
      storage_path: input.storage_path,
      storage_bucket: STORAGE_BUCKET,
      file_size_bytes: input.size,
      mime_type: input.mime || 'application/pdf',
      uploaded_by_user_id: caller.userId,
    })
    .select('id')
    .single()
  if (insErr || !newRow) {
    console.error('[dsb.finalizeReplacementUpload] insert failed', insErr)
    return { ok: false, error: insErr?.message ?? 'تعذّر تسجيل النسخة الجديدة.' }
  }

  // Step 3: audit log (single row capturing the swap).
  await svc.from('dsb_audit_log').insert({
    tenant_id: caller.tenantId,
    case_id: input.case_id,
    event: 'document_replaced',
    actor_user_id: caller.userId,
    notes:
      `تم استبدال الوثيقة (${supersededCount} نسخة سابقة → نسخة جديدة)` +
      (reason ? `. السبب: ${reason}` : ''),
    occurred_at: now,
  })

  revalidatePath(`/app/disbursements/${input.case_id}`)
  return { ok: true, new_upload_id: newRow.id as string, superseded_count: supersededCount }
}

// ----------------------------------------------------------------------------
// requestSignedDocumentUploadUrl — direct-to-Storage signed URL for the
// owner's manually-signed PDF. Mirrors the developer-side direct-upload
// pattern so we bypass Vercel's 4.5MB request body limit. The client PUTs the
// file to `signed_url`, then calls `signCaseWithUploadedDocument` with the
// returned `storage_path`.
// ----------------------------------------------------------------------------

const MAX_SIGNED_DOC_SIZE = 50 * 1024 * 1024 // 50 MB

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180)
}

export interface RequestSignedDocumentUploadUrlInput {
  case_id: string
  filename: string
  size: number
}

export type RequestSignedDocumentUploadUrlResult =
  | { ok: true; signed_url: string; storage_path: string }
  | { ok: false; error: string }

export async function requestSignedDocumentUploadUrl(
  input: RequestSignedDocumentUploadUrlInput,
): Promise<RequestSignedDocumentUploadUrlResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (caller.dsbRole !== 'owner') {
    return { ok: false, error: 'رفع المستند الموقّع متاح للمدير فقط.' }
  }
  if (!input.case_id) return { ok: false, error: 'بيانات ناقصة.' }
  if (!input.size || input.size <= 0) return { ok: false, error: 'حجم الملف غير صالح.' }
  if (input.size > MAX_SIGNED_DOC_SIZE) {
    return { ok: false, error: 'حجم الملف يتجاوز الحد الأقصى (50 ميغابايت).' }
  }

  const svc = createSupabaseService()
  const { data: kase } = await svc
    .from('dsb_cases')
    .select('id, tenant_id, status')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.case_id)
    .maybeSingle()
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }
  // We allow uploading a signed document on any non-cancelled case so an
  // already-signed case can still receive its scanned paper copy after the
  // fact. We only block 'cancelled' to avoid resurrecting dead cases.
  if (kase.status === 'cancelled') {
    return { ok: false, error: 'لا يمكن رفع مستند لطلب ملغى.' }
  }

  const uuid = crypto.randomUUID()
  const safe = sanitizeFilename(input.filename || `signed-${uuid}.pdf`)
  const storagePath = `signed/${caller.tenantId}/${input.case_id}/${uuid}-${safe}`

  const { data, error } = await svc.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath)
  if (error || !data) {
    console.error('[dsb.requestSignedDocumentUploadUrl] failed', error)
    return { ok: false, error: 'تعذّر إنشاء رابط الرفع.' }
  }
  return { ok: true, signed_url: data.signedUrl, storage_path: data.path ?? storagePath }
}

// ----------------------------------------------------------------------------
// signCaseWithUploadedDocument — owner finalizes the case by attaching a
// physically-signed PDF. Behaves like signCase (status, signed_at,
// signed_by_user_id, audit log, emails) and ALSO records signed_document_path
// + signed_document_filename so the file can be retrieved later.
//
// If the case is already 'signed', we only attach the document (don't bump
// signed_at) — supports the "scanned the paper copy a week later" workflow.
// ----------------------------------------------------------------------------

export interface SignCaseWithUploadedDocumentInput {
  case_id: string
  storage_path: string
  filename: string
}

export type SignCaseWithUploadedDocumentResult =
  | { ok: true }
  | { ok: false; error: string }

export async function signCaseWithUploadedDocument(
  input: SignCaseWithUploadedDocumentInput,
): Promise<SignCaseWithUploadedDocumentResult> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  if (caller.dsbRole !== 'owner') {
    return { ok: false, error: 'التوقيع متاح للمدير فقط.' }
  }
  if (!input.case_id || !input.storage_path) {
    return { ok: false, error: 'بيانات ناقصة.' }
  }

  const svc = createSupabaseService()
  const kase = await loadCase(caller.tenantId, input.case_id)
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }
  if (kase.status === 'cancelled') {
    return { ok: false, error: 'لا يمكن توقيع طلب ملغى.' }
  }

  const project = single(kase.project)
  const developer = single(kase.developer)
  const wasAlreadySigned = kase.status === 'signed'
  const previousStatus = kase.status

  const updatePayload: Record<string, string | null> = {
    signed_document_path: input.storage_path,
    signed_document_filename: sanitizeFilename(input.filename),
  }
  if (!wasAlreadySigned) {
    updatePayload.status = 'signed'
    updatePayload.signed_at = new Date().toISOString()
    updatePayload.signed_by_user_id = caller.userId
  }

  const { error: updErr } = await svc
    .from('dsb_cases')
    .update(updatePayload)
    .eq('id', input.case_id)
    .eq('tenant_id', caller.tenantId)
  if (updErr) return { ok: false, error: updErr.message }

  await svc.from('dsb_audit_log').insert({
    tenant_id: caller.tenantId,
    case_id: input.case_id,
    event: wasAlreadySigned ? 'signed_document_attached' : 'signed_with_document',
    actor_user_id: caller.userId,
    from_status: previousStatus,
    to_status: 'signed',
    notes: wasAlreadySigned
      ? `تم إرفاق نسخة موقّعة لاحقًا: ${updatePayload.signed_document_filename}`
      : `تم التوقيع برفع مستند موقّع يدويًا: ${updatePayload.signed_document_filename}`,
  })

  // Only notify on the first-time transition. Re-attachments stay silent so we
  // don't re-email everyone for a paper-copy archive update.
  if (!wasAlreadySigned) {
    const devEmail =
      (await userEmail(svc, developer?.user_id)) ?? developer?.contact_email ?? null
    const ctx = {
      caseNumber: kase.case_number,
      projectName: project?.name_ar ?? '—',
      developerName: developer?.company_name_ar ?? '—',
      amountSar: kase.amount_sar,
      caseUrl: appUrl(`/app/disbursements/${input.case_id}`),
    }
    if (devEmail) {
      sendSignedEmail({ to: devEmail, ...ctx, caseUrl: appUrl(`/developer/${input.case_id}`) })
        .catch((e) => console.error('[dsb] email failed', e))
    }
    const empEmail = await userEmail(svc, project?.assigned_employee_id)
    if (empEmail) {
      sendSignedEmail({ to: empEmail, ...ctx }).catch((e) => console.error('[dsb] email failed', e))
    }
  }

  revalidatePath(`/app/disbursements/${input.case_id}`)
  revalidatePath('/app/disbursements')
  revalidatePath('/app/disbursements/documents')
  return { ok: true }
}

// ----------------------------------------------------------------------------
// getSignedDocumentUrl — short-lived signed URL to view/download the owner's
// uploaded signed PDF.
// ----------------------------------------------------------------------------

export async function getSignedDocumentUrl(input: { case_id: string }): Promise<
  | { ok: true; url: string; filename: string }
  | { ok: false; error: string }
> {
  const caller = await resolveCaller()
  if (!caller) return { ok: false, error: 'لم يتم تسجيل الدخول.' }

  const svc = createSupabaseService()
  const { data: kase } = await svc
    .from('dsb_cases')
    .select('id, signed_document_path, signed_document_filename')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.case_id)
    .maybeSingle()
  if (!kase?.signed_document_path) {
    return { ok: false, error: 'لا يوجد مستند موقّع.' }
  }

  const { data, error } = await svc.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(kase.signed_document_path as string, 60 * 10)
  if (error || !data?.signedUrl) {
    console.error('[dsb.getSignedDocumentUrl] failed', error)
    return { ok: false, error: 'تعذّر إنشاء الرابط.' }
  }
  return {
    ok: true,
    url: data.signedUrl,
    filename: (kase.signed_document_filename as string) ?? 'signed.pdf',
  }
}
