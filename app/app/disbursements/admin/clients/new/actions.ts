'use server'

import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

type StaffRole = 'employee' | 'supervisor' | 'owner'

async function resolveStaff(): Promise<
  | { tenantId: string; userId: string; dsbRole: StaffRole }
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
  }
}

export interface CreateClientInput {
  company_name_ar: string
  contact_name?: string | null
  contact_email: string
  notes?: string | null
  send_invite: boolean
}

export type CreateClientResult =
  | { ok: true; client_id: string; invite_link?: string | null; invite_warning?: string | null }
  | { ok: false; error: string }

export async function createClient(input: CreateClientInput): Promise<CreateClientResult> {
  const caller = await resolveStaff()
  if ('error' in caller) return { ok: false, error: caller.error }

  const companyName = input.company_name_ar?.trim() ?? ''
  const contactEmail = input.contact_email?.trim().toLowerCase() ?? ''
  const contactName = input.contact_name?.trim() || null
  const notes = input.notes?.trim() || null

  if (!companyName) return { ok: false, error: 'اسم الشركة مطلوب.' }
  if (!contactEmail) return { ok: false, error: 'البريد الإلكتروني مطلوب.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return { ok: false, error: 'صيغة البريد الإلكتروني غير صحيحة.' }
  }

  const svc = createSupabaseService()

  // Insert dsb_developers row first.
  const { data: insertRow, error: insertErr } = await svc
    .from('dsb_developers')
    .insert({
      tenant_id: caller.tenantId,
      company_name_ar: companyName,
      contact_name: contactName,
      contact_email: contactEmail,
      notes,
      status: 'active',
    })
    .select('id')
    .single()
  if (insertErr || !insertRow) {
    console.error('[dsb.createClient] insert failed', insertErr)
    return { ok: false, error: insertErr?.message ?? 'فشل إنشاء العميل.' }
  }
  const clientId = insertRow.id as string

  if (!input.send_invite) {
    return { ok: true, client_id: clientId }
  }

  // Best-effort login provisioning. We:
  //   1) Look up / create a users row for this email in the same tenant.
  //   2) Try to invite via Supabase auth.admin (if available in this env).
  //   3) Link dsb_developers.user_id → users.id.
  let inviteLink: string | null = null
  let inviteWarning: string | null = null

  try {
    let userId: string | null = null

    // Check if a users row already exists for this email.
    const { data: existingUser } = await svc
      .from('users')
      .select('id, tenant_id, dsb_role')
      .eq('email', contactEmail)
      .maybeSingle()

    if (existingUser) {
      userId = existingUser.id as string
      // If they're not yet tagged developer, set it.
      if (existingUser.dsb_role !== 'developer') {
        await svc.from('users').update({ dsb_role: 'developer' }).eq('id', userId)
      }
    } else {
      const fullName = contactName ?? companyName
      const { data: newUser, error: userErr } = await svc
        .from('users')
        .insert({
          tenant_id: caller.tenantId,
          email: contactEmail,
          full_name: fullName,
          dsb_role: 'developer',
        })
        .select('id')
        .single()
      if (userErr || !newUser) {
        console.warn('[dsb.createClient] could not create users row', userErr)
        inviteWarning = 'تعذّر إنشاء سجل المستخدم. يمكن إنشاؤه يدويًا لاحقًا.'
      } else {
        userId = newUser.id as string
      }
    }

    // Try inviting via auth admin. Wrapped in try/catch — many envs don't expose this.
    try {
      type AuthAdminAny = {
        inviteUserByEmail?: (email: string, opts?: { redirectTo?: string }) => Promise<{ data: unknown; error: { message: string } | null }>
        generateLink?: (params: { type: string; email: string }) => Promise<{ data: { properties?: { action_link?: string } } | null; error: { message: string } | null }>
      }
      const authAdmin = (svc.auth as unknown as { admin?: AuthAdminAny }).admin
      if (authAdmin && typeof authAdmin.inviteUserByEmail === 'function') {
        const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fullscope.sa'
        const invite = await authAdmin.inviteUserByEmail(contactEmail, {
          redirectTo: `${origin}/developer`,
        })
        if (invite?.error) {
          console.warn('[dsb.createClient] inviteUserByEmail returned error', invite.error)
          // Fall back to manual link if generateLink is available.
          if (typeof authAdmin.generateLink === 'function') {
            const gen = await authAdmin.generateLink({ type: 'magiclink', email: contactEmail })
            inviteLink = gen?.data?.properties?.action_link ?? null
          }
          if (!inviteLink) {
            inviteWarning = 'تعذّر إرسال دعوة الدخول تلقائيًا — يرجى مشاركة الرابط يدويًا.'
          }
        }
      } else if (authAdmin && typeof authAdmin.generateLink === 'function') {
        const gen = await authAdmin.generateLink({ type: 'magiclink', email: contactEmail })
        inviteLink = gen?.data?.properties?.action_link ?? null
        if (!inviteLink) {
          inviteWarning = 'تعذّر توليد رابط الدعوة — أنشئه يدويًا.'
        }
      } else {
        inviteWarning = 'وظيفة دعوة المستخدمين غير مفعّلة في هذه البيئة.'
      }
    } catch (e) {
      console.warn('[dsb.createClient] auth admin invite failed', e)
      inviteWarning = 'تعذّر إرسال دعوة الدخول.'
    }

    if (userId) {
      // Link the dsb_developers row to the user.
      await svc
        .from('dsb_developers')
        .update({ user_id: userId })
        .eq('id', clientId)
        .eq('tenant_id', caller.tenantId)
    }
  } catch (e) {
    console.error('[dsb.createClient] post-insert provisioning threw', e)
    inviteWarning = 'تم إنشاء العميل، لكن حدث خطأ أثناء إعداد حساب الدخول.'
  }

  return {
    ok: true,
    client_id: clientId,
    invite_link: inviteLink,
    invite_warning: inviteWarning,
  }
}
