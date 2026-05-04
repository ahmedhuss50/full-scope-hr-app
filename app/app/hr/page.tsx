import Link from 'next/link'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { StatusBadge } from '@/components/StatusBadge'
import type { ApplicationStatus } from '@/lib/types'
import { strings, t as tFn, type Locale } from '@/lib/i18n/translations'

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

type EngagementCostRow = {
  id: string
  code: string | null
  name: string | null
  status: string | null
  budget_hours: number | null
  end_date: string | null
  fee_amount: number | null
  collected_amount: number | null
  time_entries: { hours: number | null }[] | null
}

// Server-side translation helper. The dashboard renders inside a client
// LocaleProvider, but the page itself is a server component, so we read
// the locale from the user's profile and use the EN fallback for stability.
function tServer(key: keyof typeof strings, locale: Locale) {
  return strings[key]?.[locale] ?? strings[key]?.en ?? key
}

export default async function HrDashboardPage() {
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

  // YTD anchor for cost metrics.
  const yearStart = new Date(new Date().getFullYear(), 0, 1)
  const yearStartIso = yearStart.toISOString().slice(0, 10)

  const [appsThisMonth, openJobs, activeEmployees, pendingInterviews, engagementsForCost] = await Promise.all([
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
    svc
      .from('engagements')
      .select('id, code, name, status, budget_hours, end_date, fee_amount, collected_amount, time_entries(hours)')
      .eq('tenant_id', tenantId),
  ])

  const { data: recent } = await svc
    .from('applications')
    .select('id, status, applied_at, candidates(id, legal_first_name, legal_last_name), job_requisitions(title)')
    .eq('tenant_id', tenantId)
    .order('applied_at', { ascending: false })
    .limit(5)

  const recentRows = (recent ?? []) as unknown as RecentRow[]

  // ---- Cost-related metrics ----
  const allEng = (engagementsForCost.data ?? []) as unknown as EngagementCostRow[]

  // Margin (closed YTD): collected / fee on closed engagements with end_date in current year
  const closedYtd = allEng.filter(
    (e) => e.status === 'closed' && (e.end_date ?? '') >= yearStartIso
  )
  const closedFee       = closedYtd.reduce((s, e) => s + Number(e.fee_amount ?? 0), 0)
  const closedCollected = closedYtd.reduce((s, e) => s + Number(e.collected_amount ?? 0), 0)
  const marginYtdPct = closedFee > 0 ? closedCollected / closedFee : 0

  // Top 3 active engagements by utilization (actual / budget)
  const activeEng = allEng.filter((e) => e.status === 'active')
  type Health = { id: string; code: string; name: string; util: number; actual: number; budget: number }
  const healthList: Health[] = activeEng.map((e) => {
    const actual = (e.time_entries ?? []).reduce((s, t) => s + Number(t.hours ?? 0), 0)
    const budget = Number(e.budget_hours ?? 0)
    return {
      id: e.id,
      code: e.code ?? '—',
      name: e.name ?? '—',
      util: budget > 0 ? actual / budget : 0,
      actual,
      budget,
    }
  })
  healthList.sort((a, b) => b.util - a.util)
  const topHealth = healthList.slice(0, 3)

  function pctFmt(p: number) {
    try {
      return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(p)
    } catch {
      return `${(p * 100).toFixed(1)}%`
    }
  }

  const cards = [
    { label: tServer('dashboard.applications_this_month', locale), value: String(appsThisMonth.count ?? 0) },
    { label: tServer('dashboard.open_jobs',               locale), value: String(openJobs.count ?? 0) },
    { label: tServer('dashboard.active_employees',        locale), value: String(activeEmployees.count ?? 0) },
    { label: tServer('dashboard.pending_interviews',      locale), value: String(pendingInterviews.count ?? 0) },
    { label: tServer('dashboard.margin_ytd',              locale), value: pctFmt(marginYtdPct) },
  ]

  return (
    <div className="space-y-8">
      <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
        {tServer('nav.dashboard', locale)}
      </h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-lg p-6">
            <div className="text-3xl font-bold text-slate-900 font-mono">{c.value}</div>
            <div className="mt-2 text-xs uppercase tracking-wider text-slate-600">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                  href={`/app/hr/applications/${r.candidates?.id}?app=${r.id}`}
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

        <section>
          <h2 className="text-sm uppercase tracking-wider font-semibold text-slate-600 mb-3">
            {tServer('dashboard.engagement_health', locale)}
          </h2>
          <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
            {topHealth.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">—</div>
            ) : (
              topHealth.map((h) => {
                const tone =
                  h.util > 1.15 ? 'bg-red-50 text-red-700 ring-red-200'
                  : h.util > 1.0 ? 'bg-yellow-50 text-yellow-800 ring-yellow-200'
                  : 'bg-green-50 text-green-700 ring-green-200'
                return (
                  <Link
                    key={h.id}
                    href="/app/hr/costs"
                    className="flex items-center justify-between gap-4 p-4 hover:bg-slate-50 transition"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-slate-500">{h.code}</div>
                      <div className="font-semibold text-slate-900 truncate">{h.name}</div>
                    </div>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ring-inset ${tone}`}>
                      {tFn('dashboard.utilization', locale, { pct: Math.round(h.util * 100) })}
                    </span>
                  </Link>
                )
              })
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
