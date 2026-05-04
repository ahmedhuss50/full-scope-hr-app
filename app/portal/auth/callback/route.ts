/**
 * Client Portal — magic-link callback.
 *
 * Mirrors /app/auth/callback but with portal-specific routing:
 *   1. Exchange the code for a session.
 *   2. Look up portal_invitations by email (service-role; bypass RLS — the
 *      cookie-bound supabase client doesn't yet have the right tenant binding
 *      because clients aren't in `users`).
 *   3. If a portal invitation exists for this email → write a portal_access_log
 *      row (action='login') and redirect to /portal/dashboard.
 *   4. Otherwise → redirect to /portal/no-access.
 */
import { NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${origin}/portal/login?error=missing_code`)
  }

  const supabase = createSupabaseServer()
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeError) {
    return NextResponse.redirect(`${origin}/portal/login?error=exchange`)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    return NextResponse.redirect(`${origin}/portal/no-access`)
  }

  const svc = createSupabaseService()

  // Look up the portal invitation. We do not scope by tenant_id here because
  // the user's email maps deterministically to ONE tenant via the invitation
  // (portal_invitations is unique on (tenant_id, contact_id), and demo data
  // only seeds one tenant).
  const { data: invitation } = await svc
    .from('portal_invitations')
    .select('id, tenant_id, client_id, contact_id, active, first_login_at')
    .eq('email', user.email)
    .eq('active', true)
    .maybeSingle()

  if (!invitation) {
    return NextResponse.redirect(`${origin}/portal/no-access`)
  }

  // Append-only access log row (DEC-009 pattern).
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = request.headers.get('user-agent') ?? null

  await svc.from('portal_access_log').insert({
    tenant_id: invitation.tenant_id,
    client_id: invitation.client_id,
    contact_id: invitation.contact_id,
    action: 'login',
    ip_address: ip,
    user_agent: ua,
  })

  // Best-effort first/last login timestamps. Failure here doesn't block sign-in.
  const nowIso = new Date().toISOString()
  const updatePayload: { last_login_at: string; first_login_at?: string } = {
    last_login_at: nowIso,
  }
  if (!invitation.first_login_at) updatePayload.first_login_at = nowIso

  await svc
    .from('portal_invitations')
    .update(updatePayload)
    .eq('id', invitation.id)

  return NextResponse.redirect(`${origin}/portal/dashboard`)
}
