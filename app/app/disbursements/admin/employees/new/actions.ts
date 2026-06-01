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
    return { error: 'إنشاء الموظفين متاح لصاحب القرار فقط.' }
  }
  return {
    tenantId: profile.tenant_id as string,
    userId: profile.id as string,
  }
}

export interface CreateEmployeeInput {
  full_name: string
  email: string
  job_title?: string | null
  notes?: string | null
  send_invite: boolean
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
    // Only set dsb_role if not already a staff role (preserve owner/supervisor).
    const existingRole = (existingUser.dsb_role as string | null) ?? null
    if (!existingRole || !['employee', 'supervisor', 'owner'].includes(existingRole)) {
      updates.dsb_role = 'employee'
    }
    if (notes) updates.notes = notes
    await svc.from('users').update(updates).eq('id', userId)
  } else {
    const insertRow: Record<string, unknown> = {
      tenant_id: caller.tenantId,
      email,
      full_name: fullName,
      dsb_role: 'employee',
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
          dsb_role: 'employee',
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
