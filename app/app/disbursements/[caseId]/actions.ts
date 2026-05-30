'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import {
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
    if (caller.dsbRole !== 'employee') return { ok: false, error: 'لا تملك صلاحية الاعتماد.' }
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
  if (caller.dsbRole !== 'owner') return { ok: false, error: 'التوقيع متاح لصاحب القرار فقط.' }

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
