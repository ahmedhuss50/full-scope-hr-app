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

  // Cert urgency: anything in employee_credentials or firm_credentials with
  // status in ('expiring_soon','expired') is treated as urgent and surfaced
  // as a count badge in the sidebar (Phase 3 / Block O).
  // Cost urgency: count of active engagements where actual hours / budget hours > 1.0
  // (Phase 2 / Block N — flags engagements that have blown the time budget).
  const [appsCount, onboardingCount, employeesCount, jobsCount, empCertUrgent, firmCertUrgent, engagementsForCost, dmsSensitiveCount, crmOpenTasksCount] = await Promise.all([
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
    svc
      .from('employee_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['expiring_soon', 'expired']),
    svc
      .from('firm_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['expiring_soon', 'expired']),
    svc
      .from('engagements')
      .select('id, budget_hours, time_entries(hours)')
      .eq('tenant_id', tenantId)
      .eq('status', 'active'),
    svc
      .from('dms_documents')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('sensitivity', ['confidential', 'restricted']),
    svc
      .from('crm_activities')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('kind', 'task')
      .eq('completed', false),
  ])

  // Compute over-budget count from joined time_entries (active engagements only).
  type EngBudgetRow = { id: string; budget_hours: number | null; time_entries: { hours: number | null }[] | null }
  const engForCost = (engagementsForCost.data ?? []) as unknown as EngBudgetRow[]
  const overBudgetCount = engForCost.filter((e) => {
    const budget = Number(e.budget_hours ?? 0)
    if (!budget) return false
    const actual = (e.time_entries ?? []).reduce((sum, te) => sum + Number(te.hours ?? 0), 0)
    return actual / budget > 1.0
  }).length

  const counts: SidebarCounts = {
    applications: appsCount.count ?? 0,
    onboarding:   onboardingCount.count ?? 0,
    employees:    employeesCount.count ?? 0,
    certs:        (empCertUrgent.count ?? 0) + (firmCertUrgent.count ?? 0),
    jobs:         jobsCount.count ?? 0,
    costs:        overBudgetCount,
    dmsSensitive: dmsSensitiveCount.count ?? 0,
    crmOpenTasks: crmOpenTasksCount.count ?? 0,
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
