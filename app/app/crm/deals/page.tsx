import Link from 'next/link'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import {
  PIPELINE_STAGES,
  stageClasses, stageLabel,
  fmtSar, fmtSarCompact, fmtDate,
  isOverdue,
  type CrmStage,
} from '../_shared'

export const dynamic = 'force-dynamic'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type DealRow = {
  id: string
  title: string
  stage: CrmStage
  estimated_value: number | null
  expected_close_date: string | null
  next_step: string | null
  client: { id: string; name: string } | { id: string; name: string }[] | null
  owner: { full_name: string | null } | { full_name: string | null }[] | null
  contact: { full_name: string | null } | { full_name: string | null }[] | null
}

export default async function CrmDealsPage({
  searchParams,
}: {
  searchParams: { view?: 'pipeline' | 'list' }
}) {
  const view = searchParams.view === 'list' ? 'list' : 'pipeline'

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

  const { data: dealsData } = await svc
    .from('crm_deals')
    .select(`
      id, title, stage, estimated_value, expected_close_date, next_step,
      client:clients!client_id(id, name),
      owner:users!owner_user_id(full_name),
      contact:crm_contacts!primary_contact_id(full_name)
    `)
    .eq('tenant_id', tenantId)
    .order('expected_close_date', { ascending: true })

  const deals = (dealsData ?? []) as unknown as DealRow[]

  // Bucket per stage for kanban
  const byStage = new Map<CrmStage, DealRow[]>()
  for (const s of PIPELINE_STAGES) byStage.set(s, [])
  for (const d of deals) byStage.get(d.stage)?.push(d)

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="text-xs text-slate-500 flex items-center gap-1.5">
        <Link href="/app/crm" className="hover:text-slate-700">{tServer('crm.crumb.crm', locale)}</Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700 font-semibold">{tServer('crm.crumb.deals', locale)}</span>
      </nav>

      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            {tServer('crm.deals.title', locale)}
          </h1>
          <p className="text-sm text-slate-500">{tServer('crm.deals.subtitle', locale)}</p>
        </div>

        {/* View toggle */}
        <div className="inline-flex rounded-md ring-1 ring-slate-200 bg-white overflow-hidden">
          <Link
            href="/app/crm/deals?view=pipeline"
            className={`px-3 py-1.5 text-sm font-semibold transition ${
              view === 'pipeline' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            {tServer('crm.deals.view.pipeline', locale)}
          </Link>
          <Link
            href="/app/crm/deals?view=list"
            className={`px-3 py-1.5 text-sm font-semibold transition ${
              view === 'list' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            {tServer('crm.deals.view.list', locale)}
          </Link>
        </div>
      </header>

      {view === 'pipeline' ? (
        <PipelineKanban byStage={byStage} locale={locale} />
      ) : (
        <DealsList deals={deals} locale={locale} />
      )}
    </div>
  )
}

function PipelineKanban({
  byStage, locale,
}: {
  byStage: Map<CrmStage, DealRow[]>
  locale: Locale
}) {
  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-4 min-w-max">
        {PIPELINE_STAGES.map((s) => {
          const items = byStage.get(s) ?? []
          const total = items.reduce((sum, d) => sum + Number(d.estimated_value ?? 0), 0)
          return (
            <div key={s} className="w-72 shrink-0 space-y-2">
              {/* Column header */}
              <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${stageClasses(s)}`}>
                    {stageLabel(s, locale)}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">
                    {tFn('crm.deals.deals_n', locale, { n: items.length })}
                  </span>
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900 font-mono">
                  {fmtSar(total, locale)}
                </div>
              </div>

              {/* Cards */}
              <div className="space-y-2">
                {items.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                    —
                  </div>
                ) : (
                  items.map((d) => {
                    const client  = Array.isArray(d.client)  ? d.client[0]  : d.client
                    const owner   = Array.isArray(d.owner)   ? d.owner[0]   : d.owner
                    const contact = Array.isArray(d.contact) ? d.contact[0] : d.contact
                    const overdue = isOverdue(d.expected_close_date, d.stage)
                    return (
                      <div
                        key={d.id}
                        className={`bg-white border rounded-lg p-3 shadow-sm ${
                          overdue ? 'border-red-300 ring-1 ring-red-100' : 'border-slate-200'
                        }`}
                      >
                        <div className="font-semibold text-sm text-slate-900 leading-snug">
                          {d.title}
                        </div>
                        {client && (
                          <Link
                            href={`/app/crm/clients/${client.id}`}
                            className="block text-xs text-teal-700 hover:text-teal-800 mt-0.5"
                          >
                            {client.name}
                          </Link>
                        )}
                        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-600">
                          <span className="font-mono font-semibold text-slate-900">
                            {fmtSarCompact(d.estimated_value, locale)}
                          </span>
                          <span className={overdue ? 'text-red-600 font-semibold' : ''}>
                            {fmtDate(d.expected_close_date, locale)}
                            {overdue ? ` · ${tFn('crm.overdue', locale)}` : ''}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span className="truncate">{owner?.full_name ?? tFn('crm.no_owner', locale)}</span>
                          <span className="truncate">{contact?.full_name ?? tFn('crm.no_contact', locale)}</span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DealsList({ deals, locale }: { deals: DealRow[]; locale: Locale }) {
  // Sort by stage (pipeline order) then by expected_close_date asc.
  const stageOrder: Record<CrmStage, number> = {
    lead: 0, qualified: 1, proposal: 2, negotiation: 3, on_hold: 4, won: 5, lost: 6,
  }
  const sorted = [...deals].sort((a, b) => {
    const so = stageOrder[a.stage] - stageOrder[b.stage]
    if (so !== 0) return so
    return (a.expected_close_date ?? '').localeCompare(b.expected_close_date ?? '')
  })

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      {sorted.length === 0 ? (
        <div className="p-10 text-center text-sm text-slate-500">{tFn('crm.deals.empty', locale)}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold text-start">{tFn('crm.deals.col.title',           locale)}</th>
                <th className="px-4 py-3 font-semibold text-start">{tFn('crm.deals.col.client',          locale)}</th>
                <th className="px-4 py-3 font-semibold text-start">{tFn('crm.deals.col.stage',           locale)}</th>
                <th className="px-4 py-3 font-semibold text-end">{tFn('crm.deals.col.value',           locale)}</th>
                <th className="px-4 py-3 font-semibold text-start">{tFn('crm.deals.col.expected_close',  locale)}</th>
                <th className="px-4 py-3 font-semibold text-start">{tFn('crm.deals.col.owner',           locale)}</th>
                <th className="px-4 py-3 font-semibold text-start">{tFn('crm.deals.col.contact',         locale)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((d) => {
                const client  = Array.isArray(d.client)  ? d.client[0]  : d.client
                const owner   = Array.isArray(d.owner)   ? d.owner[0]   : d.owner
                const contact = Array.isArray(d.contact) ? d.contact[0] : d.contact
                const overdue = isOverdue(d.expected_close_date, d.stage)
                return (
                  <tr key={d.id} className="hover:bg-slate-50/50 transition">
                    <td className="px-4 py-3 font-semibold text-slate-900">{d.title}</td>
                    <td className="px-4 py-3">
                      {client ? (
                        <Link href={`/app/crm/clients/${client.id}`} className="text-teal-700 hover:text-teal-800">
                          {client.name}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${stageClasses(d.stage)}`}>
                        {stageLabel(d.stage, locale)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-end font-mono text-slate-900 whitespace-nowrap">{fmtSar(d.estimated_value, locale)}</td>
                    <td className={`px-4 py-3 whitespace-nowrap ${overdue ? 'text-red-600 font-semibold' : 'text-slate-700'}`}>
                      {fmtDate(d.expected_close_date, locale)}
                      {overdue ? ` · ${tFn('crm.overdue', locale)}` : ''}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{owner?.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{contact?.full_name ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
