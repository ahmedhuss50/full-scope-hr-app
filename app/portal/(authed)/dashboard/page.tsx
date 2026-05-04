import { Briefcase, Receipt, FileText } from 'lucide-react'
import { createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import { requirePortalSession } from '../../_lib/session'

export const dynamic = 'force-dynamic'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

// Server default locale for portal pages. The client-side LocaleProvider in
// the layout mirrors localStorage and toggles client-side strings on the fly,
// but server-rendered tServer() output is fixed at request time. For the
// demo we default to English (firm partner is presenting to KSA exec; both
// EN and AR translations are wired and switch on client widgets).
const SERVER_LOCALE: Locale = 'en'

type DocRow = {
  id: string
  display_name: string | null
  filename: string
  uploaded_at: string
  doc_kind: string | null
  uploader: { full_name: string | null } | { full_name: string | null }[] | null
}

type ActivityRow = {
  id: string
  kind: string
  subject: string
  body: string | null
  occurred_at: string
}

function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

function activityKindLabel(kind: string, locale: Locale): string {
  // Reuse existing CRM activity-kind translations on the firm side. Keys are
  // crm.activity.kind.{call,email,meeting,note,task,proposal_sent,engagement_started}.
  const key = `crm.activity.kind.${kind}` as StringKey
  return tFn(key, locale)
}

function fmtDate(s: string, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      day: 'numeric', month: 'short', year: 'numeric',
    }).format(new Date(s))
  } catch {
    return s
  }
}

export default async function PortalDashboardPage() {
  const session = await requirePortalSession()
  const locale = SERVER_LOCALE
  const svc = createSupabaseService()

  // Three tile counts + the two right-column feeds.
  const [activeEngagementsRes, docsCountRes, activitiesRes, recentDocsRes] = await Promise.all([
    svc
      .from('engagements')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', session.tenantId)
      .eq('client_id', session.clientId)
      .eq('status', 'active'),
    svc
      .from('dms_documents')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', session.tenantId)
      .eq('client_id', session.clientId),
    svc
      .from('crm_activities')
      .select('id, kind, subject, body, occurred_at')
      .eq('tenant_id', session.tenantId)
      .eq('client_id', session.clientId)
      .order('occurred_at', { ascending: false })
      .limit(5),
    svc
      .from('dms_documents')
      .select(`
        id, display_name, filename, uploaded_at, doc_kind,
        uploader:users!uploaded_by(full_name)
      `)
      .eq('tenant_id', session.tenantId)
      .eq('client_id', session.clientId)
      .order('uploaded_at', { ascending: false })
      .limit(5),
  ])

  const activeEngagements = activeEngagementsRes.count ?? 0
  const documentsOnFile = docsCountRes.count ?? 0
  const openInvoices = 1 // Hardcoded for demo; invoicing module ships Q4.

  const activities = (activitiesRes.data ?? []) as ActivityRow[]
  const recentDocs = (recentDocsRes.data ?? []) as DocRow[]

  return (
    <div className="space-y-10">
      {/* Welcome */}
      <header className="space-y-2">
        <h1 className="serif font-black text-3xl md:text-4xl tracking-tight text-slate-900">
          {tServer('portal.dashboard.welcome', locale, { name: session.contactFirstName })}
        </h1>
        <p className="text-slate-600">{tServer('portal.dashboard.subtitle', locale)}</p>
      </header>

      {/* Metric tiles */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          icon={<Briefcase className="w-5 h-5 text-teal-600" aria-hidden="true" />}
          label={tServer('portal.metric.active_engagements', locale)}
          value={String(activeEngagements)}
        />
        <MetricCard
          icon={<Receipt className="w-5 h-5 text-teal-600" aria-hidden="true" />}
          label={tServer('portal.metric.open_invoices', locale)}
          value={String(openInvoices)}
        />
        <MetricCard
          icon={<FileText className="w-5 h-5 text-teal-600" aria-hidden="true" />}
          label={tServer('portal.metric.documents', locale)}
          value={String(documentsOnFile)}
        />
      </section>

      {/* Two-column: recent updates + recent docs */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent updates */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">
            {tServer('portal.section.recent_activity', locale)}
          </h2>
          {activities.length === 0 ? (
            <p className="text-sm text-slate-500">{tServer('portal.section.empty', locale)}</p>
          ) : (
            <ul className="space-y-4">
              {activities.map((a) => (
                <li key={a.id} className="border-s-2 border-teal-200 ps-3">
                  <div className="text-xs text-slate-500 mb-0.5">
                    {fmtDate(a.occurred_at, locale)} · {activityKindLabel(a.kind, locale)}
                  </div>
                  <div className="text-sm text-slate-900 font-medium">{a.subject}</div>
                  {a.body && (
                    <div className="text-xs text-slate-600 mt-0.5 line-clamp-2">{a.body}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent documents */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">
            {tServer('portal.section.recent_documents', locale)}
          </h2>
          {recentDocs.length === 0 ? (
            <p className="text-sm text-slate-500">{tServer('portal.section.empty', locale)}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentDocs.map((d) => {
                const uploader = pickOne<{ full_name: string | null }>(d.uploader)
                return (
                  <li key={d.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">
                          {d.display_name ?? d.filename}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {uploader?.full_name ?? 'Full Scope'} · {fmtDate(d.uploaded_at, locale)}
                        </div>
                      </div>
                      {d.doc_kind && (
                        <span className="chip bg-slate-100 text-slate-700 shrink-0">
                          {tServer(`dms.kind.${d.doc_kind}` as StringKey, locale) || d.doc_kind}
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-teal-50">
          {icon}
        </div>
      </div>
      <div className="text-3xl font-bold text-slate-900 mb-1 tabular-nums">{value}</div>
      <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</div>
    </div>
  )
}
