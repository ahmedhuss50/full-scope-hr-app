import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Suite-shell landing.
 *
 * Routes the signed-in user to the right home based on their dsb_role:
 *   - developer  → /developer       (client portal — sees only their own cases)
 *   - staff      → /app/disbursements  (Document Review for employee/supervisor/owner)
 *   - missing    → /app/disbursements  (let that page show its own access-denied)
 *   - not signed in → /login
 *
 * Routing here (not inside /app/disbursements) avoids the redirect loop that
 * happens when a developer hits a staff-only page that bounces them to /app.
 */
export default async function AppPickerPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('dsb_role')
    .eq('email', user.email)
    .maybeSingle()

  const role = (profile?.dsb_role as string | null) ?? null
  if (role === 'developer') redirect('/developer')
  redirect('/app/disbursements')
}
