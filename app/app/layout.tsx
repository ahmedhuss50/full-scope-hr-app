import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { LocaleProvider } from '@/lib/i18n/LocaleContext'
import { LanguageToggle } from '@/components/LanguageToggle'
import { Sidebar, type SidebarCounts } from '@/components/Sidebar'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, full_name, locale, tenants(name, slug)')
    .eq('email', user.email!)
    .maybeSingle()

  if (!profile) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="card p-8 max-w-lg text-center">
          <h1 className="serif font-bold text-2xl mb-2">No tenant mapping</h1>
          <p className="text-sm text-ink/70 mb-4">
            Your email <code className="font-mono bg-ink/5 px-1 py-0.5 rounded">{user.email}</code> is not linked to a tenant.
          </p>
        </div>
      </main>
    )
  }

  const tenantId = profile.tenant_id as string
  const tenant = Array.isArray(profile.tenants) ? profile.tenants[0] : profile.tenants

  // Sidebar counts — all scoped to the user's tenant.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [appsCount, onboardingCount, employeesCount, jobsCount] = await Promise.all([
    svc
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .not('status', 'in', '(hired,rejected,withdrawn)'),
    svc
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .gte('hire_date', thirtyDaysAgo),
    svc
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('active', true),
    svc
      .from('job_requisitions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'open'),
  ])

  const counts: SidebarCounts = {
    applications: appsCount.count ?? 0,
    onboarding:   onboardingCount.count ?? 0,
    employees:    employeesCount.count ?? 0,
    jobs:         jobsCount.count ?? 0,
  }

  return (
    <LocaleProvider initial={(profile.locale as 'en' | 'ar') ?? 'ar'}>
      {/* RTL: `.app-shell` (in globals.css) flips flex-direction to row-reverse,
          moving the sidebar to the right. The sidebar uses border-e (logical)
          so its divider also flips automatically. */}
      <div className="app-shell flex min-h-screen">
        <Sidebar
          counts={counts}
          user={{ full_name: profile.full_name as string | null, email: user.email ?? null }}
        />
        <div className="flex-1 min-w-0 flex flex-col">
          <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200">
            <div className="px-6 py-3 flex items-center justify-between gap-4">
              <div className="text-sm font-semibold text-slate-700 truncate">
                {tenant?.name ?? 'Unknown tenant'}
              </div>
              <div className="flex items-center gap-3">
                <LanguageToggle />
              </div>
            </div>
          </header>
          <main className="flex-1 p-6 min-w-0">{children}</main>
        </div>
      </div>
    </LocaleProvider>
  )
}
