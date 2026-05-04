import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'

export const dynamic = 'force-dynamic'

// ---------- types ----------
type EmployeeRow = {
  id: string
  legal_first_name: string | null
  legal_last_name: string | null
  preferred_name: string | null
  job_title: string | null
  hire_date: string | null
  practice_area_id: string | null
}

type ModuleRow = {
  id: string
  title: string
  content_ref: string | null      // 'day1' | 'day7' | 'day30' | 'day60' | 'day90'
  required: boolean
  order_index: number
  onboarding_track_id: string
}

type CompletionRow = {
  employee_id: string
  onboarding_module_id: string
}

type RoleRow = {
  id: string
  name: string
  practice_area_id: string | null
}

type TrackRow = {
  id: string
  onboarding_role_id: string
}

// ---------- helpers ----------
function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

function fullName(e: EmployeeRow): string {
  if (e.preferred_name) return e.preferred_name
  const composed = [e.legal_first_name, e.legal_last_name].filter(Boolean).join(' ')
  return composed || '—'
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  const target = new Date(dateStr + 'T00:00:00Z')
  const today = new Date()
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const targetUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate())
  return Math.max(0, Math.round((todayUtc - targetUtc) / (1000 * 60 * 60 * 24)))
}

function formatDate(dateStr: string | null, locale: Locale): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00Z')
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    }).format(d)
  } catch {
    return dateStr
  }
}

const MILESTONES: Array<{ key: 'day1' | 'day7' | 'day30' | 'day60' | 'day90'; labelKey: StringKey; dayNumber: number }> = [
  { key: 'day1',  labelKey: 'onboarding.day1',  dayNumber: 1 },
  { key: 'day7',  labelKey: 'onboarding.day7',  dayNumber: 7 },
  { key: 'day30', labelKey: 'onboarding.day30', dayNumber: 30 },
  { key: 'day60', labelKey: 'onboarding.day60', dayNumber: 60 },
  { key: 'day90', labelKey: 'onboarding.day90', dayNumber: 90 },
]

type MilestoneStatus = 'complete' | 'in_progress' | 'pending' | 'none'

// ---------- page ----------
export default async function OnboardingPage() {
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

  const locale = ((profile.locale as Locale) ?? 'ar')
  const tenantId = profile.tenant_id as string

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Fetch new hires (active, hired in last 90 days)
  const [empRes, rolesRes, tracksRes, modulesRes, completionsRes] = await Promise.all([
    svc
      .from('employees')
      .select('id, legal_first_name, legal_last_name, preferred_name, job_title, hire_date, practice_area_id')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .gte('hire_date', ninetyDaysAgo)
      .order('hire_date', { ascending: false }),
    svc
      .from('onboarding_roles')
      .select('id, name, practice_area_id')
      .eq('tenant_id', tenantId)
      .eq('active', true),
    svc
      .from('onboarding_tracks')
      .select('id, onboarding_role_id')
      .eq('tenant_id', tenantId)
      .eq('active', true),
    svc
      .from('onboarding_modules')
      .select('id, title, content_ref, required, order_index, onboarding_track_id')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('order_index', { ascending: true }),
    svc
      .from('onboarding_completions')
      .select('employee_id, onboarding_module_id')
      .eq('tenant_id', tenantId),
  ])

  if (empRes.error)         console.error('[onboarding] employees',          empRes.error)
  if (rolesRes.error)       console.error('[onboarding] roles',              rolesRes.error)
  if (tracksRes.error)      console.error('[onboarding] tracks',             tracksRes.error)
  if (modulesRes.error)     console.error('[onboarding] modules',            modulesRes.error)
  if (completionsRes.error) console.error('[onboarding] completions',        completionsRes.error)

  const employees   = (empRes.data         ?? []) as EmployeeRow[]
  const roles       = (rolesRes.data       ?? []) as RoleRow[]
  const tracks      = (tracksRes.data      ?? []) as TrackRow[]
  const modules     = (modulesRes.data     ?? []) as ModuleRow[]
  const completions = (completionsRes.data ?? []) as CompletionRow[]

  // Completion lookup by employee
  const completedByEmp = new Map<string, Set<string>>()
  for (const c of completions) {
    if (!completedByEmp.has(c.employee_id)) completedByEmp.set(c.employee_id, new Set())
    completedByEmp.get(c.employee_id)!.add(c.onboarding_module_id)
  }

  // Map: employee -> matching track's modules.
  function resolveModulesForEmployee(emp: EmployeeRow): ModuleRow[] {
    let role = roles.find((r) => emp.practice_area_id && r.practice_area_id === emp.practice_area_id)
    if (!role) role = roles[0]
    if (!role) return []
    const trackIds = tracks.filter((t) => t.onboarding_role_id === role!.id).map((t) => t.id)
    if (trackIds.length === 0) return []
    return modules.filter((m) => trackIds.includes(m.onboarding_track_id))
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          {tServer('onboarding.title', locale)}
        </h1>
        <p className="text-sm text-slate-500">
          {tServer('onboarding.active_count', locale, { n: employees.length })}
        </p>
      </header>

      {employees.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500 text-sm">
          {tServer('onboarding.empty', locale)}
        </div>
      ) : (
        <div className="space-y-4">
          {employees.map((emp) => {
            const empModules = resolveModulesForEmployee(emp)
            const requiredModules = empModules.filter((m) => m.required)
            const totalRequired = requiredModules.length
            const completedSet = completedByEmp.get(emp.id) ?? new Set<string>()
            const completedCount = requiredModules.filter((m) => completedSet.has(m.id)).length
            const pct = totalRequired === 0 ? 0 : Math.round((completedCount / totalRequired) * 100)
            const days = daysSince(emp.hire_date)
            const allComplete = totalRequired > 0 && completedCount === totalRequired

            // Per-milestone status
            const milestoneStatuses: Record<string, MilestoneStatus> = {}
            for (const m of MILESTONES) {
              const ms = empModules.filter((mod) => mod.content_ref === m.key)
              if (ms.length === 0) {
                milestoneStatuses[m.key] = 'none'
                continue
              }
              const allDone = ms.every((mod) => completedSet.has(mod.id))
              const anyDone = ms.some((mod) => completedSet.has(mod.id))
              if (allDone) milestoneStatuses[m.key] = 'complete'
              else if (anyDone) milestoneStatuses[m.key] = 'in_progress'
              else if (days !== null && days >= m.dayNumber) milestoneStatuses[m.key] = 'in_progress'
              else milestoneStatuses[m.key] = 'pending'
            }

            return (
              <article
                key={emp.id}
                className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md transition"
              >
                <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                  <div>
                    <h3 className="serif font-bold text-lg text-slate-900">{fullName(emp)}</h3>
                    <p className="text-sm text-slate-600 mt-0.5">{emp.job_title ?? '—'}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {tServer('onboarding.hired_on', locale, { date: formatDate(emp.hire_date, locale) })}
                      {days !== null && (
                        <>
                          <span className="mx-2 text-slate-300">·</span>
                          {tServer('onboarding.day_n', locale, { n: days })}
                        </>
                      )}
                    </p>
                  </div>
                  <div>
                    {allComplete ? (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 ring-1 ring-inset ring-green-200">
                        {tServer('onboarding.complete', locale)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200">
                        {tServer('onboarding.in_progress', locale)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-slate-600">
                      {tServer('onboarding.progress', locale, { done: completedCount, total: totalRequired })}
                    </span>
                    <span className="text-xs font-semibold text-slate-700">{pct}%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        allComplete ? 'bg-green-500' : 'bg-teal-500'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {/* Milestone tracker */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {MILESTONES.map((m, idx) => {
                    const status = milestoneStatuses[m.key]
                    const label = tServer(m.labelKey, locale)
                    let dot: string
                    let text: string
                    switch (status) {
                      case 'complete':
                        dot = 'bg-green-500'
                        text = 'text-slate-900 font-semibold'
                        break
                      case 'in_progress':
                        dot = 'bg-teal-500'
                        text = 'text-slate-900 font-semibold'
                        break
                      case 'pending':
                        dot = 'bg-slate-200'
                        text = 'text-slate-500'
                        break
                      case 'none':
                      default:
                        dot = 'bg-slate-200'
                        text = 'text-slate-400'
                    }
                    return (
                      <div key={m.key} className="flex items-center gap-2">
                        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} aria-hidden="true" />
                        <span className={`text-xs ${text}`}>
                          {label}
                          {status === 'in_progress' && (
                            <span className="ms-1 text-teal-700">({tServer('onboarding.in_progress', locale)})</span>
                          )}
                        </span>
                        {idx < MILESTONES.length - 1 && (
                          <span className="text-slate-200 mx-1" aria-hidden="true">·</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
