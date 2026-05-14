import Link from 'next/link'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import {
  statusChipClasses, statusLabel, stageLabel,
  fmtDate, daysBetween, pickOne,
  type WorkflowRunStatus, type WorkflowStageKind,
} from './_shared'

export const dynamic = 'force-dynamic'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type RunRow = {
  id: string
  status: WorkflowRunStatus
  started_at: string
  completed_at: string | null
  current_step_id: string | null
  initiated_by: string | null
  document: { display_name: string | null; filename: string } | { display_name: string | null; filename: string }[] | null
  client: { name: string } | { name: string }[] | null
  template: { name: string } | { name: string }[] | null
  initiator: { full_name: string | null } | { full_name: string | null }[] | null
}

type StepRow = {
  id: string
  run_id: string
  order_index: number
  kind: WorkflowStageKind
  name: string
  status: string
  signer_kind: string
}

const STATUS_RANK: Record<WorkflowRunStatus, number> = {
  awaiting_signer: 0,
  in_progress:     1,
  rejected:        2,
  expired:         3,
  cancelled:       4,
  completed:       5,
}

export default async function WorkflowsListPage() {
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

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [runsRes, stepsRes, inProgressCountRes, completed30Res, awaitingExternalCountRes] = await Promise.all([
    svc
      .from('dms_workflow_runs')
      .select(`
        id, status, started_at, completed_at, current_step_id, initiated_by,
        document:dms_documents!document_id(display_name, filename),
        client:clients!client_id(name),
        template:dms_workflow_templates!template_id(name),
        initiator:users!initiated_by(full_name)
      `)
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false }),
    svc
      .from('dms_workflow_run_steps')
      .select('id, run_id, order_index, kind, name, status, signer_kind')
      .eq('tenant_id', tenantId),
    svc
      .from('dms_workflow_runs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['in_progress', 'awaiting_signer']),
    svc
      .from('dms_workflow_runs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'completed')
      .gte('completed_at', thirtyDaysAgo),
    svc
      .from('dms_workflow_runs')
      .select('id, current_step_id')
      .eq('tenant_id', tenantId)
      .eq('status', 'awaiting_signer'),
  ])

  const runs = (runsRes.data ?? []) as unknown as RunRow[]
  const allSteps = (stepsRes.data ?? []) as StepRow[]

  // Build a map run_id -> current step for "current stage" col.
  const stepById = new Map<string, StepRow>(allSteps.map((s) => [s.id, s]))

  // Awaiting-external count: runs awaiting_signer whose current step is external.
  const awaitingExternalRunIds = (awaitingExternalCountRes.data ?? [])
    .map((r) => r.current_step_id as string | null)
    .filter((id): id is string => Boolean(id))
  const awaitingExternalCount = awaitingExternalRunIds.filter((sid) => {
    const s = stepById.get(sid)
    return s?.signer_kind === 'external'
  }).length

  const sortedRuns = [...runs].sort((a, b) => {
    const ra = STATUS_RANK[a.status] ?? 99
    const rb = STATUS_RANK[b.status] ?? 99
    if (ra !== rb) return ra - rb
    return new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  })

  const cards = [
    { label: tServer('workflows.metric.in_progress',       locale), value: inProgressCountRes.count ?? 0,    tone: 'amber' as const },
    { label: tServer('workflows.metric.completed',         locale), value: completed30Res.count ?? 0,        tone: 'green' as const },
    { label: tServer('workflows.metric.awaiting_external', locale), value: awaitingExternalCount,            tone: 'blue'  as const },
  ]

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="text-xs text-slate-500 flex items-center gap-1.5">
        <Link href="/app/dms" className="hover:text-slate-700">{tServer('dms.crumb.dms', locale)}</Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700 font-semibold">{tServer('workflows.title', locale)}</span>
      </nav>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            {tServer('workflows.title', locale)}
          </h1>
          <p className="text-sm text-slate-500 max-w-2xl">
            {tServer('workflows.subtitle', locale)}
          </p>
        </div>
        <Link
          href="/app/dms/workflows/new"
          className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition"
        >
          + {tServer('workflows.start_button', locale)}
        </Link>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <MetricCard key={c.label} label={c.label} value={c.value} tone={c.tone} />
        ))}
      </section>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {sortedRuns.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">
            {tServer('dms.section.empty', locale)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('workflows.col.document',       locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('workflows.col.template',       locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('workflows.col.client',         locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('workflows.col.current_stage',  locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('workflows.col.status',         locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('workflows.col.days_in_flight', locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('workflows.col.started_by',     locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('workflows.col.started',        locale)}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedRuns.map((r) => {
                  const doc = pickOne(r.document)
                  const client = pickOne(r.client)
                  const template = pickOne(r.template)
                  const initiator = pickOne(r.initiator)
                  const currentStep = r.current_step_id ? stepById.get(r.current_step_id) : null
                  const days = daysBetween(r.started_at, r.completed_at)
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-4 py-3">
                        <Link
                          href={`/app/dms/workflows/${r.id}`}
                          className="font-semibold text-slate-900 hover:text-teal-700"
                        >
                          {doc?.display_name ?? doc?.filename ?? '—'}
                        </Link>
                        {doc?.filename && doc.display_name && (
                          <div className="text-xs text-slate-500 truncate font-mono">{doc.filename}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{template?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{client?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        {currentStep ? stageLabel(currentStep.kind, locale) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusChipClasses(r.status)}`}>
                          {statusLabel(r.status, locale)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap font-mono text-xs">{days}</td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{initiator?.full_name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDate(r.started_at, locale)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function MetricCard({ tone, label, value }: { tone: 'amber' | 'green' | 'blue'; label: string; value: number }) {
  const palette = {
    amber: { bg: 'bg-amber-50', border: 'border-amber-100', value: 'text-amber-700', label: 'text-amber-900/70' },
    green: { bg: 'bg-green-50', border: 'border-green-100', value: 'text-green-700', label: 'text-green-900/70' },
    blue:  { bg: 'bg-blue-50',  border: 'border-blue-100',  value: 'text-blue-700',  label: 'text-blue-900/70' },
  }[tone]
  return (
    <div className={`rounded-xl border ${palette.border} ${palette.bg} p-5 shadow-sm`}>
      <div className={`text-xs font-semibold uppercase tracking-wider ${palette.label}`}>{label}</div>
      <div className={`mt-2 text-3xl font-black tracking-tight ${palette.value} font-mono`}>{value}</div>
    </div>
  )
}
