import Link from 'next/link'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import {
  PIPELINE_STAGES, OPEN_STAGES,
  stageLabel, stageBarClass, stageClasses,
  activityKindLabel, activityKindClasses,
  fmtSar, fmtDateTime, fmtDate, currentQuarterRange,
  type CrmStage, type CrmActivityKind,
} from './_shared'

export const dynamic = 'force-dynamic'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type DealRow = {
  id: string
  stage: CrmStage
  estimated_value: number | null
  expected_close_date: string | null
  actual_close_date: string | null
}

type TaskRow = {
  id: string
  subject: string
  due_at: string | null
  client: { name: string } | { name: string }[] | null
  actor: { full_name: string | null } | { full_name: string | null }[] | null
}

type ActivityRow = {
  id: string
  kind: CrmActivityKind
  subject: string
  occurred_at: string
  actor: { full_name: string | null } | { full_name: string | null }[] | null
  client: { id: string; name: string } | { id: string; name: string }[] | null
}

export default async function CrmHomePage() {
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

  const { startIso: qStart, endIso: qEnd } = currentQuarterRange(new Date())

  const [clientsRes, dealsRes, tasksRes, recentRes] = await Promise.all([
    svc
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'active'),
    svc
      .from('crm_deals')
      .select('id, stage, estimated_value, expected_close_date, actual_close_date')
      .eq('tenant_id', tenantId),
    svc
      .from('crm_activities')
      .select(`
        id, subject, due_at,
        client:clients!client_id(name),
        actor:users!actor_user_id(full_name)
      `)
      .eq('tenant_id', tenantId)
      .eq('kind', 'task')
      .eq('completed', false)
      .order('due_at', { ascending: true })
      .limit(8),
    svc
      .from('crm_activities')
      .select(`
        id, kind, subject, occurred_at,
        client:clients!client_id(id, name),
        actor:users!actor_user_id(full_name)
      `)
      .eq('tenant_id', tenantId)
      .order('occurred_at', { ascending: false })
      .limit(8),
  ])

  const deals = (dealsRes.data ?? []) as DealRow[]
  const tasks = (tasksRes.data ?? []) as unknown as TaskRow[]
  const recent = (recentRes.data ?? []) as unknown as ActivityRow[]

  const activeClients = clientsRes.count ?? 0

  const openDeals = deals.filter((d) => OPEN_STAGES.includes(d.stage))
  const openDealsCount = openDeals.length
  const pipelineValue = openDeals.reduce((s, d) => s + Number(d.estimated_value ?? 0), 0)

  const wonThisQuarter = deals.filter(
    (d) =>
      d.stage === 'won' &&
      d.actual_close_date &&
      d.actual_close_date >= qStart &&
      d.actual_close_date < qEnd,
  ).length

  // Pipeline-by-stage aggregation: count + total value per stage (open stages only).
  const PIPELINE_VIEW_STAGES: CrmStage[] = ['lead', 'qualified', 'proposal', 'negotiation', 'won']
  const stageAgg: Record<CrmStage, { count: number; value: number }> = {
    lead: { count: 0, value: 0 }, qualified: { count: 0, value: 0 }, proposal: { count: 0, value: 0 },
    negotiation: { count: 0, value: 0 }, on_hold: { count: 0, value: 0 },
    won: { count: 0, value: 0 }, lost: { count: 0, value: 0 },
  }
  for (const d of deals) {
    stageAgg[d.stage].count += 1
    stageAgg[d.stage].value += Number(d.estimated_value ?? 0)
  }
  const maxStageValue = PIPELINE_VIEW_STAGES.reduce(
    (m, s) => Math.max(m, stageAgg[s].value),
    0,
  )

  const cards = [
    { label: tServer('crm.metric.active_clients',   locale), value: String(activeClients),                tone: 'slate' as const },
    { label: tServer('crm.metric.open_deals',       locale), value: String(openDealsCount),               tone: 'teal'  as const },
    { label: tServer('crm.metric.pipeline_value',   locale), value: fmtSar(pipelineValue, locale),        tone: 'amber' as const },
    { label: tServer('crm.metric.won_this_quarter', locale), value: String(wonThisQuarter),               tone: 'green' as const },
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="space-y-2">
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          {tServer('crm.title', locale)}
        </h1>
        <p className="text-sm text-slate-500 max-w-2xl">
          {tServer('crm.subtitle', locale)}
        </p>
      </header>

      {/* Metric cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <MetricCard key={c.label} label={c.label} value={c.value} tone={c.tone} />
        ))}
      </section>

      {/* 2-column body: pipeline (2/3) + open tasks (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pipeline by stage */}
        <section className="lg:col-span-2 space-y-3">
          <h2 className="text-sm uppercase tracking-wider font-semibold text-slate-600">
            {tServer('crm.section.pipeline_by_stage', locale)}
          </h2>
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100">
            {PIPELINE_VIEW_STAGES.map((s) => {
              const agg = stageAgg[s]
              const pct = maxStageValue > 0 ? Math.max(2, Math.round((agg.value / maxStageValue) * 100)) : 0
              return (
                <div key={s} className="p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${stageClasses(s)}`}>
                        {stageLabel(s, locale)}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">
                        {tServer('crm.deals.deals_n', locale, { n: agg.count })}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-slate-900 font-mono whitespace-nowrap">
                      {fmtSar(agg.value, locale)}
                    </div>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full ${stageBarClass(s)} rounded-full`}
                      style={{ width: `${pct}%` }}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Open tasks */}
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider font-semibold text-slate-600">
            {tServer('crm.section.open_tasks', locale)}
          </h2>
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100">
            {tasks.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">{tServer('crm.section.empty', locale)}</div>
            ) : (
              tasks.map((t) => {
                const client = Array.isArray(t.client) ? t.client[0] : t.client
                const actor  = Array.isArray(t.actor)  ? t.actor[0]  : t.actor
                const due    = t.due_at
                const overdue = due ? due.slice(0, 10) < new Date().toISOString().slice(0, 10) : false
                return (
                  <div key={t.id} className="p-4">
                    <div className="text-sm font-semibold text-slate-900">{t.subject}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      {client?.name && <span>{client.name}</span>}
                      {due && (
                        <span className={overdue ? 'text-red-600 font-semibold' : ''}>
                          {tServer('crm.due_on', locale, { date: fmtDate(due, locale) })}
                        </span>
                      )}
                      {actor?.full_name && <span>· {actor.full_name}</span>}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>

      {/* Recent activity */}
      <section className="space-y-3">
        <h2 className="text-sm uppercase tracking-wider font-semibold text-slate-600">
          {tServer('crm.section.recent_activity', locale)}
        </h2>
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100">
          {recent.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">{tServer('crm.section.empty', locale)}</div>
          ) : (
            recent.map((r) => {
              const actor  = Array.isArray(r.actor)  ? r.actor[0]  : r.actor
              const client = Array.isArray(r.client) ? r.client[0] : r.client
              return (
                <div key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-slate-700 flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${activityKindClasses(r.kind)}`}>
                          {activityKindLabel(r.kind, locale)}
                        </span>
                        <span className="font-semibold text-slate-900">{actor?.full_name ?? '—'}</span>
                      </div>
                      <div className="text-sm text-slate-800 mt-1">{r.subject}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {client ? (
                          <Link
                            href={`/app/crm/clients/${client.id}`}
                            className="hover:text-slate-800 hover:underline"
                          >
                            {client.name}
                          </Link>
                        ) : (
                          '—'
                        )}
                        <span className="text-slate-300"> · </span>
                        {fmtDateTime(r.occurred_at, locale)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}

function MetricCard({
  tone, label, value,
}: {
  tone: 'slate' | 'teal' | 'amber' | 'red' | 'green'
  label: string
  value: string
}) {
  const palette = {
    slate: { bg: 'bg-slate-50', border: 'border-slate-200', value: 'text-slate-900', label: 'text-slate-600' },
    teal:  { bg: 'bg-teal-50',  border: 'border-teal-100',  value: 'text-teal-700',  label: 'text-teal-900/70' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-100', value: 'text-amber-700', label: 'text-amber-900/70' },
    red:   { bg: 'bg-red-50',   border: 'border-red-100',   value: 'text-red-700',   label: 'text-red-900/70' },
    green: { bg: 'bg-green-50', border: 'border-green-100', value: 'text-green-700', label: 'text-green-900/70' },
  }[tone]
  return (
    <div className={`rounded-xl border ${palette.border} ${palette.bg} p-5 shadow-sm`}>
      <div className={`text-xs font-semibold uppercase tracking-wider ${palette.label}`}>
        {label}
      </div>
      <div className={`mt-2 text-3xl font-black tracking-tight ${palette.value} font-mono`}>
        {value}
      </div>
    </div>
  )
}
