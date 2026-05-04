import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import { requirePortalSession } from '../../_lib/session'

export const dynamic = 'force-dynamic'

const SERVER_LOCALE: Locale = 'en'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type EngagementRow = {
  id: string
  code: string | null
  name: string
  status: string | null
  start_date: string | null
  end_date: string | null
  engagement_type: string | null
  budget_hours: number | null
  lead_partner: { full_name: string | null } | { full_name: string | null }[] | null
  time_entries: { hours: number | null }[] | null
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

function statusLabel(status: string | null, locale: Locale): string {
  if (!status) return '—'
  const key = `portal.engagements.status.${status}` as StringKey
  return tFn(key, locale) || status
}

function statusClasses(status: string | null): string {
  switch (status) {
    case 'active':  return 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
    case 'closed':  return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
    case 'planned': return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200'
    default:        return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
  }
}

/**
 * Convert raw budget vs actual hours into a client-friendly bucket. We do
 * NOT show the underlying numbers — clients shouldn't see internal hour
 * tracking, just whether the engagement is healthy or running over.
 */
function budgetBucket(budgetHours: number | null, actualHours: number): 'on_track' | 'approaching' | 'over' {
  const b = Number(budgetHours ?? 0)
  if (!b) return 'on_track'
  const pct = actualHours / b
  if (pct > 1.0) return 'over'
  if (pct >= 0.85) return 'approaching'
  return 'on_track'
}

function budgetClasses(bucket: 'on_track' | 'approaching' | 'over'): string {
  switch (bucket) {
    case 'on_track':    return 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
    case 'approaching': return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200'
    case 'over':        return 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200'
  }
}

export default async function PortalEngagementsPage() {
  const session = await requirePortalSession()
  const locale = SERVER_LOCALE
  const svc = createSupabaseService()

  const { data } = await svc
    .from('engagements')
    .select(`
      id, code, name, status, start_date, end_date, engagement_type, budget_hours,
      lead_partner:users!lead_partner_id(full_name),
      time_entries(hours)
    `)
    .eq('tenant_id', session.tenantId)
    .eq('client_id', session.clientId)
    .order('start_date', { ascending: false })

  const rows = (data ?? []) as unknown as EngagementRow[]

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="serif font-bold text-3xl tracking-tight text-slate-900">
          {tServer('portal.engagements.title', locale)}
        </h1>
        <p className="text-slate-600 text-sm">{tServer('portal.engagements.subtitle', locale)}</p>
      </header>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {rows.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">
            {tServer('portal.engagements.empty', locale)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('portal.engagements.col.code',   locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('portal.engagements.col.type',   locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('portal.engagements.col.start',  locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('portal.engagements.col.end',    locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('portal.engagements.col.status', locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('portal.engagements.col.lead',   locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('portal.engagements.col.budget', locale)}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((e) => {
                  const lead = pickOne<{ full_name: string | null }>(e.lead_partner)
                  const actual = (e.time_entries ?? []).reduce((s, te) => s + Number(te.hours ?? 0), 0)
                  const bucket = budgetBucket(e.budget_hours, actual)
                  return (
                    <tr key={e.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{e.code ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-700">
                        <div className="font-medium text-slate-900">{e.engagement_type ?? '—'}</div>
                        <div className="text-xs text-slate-500 truncate max-w-[18rem]">{e.name}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDate(e.start_date, locale)}</td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDate(e.end_date, locale)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusClasses(e.status)}`}>
                          {statusLabel(e.status, locale)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{lead?.full_name ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${budgetClasses(bucket)}`}>
                          {tServer(`portal.engagements.budget.${bucket}` as StringKey, locale)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-end whitespace-nowrap">
                        <Link
                          href={`/portal/engagements/${e.id}`}
                          className="inline-flex items-center text-xs font-semibold text-teal-600 hover:text-teal-700"
                        >
                          {tServer('portal.documents.view', locale)}
                          <ArrowRight className="w-3.5 h-3.5 ms-1" aria-hidden="true" />
                        </Link>
                      </td>
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
