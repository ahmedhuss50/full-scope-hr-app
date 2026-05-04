import Link from 'next/link'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import { ArrowRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type DocRow = {
  id: string
  client_id: string | null
  sensitivity: 'public' | 'internal' | 'confidential' | 'restricted'
  uploaded_at: string
  retention_until: string | null
}

type ClientRow = { id: string; name: string; industry: string | null }

type AccessLogJoin = {
  id: string
  action: string
  occurred_at: string
  notes: string | null
  actor: { full_name: string | null } | { full_name: string | null }[] | null
  document: { display_name: string | null; filename: string } | { display_name: string | null; filename: string }[] | null
}

function actionKey(action: string): StringKey {
  switch (action) {
    case 'view':            return 'dms.activity.viewed'
    case 'download':        return 'dms.activity.downloaded'
    case 'share':           return 'dms.activity.shared'
    case 'version_upload':  return 'dms.activity.version_upload'
    case 'rename':          return 'dms.activity.renamed'
    case 'delete_attempt':  return 'dms.activity.delete_attempt'
    default:                return 'dms.activity.viewed'
  }
}

function fmtDateTime(s: string, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: 'numeric',
    }).format(new Date(s))
  } catch {
    return s
  }
}

export default async function DmsHomePage() {
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

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const in90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
  const monthStartIso = monthStart.toISOString()
  const todayIso = now.toISOString().slice(0, 10)
  const in90Iso = in90.toISOString().slice(0, 10)

  const [docsRes, addedThisMonthRes, sensitiveRes, expiringRes, clientsRes, recentRes, activeWorkflowsRes, recentWorkflowsRes] = await Promise.all([
    svc
      .from('dms_documents')
      .select('id, client_id, sensitivity, uploaded_at, retention_until')
      .eq('tenant_id', tenantId),
    svc
      .from('dms_documents')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('uploaded_at', monthStartIso),
    svc
      .from('dms_documents')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('sensitivity', ['confidential', 'restricted']),
    svc
      .from('dms_documents')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('retention_until', todayIso)
      .lte('retention_until', in90Iso),
    svc
      .from('clients')
      .select('id, name, industry')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .order('name', { ascending: true }),
    svc
      .from('dms_access_log')
      .select(`
        id, action, occurred_at, notes,
        actor:users!actor_user_id(full_name),
        document:dms_documents!document_id(display_name, filename)
      `)
      .eq('tenant_id', tenantId)
      .order('occurred_at', { ascending: false })
      .limit(8),
    svc
      .from('dms_workflow_runs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['in_progress', 'awaiting_signer']),
    svc
      .from('dms_workflow_runs')
      .select(`
        id, status, started_at,
        document:dms_documents!document_id(display_name, filename),
        client:clients!client_id(name)
      `)
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false })
      .limit(5),
  ])

  const docs = (docsRes.data ?? []) as DocRow[]
  const totalDocs = docs.length
  const addedThisMonth = addedThisMonthRes.count ?? 0
  const sensitiveCount = sensitiveRes.count ?? 0
  const expiringCount = expiringRes.count ?? 0

  const clients = (clientsRes.data ?? []) as ClientRow[]
  const clientCounts = new Map<string, number>()
  for (const d of docs) {
    if (!d.client_id) continue
    clientCounts.set(d.client_id, (clientCounts.get(d.client_id) ?? 0) + 1)
  }

  const recent = (recentRes.data ?? []) as unknown as AccessLogJoin[]
  const activeWorkflows = activeWorkflowsRes.count ?? 0
  type RecentWorkflowRow = {
    id: string
    status: string
    started_at: string
    document: { display_name: string | null; filename: string } | { display_name: string | null; filename: string }[] | null
    client: { name: string } | { name: string }[] | null
  }
  const recentWorkflows = (recentWorkflowsRes.data ?? []) as unknown as RecentWorkflowRow[]

  const cards = [
    { label: tServer('dms.metric.total',              locale), value: totalDocs,        tone: 'slate'  as const },
    { label: tServer('dms.metric.added_this_month',   locale), value: addedThisMonth,   tone: 'teal'   as const },
    { label: tServer('dms.metric.confidential',       locale), value: sensitiveCount,   tone: 'amber'  as const },
    { label: tServer('dms.metric.expiring_retention', locale), value: expiringCount,    tone: 'red'    as const },
    { label: tServer('dms.metric.active_workflows',   locale), value: activeWorkflows,  tone: 'teal'   as const },
  ]

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          {tServer('dms.home.title', locale)}
        </h1>
        <p className="text-sm text-slate-500 max-w-2xl">
          {tServer('dms.home.subtitle', locale)}
        </p>
      </header>

      {/* Metric cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map((c) => (
          <MetricCard key={c.label} label={c.label} value={c.value} tone={c.tone} />
        ))}
      </section>

      {/* Recent workflow activity (lightweight quick-glance — full table on /workflows) */}
      {recentWorkflows.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm uppercase tracking-wider font-semibold text-slate-600">
              {tServer('dms.section.recent_workflow_activity', locale)}
            </h2>
            <Link
              href="/app/dms/workflows"
              className="text-xs font-semibold text-teal-600 hover:text-teal-700"
            >
              {tServer('dms.nav.workflows', locale)} <ArrowRight className="inline w-3 h-3" />
            </Link>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100">
            {recentWorkflows.map((w) => {
              const doc = Array.isArray(w.document) ? w.document[0] : w.document
              const client = Array.isArray(w.client) ? w.client[0] : w.client
              const docTitle = doc?.display_name ?? doc?.filename ?? '—'
              const statusColor =
                w.status === 'completed' ? 'bg-green-50 text-green-700 ring-green-200' :
                w.status === 'rejected' ? 'bg-red-50 text-red-700 ring-red-200' :
                w.status === 'awaiting_signer' ? 'bg-blue-50 text-blue-700 ring-blue-200' :
                'bg-amber-50 text-amber-700 ring-amber-200'
              return (
                <Link
                  key={w.id}
                  href={`/app/dms/workflows/${w.id}`}
                  className="flex items-center justify-between gap-4 p-4 hover:bg-slate-50 transition"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{docTitle}</div>
                    <div className="text-xs text-slate-500 truncate">
                      {client?.name ?? '—'} · {fmtDateTime(w.started_at, locale)}
                    </div>
                  </div>
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ring-inset shrink-0 ${statusColor}`}>
                    {tServer(`workflows.status.${w.status}` as StringKey, locale)}
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Two-column body */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By client */}
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider font-semibold text-slate-600">
            {tServer('dms.section.by_client', locale)}
          </h2>
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100">
            {clients.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">{tServer('dms.section.empty', locale)}</div>
            ) : (
              clients.map((c) => (
                <Link
                  key={c.id}
                  href={`/app/dms/clients/${c.id}`}
                  className="flex items-center justify-between gap-4 p-4 hover:bg-slate-50 transition"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{c.name}</div>
                    <div className="text-xs text-slate-500 truncate">{c.industry ?? '—'}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="inline-flex items-center justify-center min-w-[2rem] px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                      {clientCounts.get(c.id) ?? 0}
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-400" aria-hidden="true" />
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        {/* Recent activity */}
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider font-semibold text-slate-600">
            {tServer('dms.section.recent_activity', locale)}
          </h2>
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100">
            {recent.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">{tServer('dms.section.empty', locale)}</div>
            ) : (
              recent.map((r) => {
                const actor = Array.isArray(r.actor) ? r.actor[0] : r.actor
                const doc = Array.isArray(r.document) ? r.document[0] : r.document
                const docTitle = doc?.display_name ?? doc?.filename ?? '—'
                return (
                  <div key={r.id} className="p-4">
                    <div className="text-sm text-slate-700">
                      <span className="font-semibold text-slate-900">{actor?.full_name ?? '—'}</span>
                      <span className="text-slate-500"> {tServer(actionKey(r.action), locale)} </span>
                      <span className="font-medium text-slate-800">{docTitle}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {fmtDateTime(r.occurred_at, locale)}
                      {r.notes ? <span className="text-slate-400"> · {r.notes}</span> : null}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function MetricCard({
  tone, label, value,
}: {
  tone: 'slate' | 'teal' | 'amber' | 'red'
  label: string
  value: number
}) {
  const palette = {
    slate: { bg: 'bg-slate-50', border: 'border-slate-200', value: 'text-slate-900', label: 'text-slate-600' },
    teal:  { bg: 'bg-teal-50',  border: 'border-teal-100',  value: 'text-teal-700',  label: 'text-teal-900/70' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-100', value: 'text-amber-700', label: 'text-amber-900/70' },
    red:   { bg: 'bg-red-50',   border: 'border-red-100',   value: 'text-red-700',   label: 'text-red-900/70' },
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
