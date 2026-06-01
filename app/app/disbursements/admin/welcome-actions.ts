'use server'

import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { sendWelcomeEmail } from '@/lib/email/disbursement-emails'

// ---------------------------------------------------------------------------
// Owner-only welcome-email senders.
//
// Two entry points:
//   1. sendWelcomeEmailToUser(user_id)       — one specific staff member
//   2. sendWelcomeEmailToAllStaff()          — every staff member except
//                                              the caller themselves
//
// Both look up the recipient's email/role from public.users in the caller's
// tenant, build the login URL from NEXT_PUBLIC_APP_URL (falling back to the
// production Vercel alias), and fire the email via Resend.
// ---------------------------------------------------------------------------

type StaffRole = 'employee' | 'supervisor' | 'owner'

const ROLE_LABEL_AR: Record<StaffRole, string> = {
  employee:   'مراجع',
  supervisor: 'مشرف',
  owner:      'مدير',
}

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
  const role = (profile.dsb_role as StaffRole | null) ?? null
  if (role !== 'owner') return { error: 'إرسال بريد الترحيب متاح للمدير فقط.' }
  return {
    tenantId: profile.tenant_id as string,
    userId: profile.id as string,
  }
}

function loginUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://full-scope-hr-app.vercel.app'
  return `${base.replace(/\/$/, '')}/login`
}

// ---------------------------------------------------------------------------
// Send to ONE user
// ---------------------------------------------------------------------------

export async function sendWelcomeEmailToUser(
  input: { user_id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!input.user_id) return { ok: false, error: 'بيانات ناقصة.' }

  const svc = createSupabaseService()
  const { data: target } = await svc
    .from('users')
    .select('id, email, full_name, dsb_role')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.user_id)
    .maybeSingle()
  if (!target?.email) return { ok: false, error: 'الموظف لا يملك بريدًا إلكترونيًا.' }

  const role = (target.dsb_role as StaffRole | null) ?? null
  if (!role || !['employee', 'supervisor', 'owner'].includes(role)) {
    return { ok: false, error: 'دور غير صالح.' }
  }

  const result = await sendWelcomeEmail({
    to: target.email as string,
    fullName: (target.full_name as string | null) ?? (target.email as string),
    roleLabelAr: ROLE_LABEL_AR[role],
    loginUrl: loginUrl(),
  })

  // sendWelcomeEmail returns either the Resend payload OR { sent: false, reason }
  // on timeout. We treat timeouts as success-ish (the message was dispatched)
  // and only fail on explicit Resend errors.
  if (result && typeof result === 'object' && 'sent' in result && (result as { sent: boolean }).sent === false) {
    const reason = (result as { reason?: string }).reason ?? 'unknown'
    if (reason !== 'timeout') {
      return { ok: false, error: `فشل الإرسال: ${reason}` }
    }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Send to ALL staff (except the caller).
// Returns a count so the UI can render a summary.
// ---------------------------------------------------------------------------

export async function sendWelcomeEmailToAllStaff(): Promise<
  | { ok: true; sent: number; skipped: number }
  | { ok: false; error: string }
> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }

  const svc = createSupabaseService()
  const { data: rows } = await svc
    .from('users')
    .select('id, email, full_name, dsb_role')
    .eq('tenant_id', caller.tenantId)
    .in('dsb_role', ['employee', 'supervisor', 'owner'])
    .neq('id', caller.userId)

  const staff = (rows ?? []) as Array<{
    id: string
    email: string | null
    full_name: string | null
    dsb_role: StaffRole | null
  }>

  let sent = 0
  let skipped = 0
  const url = loginUrl()
  for (const u of staff) {
    if (!u.email || !u.dsb_role) {
      skipped += 1
      continue
    }
    try {
      await sendWelcomeEmail({
        to: u.email,
        fullName: u.full_name ?? u.email,
        roleLabelAr: ROLE_LABEL_AR[u.dsb_role],
        loginUrl: url,
      })
      sent += 1
    } catch (err) {
      console.error('[dsb] welcome email failed for', u.email, err)
      skipped += 1
    }
  }

  return { ok: true, sent, skipped }
}
