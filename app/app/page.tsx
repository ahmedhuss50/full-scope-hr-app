import Link from 'next/link'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { StatusBadge } from '@/components/StatusBadge'
import type { ApplicationStatus } from '@/lib/types'
import { strings, type Locale } from '@/lib/i18n/translations'

export const dynamic = 'force-dynamic'

type RecentRow = {
  id: string
  status: ApplicationStatus
  applied_at: string
  candidates: {
    id: string
    legal_first_name: string
    legal_last_name: string
  } | null
  job_requisitions: { title: string } | null
}

// Server-side translation helper. The dashboard renders inside a client
// LocaleProvider, but the page itself is a server component, so we read
// the locale from the user's profile and use the EN fallback for stability.
function tServer(key: keyof typeof strings, locale: Locale) {
  return strings[key]?.[locale] ?? strings[key]?.en ?? key
}

export default async function DashboardPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id, locale')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) return null

  const tenantId = profile.tenant_id as string
  const locale = ((profile.locale as Locale) ?? 'ar')

  // Metric: applications this calendar month.
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [appsThisMonth, openJobs, activeEmployees, pendingInterviews] = await Promise.all([
    svc
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('applied_at', monthStart.toISOString()),
    svc
      .from('job_requisitions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'open'),
    svc
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('active', true),
    svc
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['interview_pending', 'interview_scheduled']),
  ])

  const { data: recent } = await svc
    .from('applications')
    .select('id, status, applied_at, candidates(id, legal_first_name, legal_last_name), job_requisitions(title)')
    .eq('tenant_id', tenantId)
    .order('applied_at', { ascending: false })
    .limit(5)

  const recentRows = (recent ?? []) as unknown as RecentRow[]

  const cards = [
    { label: tServer('dashboard.applications_this_month', locale), value: appsThisMonth.count ?? 0 },
    { label: tServer('dashboard.open_jobs',               locale), value: openJobs.count ?? 0 },
    { label: tServer('dashboard.active_employees',        locale), value: activeEmployees.count ?? 0 },
    { label: tServer('dashboard.pending_interviews',      locale), value: pendingInterviews.count ?? 0 },
  ]

  return (
    <div className="space-y-8">
      <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
        {tServer('nav.dashboard', locale)}
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-lg p-6">
            <div className="text-3xl font-bold text-slate-900">{c.value}</div>
            <div className="mt-2 text-xs uppercase tracking-wider text-slate-600">{c.label}</div>
          </div>
        ))}
      </div>

      <section>
        <h2 className="text-sm uppercase tracking-wider font-semibold text-slate-600 mb-3">
          {tServer('dashboard.recent_applications', locale)}
        </h2>
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
          {recentRows.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              {tServer('dashboard.empty', locale)}
            </div>
          ) : (
            recentRows.map((r) => (
              <Link
                key={r.id}
                href={`/app/applications/${r.candidates?.id}?app=${r.id}`}
                className="flex items-center justify-between gap-4 p-4 hover:bg-slate-50 transition"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">
                    {r.candidates?.legal_first_name} {r.candidates?.legal_last_name}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {r.job_requisitions?.title ?? '—'} · {new Date(r.applied_at).toLocaleDateString()}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
