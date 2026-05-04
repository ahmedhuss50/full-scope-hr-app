import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import { requirePortalSession } from '../../../_lib/session'

export const dynamic = 'force-dynamic'

const SERVER_LOCALE: Locale = 'en'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type EngagementDetail = {
  id: string
  client_id: string
  code: string | null
  name: string
  status: string | null
  start_date: string | null
  end_date: string | null
  engagement_type: string | null
  fee_amount: number | null
  fee_currency: string | null
  lead_partner: { full_name: string | null } | { full_name: string | null }[] | null
}

type DocRow = {
  id: string
  display_name: string | null
  filename: string
  doc_kind: string | null
  uploaded_at: string
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

function fmtDate(s: string | null, locale: Locale): string {
  if (!s) return '—'
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      day: 'numeric', month: 'short', year: 'numeric',
    }).format(new Date(s))
  } catch {
    return s
  }
}

function fmtSar(amount: number | null, currency: string | null, locale: Locale): string {
  const cur = currency ?? 'SAR'
  const n = Number(amount ?? 0)
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      style: 'currency', currency: cur, maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${n.toLocaleString()} ${cur}`
  }
}

export default async function PortalEngagementDetailPage({ params }: { params: { id: string } }) {
  const session = await requirePortalSession()
  const locale = SERVER_LOCALE
  const svc = createSupabaseService()

  // Fetch the engagement, scoped to the contact's client_id and tenant. If
  // someone manually pastes another engagement id, this query returns nothing.
  const { data: eng } = await svc
    .from('engagements')
    .select(`
      id, client_id, code, name, status, start_date, end_date, engagement_type,
      fee_amount, fee_currency,
      lead_partner:users!lead_partner_id(full_name)
    `)
    .eq('tenant_id', session.tenantId)
    .eq('client_id', session.clientId)
    .eq('id', params.id)
    .maybeSingle()

  if (!eng) notFound()
  const engagement = eng as unknown as EngagementDetail

  // Documents associated with this engagement.
  const { data: docsData } = await svc
    .from('dms_documents')
    .select(`
      id, display_name, filename, doc_kind, uploaded_at,
      uploader:users!uploaded_by(full_name)
    `)
    .eq('tenant_id', session.tenantId)
    .eq('engagement_id', engagement.id)
    .order('uploaded_at', { ascending: false })
    .limit(50)

  // Recent activities at the client level (we don't have engagement_id on
  // crm_activities, so we surface client-level updates and let the contact
  // contextualize). Last 10.
  const { data: actData } = await svc
    .from('crm_activities')
    .select('id, kind, subject, body, occurred_at')
    .eq('tenant_id', session.tenantId)
    .eq('client_id', engagement.client_id)
    .order('occurred_at', { ascending: false })
    .limit(10)

  const docs = (docsData ?? []) as DocRow[]
  const activities = (actData ?? []) as ActivityRow[]
  const lead = pickOne<{ full_name: string | null }>(engagement.lead_partner)

  return (
    <div className="space-y-8">
      {/* Back link */}
      <div>
        <Link
          href="/portal/engagements"
          className="inline-flex items-center text-xs font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-3.5 h-3.5 me-1.5" aria-hidden="true" />
          {tServer('portal.engagement_detail.back', locale)}
        </Link>
      </div>

      {/* Header */}
      <header className="space-y-2">
        <div className="text-xs font-mono text-slate-500">{engagement.code ?? '—'}</div>
        <h1 className="serif font-bold text-3xl tracking-tight text-slate-900">
          {engagement.name}
        </h1>
        {engagement.engagement_type && (
          <div className="text-sm text-slate-600">{engagement.engagement_type}</div>
        )}
      </header>

      {/* Detail cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <DetailCard label={tServer('portal.engagement_detail.scope', locale)}>
          <p className="text-sm text-slate-700 leading-relaxed">
            {engagement.name || tServer('portal.engagement_detail.no_scope', locale)}
          </p>
        </DetailCard>
        <DetailCard label={tServer('portal.engagement_detail.team_lead', locale)}>
          <p className="text-sm text-slate-900 font-medium">{lead?.full_name ?? '—'}</p>
        </DetailCard>
        <DetailCard label={tServer('portal.engagement_detail.period', locale)}>
          <p className="text-sm text-slate-900">
            {fmtDate(engagement.start_date, locale)} — {fmtDate(engagement.end_date, locale)}
          </p>
        </DetailCard>
        <DetailCard label={tServer('portal.engagement_detail.status', locale)}>
          <p className="text-sm text-slate-900 font-medium capitalize">{engagement.status ?? '—'}</p>
        </DetailCard>
        <DetailCard label={tServer('portal.engagement_detail.fee', locale)}>
          <p className="text-sm text-slate-900 font-mono">
            {fmtSar(engagement.fee_amount, engagement.fee_currency, locale)}
          </p>
        </DetailCard>
      </section>

      {/* Associated documents */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">
          {tServer('portal.engagement_detail.section.docs', locale)}
        </h2>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {docs.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              {tServer('portal.engagement_detail.docs_empty', locale)}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {docs.map((d) => {
                const uploader = pickOne<{ full_name: string | null }>(d.uploader)
                return (
                  <li key={d.id} className="px-5 py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {d.display_name ?? d.filename}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 font-mono truncate">
                        {d.filename}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-xs text-slate-500 hidden sm:block">
                        {uploader?.full_name ?? 'Full Scope'} · {fmtDate(d.uploaded_at, locale)}
                      </div>
                      <a
                        href="#"
                        title={tServer('portal.documents.preview_unavailable', locale)}
                        className="text-xs font-semibold text-teal-600 hover:text-teal-700 cursor-not-allowed opacity-80"
                      >
                        {tServer('portal.documents.view', locale)}
                      </a>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Recent updates */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">
          {tServer('portal.engagement_detail.section.updates', locale)}
        </h2>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          {activities.length === 0 ? (
            <p className="text-sm text-slate-500">{tServer('portal.section.empty', locale)}</p>
          ) : (
            <ul className="space-y-4">
              {activities.map((a) => (
                <li key={a.id} className="border-s-2 border-teal-200 ps-3">
                  <div className="text-xs text-slate-500 mb-0.5">
                    {fmtDate(a.occurred_at, locale)} · {tFn(`crm.activity.kind.${a.kind}` as StringKey, locale) || a.kind}
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
      </section>
    </div>
  )
}

function DetailCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">{label}</div>
      {children}
    </div>
  )
}
