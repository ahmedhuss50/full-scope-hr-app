'use server'

import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

async function resolveOwner(): Promise<
  | { tenantId: string; userId: string }
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
  if (role !== 'owner') {
    return { error: 'إنشاء الموظفين متاح للمدير فقط.' }
  }
  return {
    tenantId: profile.tenant_id as string,
    userId: profile.id as string,
  }
}

// Roles assignable from the create form. Mirrors the values handled by
// the admin's ChangeRoleButton so a brand-new employee can be slotted into
// the right tier at creation time instead of always landing as 'employee'
// and being promoted afterwards.
export type CreateEmployeeRole = 'employee' | 'supervisor' | 'owner' | 'viewer' | 'deliverer'

const CREATE_EMPLOYEE_ROLES: readonly CreateEmployeeRole[] = [
  'employee',
  'supervisor',
  'owner',
  'viewer',
  'deliverer',
]

export interface CreateEmployeeInput {
  full_name: string
  email: string
  job_title?: string | null
  notes?: string | null
  send_invite: boolean
  // Optional: which dsb_role to assign. Defaults to 'employee' for
  // backwards compatibility with any caller that hasn't been updated.
  dsb_role?: CreateEmployeeRole
  // Optional: project IDs to add this user to in the dsb_project_employees
  // junction. Ignored when role is 'owner' (owners see everything).
  project_ids?: string[]
}

export type CreateEmployeeResult =
  | { ok: true; user_id: string; fallback_link?: string | null; warning?: string | null }
  | { ok: false; error: string }

export async function createEmployee(input: CreateEmployeeInput): Promise<CreateEmployeeResult> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }

  const fullName = input.full_name?.trim() ?? ''
  const email = input.email?.trim().toLowerCase() ?? ''
  const jobTitle = input.job_title?.trim() || null
  const notes = input.notes?.trim() || null

  if (!fullName) return { ok: false, error: 'الاسم الكامل مطلوب.' }
  if (!email) return { ok: false, error: 'البريد الإلكتروني مطلوب.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'صيغة البريد الإلكتروني غير صحيحة.' }
  }

  // Resolve and validate the selected role. Defaults to 'employee' when
  // the form omits the field — keeps the older callsite shape working.
  const selectedRole: CreateEmployeeRole = input.dsb_role ?? 'employee'
  if (!CREATE_EMPLOYEE_ROLES.includes(selectedRole)) {
    return { ok: false, error: 'دور غير صالح.' }
  }

  // Sanitize project_ids: trim, drop blanks, dedupe. Owners don't get
  // junction rows at all — they see everything.
  const projectIdsInput = (input.project_ids ?? [])
    .map((id) => (id ?? '').trim())
    .filter((id) => id.length > 0)
  const projectIds = selectedRole === 'owner'
    ? []
    : Array.from(new Set(projectIdsInput))

  const svc = createSupabaseService()
  let fallbackLink: string | null = null
  let warning: string | null = null

  // 1) Find or create the users row in this tenant tagged as employee.
  let userId: string | null = null
  const { data: existingUser } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', email)
    .maybeSingle()

  if (existingUser) {
    userId = existingUser.id as string
    const updates: Record<string, unknown> = { full_name: fullName }
    // If an internal role already exists, only overwrite it when the
    // caller explicitly picked something OTHER than the default 'employee'.
    // This keeps the "re-create same email" path safe (won't quietly demote
    // a supervisor back to employee just because the form left the default).
    const existingRole = (existingUser.dsb_role as string | null) ?? null
    const hasInternalRole = !!existingRole && ['employee', 'supervisor', 'owner', 'viewer', 'deliverer'].includes(existingRole)
    if (!hasInternalRole) {
      updates.dsb_role = selectedRole
    } else if (input.dsb_role && input.dsb_role !== existingRole) {
      // Explicit role change requested.
      updates.dsb_role = selectedRole
    }
    if (notes) updates.notes = notes
    await svc.from('users').update(updates).eq('id', userId)
  } else {
    const insertRow: Record<string, unknown> = {
      tenant_id: caller.tenantId,
      email,
      full_name: fullName,
      dsb_role: selectedRole,
    }
    if (jobTitle) insertRow.job_title = jobTitle
    if (notes) insertRow.notes = notes
    const { data: newUser, error: userErr } = await svc
      .from('users')
      .insert(insertRow)
      .select('id')
      .single()
    if (userErr || !newUser) {
      // Retry without optional columns (in case the schema lacks job_title/notes).
      const retry = await svc
        .from('users')
        .insert({
          tenant_id: caller.tenantId,
          email,
          full_name: fullName,
          dsb_role: selectedRole,
        })
        .select('id')
        .single()
      if (retry.error || !retry.data) {
        console.error('[dsb.createEmployee] users insert failed', retry.error)
        return { ok: false, error: retry.error?.message ?? 'فشل إنشاء الموظف.' }
      }
      userId = retry.data.id as string
      if (jobTitle || notes) {
        warning = 'تم إنشاء الموظف، لكن بعض الحقول الإضافية لم تُحفظ.'
      }
    } else {
      userId = newUser.id as string
    }
  }

  // Junction: assign the user to the chosen projects (skipped for owners).
  // Validate each project belongs to this tenant before inserting; silently
  // drop any that don't match rather than failing the whole create.
  if (userId && projectIds.length > 0 && selectedRole !== 'owner') {
    const { data: validProjects } = await svc
      .from('dsb_projects')
      .select('id, tenant_id')
      .in('id', projectIds)
      .eq('tenant_id', caller.tenantId)
    const validIds = ((validProjects ?? []) as { id: string }[]).map((p) => p.id)
    if (validIds.length > 0) {
      const rows = validIds.map((pid) => ({
        project_id: pid,
        user_id: userId as string,
        tenant_id: caller.tenantId,
        added_by_user_id: caller.userId,
      }))
      // on conflict do nothing isn't supported through the JS client without
      // upsert + onConflict; use upsert here.
      const { error: junctionErr } = await svc
        .from('dsb_project_employees')
        .upsert(rows, { onConflict: 'project_id,user_id' })
      if (junctionErr) {
        console.warn('[dsb.createEmployee] junction upsert failed', junctionErr)
        warning = warning ?? 'تم إنشاء الموظف، لكن تعذّر إسناده لبعض المشاريع.'
      } else if (validIds.length !== projectIds.length) {
        warning = warning ?? 'تم إنشاء الموظف، لكن بعض المشاريع لم تكن صالحة وتم تجاهلها.'
      }
    }
  }

  if (!input.send_invite) {
    return { ok: true, user_id: userId, fallback_link: null, warning }
  }

  // 2) Try the Supabase auth admin invite flow (best-effort).
  try {
    type AuthAdminAny = {
      inviteUserByEmail?: (
        email: string,
        opts?: { redirectTo?: string },
      ) => Promise<{ data: unknown; error: { message: string } | null }>
      generateLink?: (params: {
        type: string
        email: string
      }) => Promise<{
        data: { properties?: { action_link?: string } } | null
        error: { message: string } | null
      }>
    }
    const authAdmin = (svc.auth as unknown as { admin?: AuthAdminAny }).admin
    const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fullscope.sa'

    if (authAdmin && typeof authAdmin.inviteUserByEmail === 'function') {
      const invite = await authAdmin.inviteUserByEmail(email, {
        redirectTo: `${origin}/app/disbursements`,
      })
      if (invite?.error) {
        console.warn('[dsb.createEmployee] inviteUserByEmail returned error', invite.error)
        if (typeof authAdmin.generateLink === 'function') {
          const gen = await authAdmin.generateLink({ type: 'magiclink', email })
          fallbackLink = gen?.data?.properties?.action_link ?? null
        }
        if (!fallbackLink) {
          warning = warning ?? 'تعذّر إرسال دعوة الدخول تلقائيًا — يرجى مشاركة الرابط يدويًا.'
        }
      }
    } else if (authAdmin && typeof authAdmin.generateLink === 'function') {
      const gen = await authAdmin.generateLink({ type: 'magiclink', email })
      fallbackLink = gen?.data?.properties?.action_link ?? null
      if (!fallbackLink) {
        warning = warning ?? 'تعذّر توليد رابط الدعوة — أنشئه يدويًا.'
      }
    } else {
      warning = warning ?? 'وظيفة دعوة المستخدمين غير مفعّلة في هذه البيئة.'
    }
  } catch (e) {
    console.warn('[dsb.createEmployee] auth admin invite failed', e)
    warning = warning ?? 'تعذّر إرسال دعوة الدخول.'
  }

  return { ok: true, user_id: userId, fallback_link: fallbackLink, warning }
}
