'use server'

import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/resend'

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

const DSB_FROM = 'Full Scope <notifications@fullscope.sa>'

function buildEmailHtml(name: string, url: string): string {
  const safeName = name.replace(/</g, '&lt;')
  const safeUrl = url.replace(/"/g, '&quot;')
  return `<!doctype html><html dir="rtl" lang="ar"><body style="font-family:Cairo,Tahoma,Arial,sans-serif;color:#0f172a;line-height:1.7;">
    <h2 style="margin:0 0 12px;">أهلًا ${safeName}</h2>
    <p>اضغط الرابط أدناه لدخول بوابتك في Full Scope ومتابعة سندات الصرف.</p>
    <p><a href="${safeUrl}" style="display:inline-block;padding:10px 16px;background:#0d9488;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">دخول البوابة</a></p>
    <p style="font-size:12px;color:#64748b;word-break:break-all;">${safeUrl}</p>
  </body></html>`
}

export interface SendClientPortalSignInLinkInput {
  developer_id: string
}

export type SendClientPortalSignInLinkResult =
  | { ok: true; message: string; magic_link_url?: string; emailed?: boolean }
  | { ok: false; error: string }

export async function sendClientPortalSignInLink(
  input: SendClientPortalSignInLinkInput,
): Promise<SendClientPortalSignInLinkResult> {
  const caller = await resolveStaff()
  if ('error' in caller) return { ok: false, error: caller.error }
  const callerTenantId: string = caller.tenantId

  const svc = createSupabaseService()

  // Fetch the developer/client row — must be in caller's tenant.
  const { data: devRow, error: devErr } = await svc
    .from('dsb_developers')
    .select('id, tenant_id, company_name_ar, contact_name, contact_email, user_id')
    .eq('id', input.developer_id)
    .maybeSingle()
  if (devErr || !devRow) {
    return { ok: false, error: 'تعذّر العثور على العميل.' }
  }
  if ((devRow as { tenant_id: string }).tenant_id !== callerTenantId) {
    return { ok: false, error: 'لا تملك صلاحية.' }
  }

  const developer = devRow as unknown as {
    id: string
    tenant_id: string
    company_name_ar: string
    contact_name: string | null
    contact_email: string | null
    user_id: string | null
  }

  const contactEmail = developer.contact_email?.trim().toLowerCase() ?? ''
  if (!contactEmail) {
    return { ok: false, error: 'لا يوجد بريد إلكتروني للعميل.' }
  }

  const recipientName = developer.contact_name?.trim() || developer.company_name_ar
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fullscope.sa'
  const loginUrl = `${origin}/login`

  // Feature-detect auth admin so we degrade gracefully in envs without it.
  type AuthAdminAny = {
    inviteUserByEmail?: (
      email: string,
      opts?: { redirectTo?: string },
    ) => Promise<{ data: { user?: { id?: string } } | null; error: { message: string } | null }>
    generateLink?: (params: {
      type: string
      email: string
      options?: { redirectTo?: string }
    }) => Promise<{
      data: { properties?: { action_link?: string }; user?: { id?: string } } | null
      error: { message: string } | null
    }>
  }
  const authAdmin = (svc.auth as unknown as { admin?: AuthAdminAny }).admin

  // Helper: ensure a users row exists for this contact_email in this tenant,
  // tagged dsb_role='developer', and link it back to the dsb_developers row.
  async function ensureUserRow(authUserId: string | null): Promise<string | null> {
    let userId: string | null = authUserId
    const { data: existingUser } = await svc
      .from('users')
      .select('id, dsb_role')
      .eq('email', contactEmail)
      .maybeSingle()
    if (existingUser) {
      userId = existingUser.id as string
      if (existingUser.dsb_role !== 'developer') {
        await svc.from('users').update({ dsb_role: 'developer' }).eq('id', userId)
      }
    } else {
      const fullName = developer.contact_name ?? developer.company_name_ar
      const { data: newUser } = await svc
        .from('users')
        .insert({
          tenant_id: callerTenantId,
          email: contactEmail,
          full_name: fullName,
          dsb_role: 'developer',
        })
        .select('id')
        .single()
      if (newUser) userId = newUser.id as string
    }
    if (userId) {
      await svc
        .from('dsb_developers')
        .update({ user_id: userId })
        .eq('id', developer.id)
        .eq('tenant_id', callerTenantId)
    }
    return userId
  }

  // Path A — no auth user yet: try invite first.
  if (!developer.user_id) {
    if (authAdmin && typeof authAdmin.inviteUserByEmail === 'function') {
      try {
        const invite = await authAdmin.inviteUserByEmail(contactEmail, {
          redirectTo: `${origin}/developer`,
        })
        if (!invite?.error) {
          const authUserId = invite?.data?.user?.id ?? null
          await ensureUserRow(authUserId)
          // inviteUserByEmail doesn't expose the action_link, but Supabase's
          // own email contains it. Try generateLink right after to give the
          // trustee a copyable URL too.
          let magicUrl: string | undefined
          if (typeof authAdmin.generateLink === 'function') {
            try {
              const gen = await authAdmin.generateLink({
                type: 'magiclink',
                email: contactEmail,
                options: { redirectTo: `${origin}/developer` },
              })
              magicUrl = gen?.data?.properties?.action_link ?? undefined
            } catch {
              // best-effort — return without the URL
            }
          }
          return {
            ok: true,
            message: 'تم إرسال دعوة الدخول إلى العميل عبر البريد.',
            magic_link_url: magicUrl,
            emailed: true,
          }
        }
        // Fall through to generateLink fallback.
      } catch (e) {
        console.warn('[dsb.portal-link] inviteUserByEmail threw', e)
      }
    }

    // Fallback: generateLink and email it ourselves via Resend.
    if (authAdmin && typeof authAdmin.generateLink === 'function') {
      try {
        const gen = await authAdmin.generateLink({
          type: 'magiclink',
          email: contactEmail,
          options: { redirectTo: `${origin}/developer` },
        })
        const actionLink = gen?.data?.properties?.action_link ?? null
        if (actionLink) {
          await ensureUserRow(gen?.data?.user?.id ?? null)
          const sendRes = await sendEmail({
            to: contactEmail,
            from: DSB_FROM,
            subject: 'رابط دخول بوابة Full Scope',
            html: buildEmailHtml(recipientName, actionLink),
            locale: 'ar',
          })
          if (sendRes.sent) {
            return {
              ok: true,
              message: 'تم إرسال رابط الدخول إلى بريد العميل.',
              magic_link_url: actionLink,
              emailed: true,
            }
          }
          return {
            ok: true,
            message: 'تم توليد رابط الدخول، لكن تعذّر إرساله بالبريد تلقائيًا. انسخه أدناه وأرسله يدويًا.',
            magic_link_url: actionLink,
            emailed: false,
          }
        }
      } catch (e) {
        console.warn('[dsb.portal-link] generateLink threw', e)
      }
    }

    return {
      ok: true,
      message:
        'تعذّر إرسال رابط الدخول تلقائيًا في هذه البيئة. يمكن إعادة الإرسال يدويًا من لوحة Supabase.',
    }
  }

  // Path B — auth user exists: send a magic link.
  if (authAdmin && typeof authAdmin.generateLink === 'function') {
    try {
      const gen = await authAdmin.generateLink({
        type: 'magiclink',
        email: contactEmail,
        options: { redirectTo: `${origin}/developer` },
      })
      const actionLink = gen?.data?.properties?.action_link ?? null
      if (actionLink) {
        const sendRes = await sendEmail({
          to: contactEmail,
          from: DSB_FROM,
          subject: 'رابط دخول بوابة Full Scope',
          html: buildEmailHtml(recipientName, actionLink),
          locale: 'ar',
        })
        if (sendRes.sent) {
          return {
            ok: true,
            message: 'تم إرسال رابط الدخول إلى بريد العميل.',
            magic_link_url: actionLink,
            emailed: true,
          }
        }
        return {
          ok: true,
          message: 'تم توليد الرابط، لكن تعذّر إرساله بالبريد تلقائيًا. انسخه أدناه وأرسله يدويًا.',
          magic_link_url: actionLink,
          emailed: false,
        }
      }
    } catch (e) {
      console.warn('[dsb.portal-link] generateLink (existing user) threw', e)
    }
  }

  // Last-resort fallback: at least email the plain login page link.
  const sendRes = await sendEmail({
    to: contactEmail,
    from: DSB_FROM,
    subject: 'رابط دخول بوابة Full Scope',
    html: buildEmailHtml(recipientName, loginUrl),
    locale: 'ar',
  })
  if (sendRes.sent) {
    return {
      ok: true,
      message: 'تم إرسال رابط البوابة إلى بريد العميل.',
      magic_link_url: loginUrl,
      emailed: true,
    }
  }
  return {
    ok: true,
    message:
      'تعذّر إرسال رابط الدخول تلقائيًا في هذه البيئة. يمكن إعادة الإرسال يدويًا من لوحة Supabase.',
    magic_link_url: loginUrl,
    emailed: false,
  }
}
