import Link from 'next/link'
import { ArrowRight, Plus } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import { fmtDateTime, OPEN_STAGES, type CrmStage } from '../_shared'

export const dynamic = 'force-dynamic'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type ClientRow = {
  id: string
  name: string
  industry: string | null
  primary_contact_name: string | null
  relationship_owner_id: string | null
  owner: { full_name: string | null } | { full_name: string | null }[] | null
}

type EngagementRow = { client_id: string }
type DealRow = { client_id: string; stage: CrmStage }
type ActivityRow = { client_id: string | null; occurred_at: string }

export default async function CrmClientsListPage() {
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

  const [clientsRes, engagementsRes, dealsRes, activitiesRes] = await Promise.all([
    svc
      .from('clients')
      .select(`
        id, name, industry, primary_contact_name, relationship_owner_id,
        owner:users!relationship_owner_id(full_name)
      `)
      .eq('tenant_id', tenantId)
      .eq('status', 'active'),
    svc
      .from('engagements')
      .select('client_id')
      .eq('tenant_id', tenantId),
    svc
      .from('crm_deals')
      .select('client_id, stage')
      .eq('tenant_id', tenantId),
    svc
      .from('crm_activities')
      .select('client_id, occurred_at')
      .eq('tenant_id', tenantId),
  ])

  const clients      = (clientsRes.data ?? []) as unknown as ClientRow[]
  const engagements  = (engagementsRes.data ?? []) as EngagementRow[]
  const deals        = (dealsRes.data ?? []) as DealRow[]
  const activities   = (activitiesRes.data ?? []) as ActivityRow[]

  const engCount = new Map<string, number>()
  for (const e of engagements) {
    if (!e.client_id) continue
    engCount.set(e.client_id, (engCount.get(e.client_id) ?? 0) + 1)
  }

  const openDealCount = new Map<string, number>()
  for (const d of deals) {
    if (!d.client_id) continue
    if (!OPEN_STAGES.includes(d.stage)) continue
    openDealCount.set(d.client_id, (openDealCount.get(d.client_id) ?? 0) + 1)
  }

  const lastActivity = new Map<string, string>()
  for (const a of activities) {
    if (!a.client_id) continue
    const prev = lastActivity.get(a.client_id)
    if (!prev || a.occurred_at > prev) lastActivity.set(a.client_id, a.occurred_at)
  }

  // Sort by recently-active first (clients with most-recent activity bubble up).
  const sorted = [...clients].sort((a, b) => {
    const la = lastActivity.get(a.id) ?? ''
    const lb = lastActivity.get(b.id) ?? ''
    return lb.localeCompare(la)
  })

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="text-xs text-slate-500 flex items-center gap-1.5">
        <Link href="/app/crm" className="hover:text-slate-700">{tServer('crm.crumb.crm', locale)}</Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700 font-semibold">{tServer('crm.crumb.clients', locale)}</span>
      </nav>

      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            {tServer('crm.clients.title', locale)}
          </h1>
          <p className="text-sm text-slate-500">{tServer('crm.clients.subtitle', locale)}</p>
        </div>
        <a
          href="#"
          title={tServer('crm.actions.coming_soon', locale)}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-800 cursor-not-allowed opacity-90"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {tServer('crm.clients.add', locale)}
        </a>
      </header>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {sorted.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">
            {tServer('crm.clients.empty', locale)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('crm.clients.col.name',            locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('crm.clients.col.industry',        locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('crm.clients.col.primary_contact', locale)}</th>
                  <th className="px-4 py-3 font-semibold text-end">{tServer('crm.clients.col.engagements',     locale)}</th>
                  <th className="px-4 py-3 font-semibold text-end">{tServer('crm.clients.col.open_deals',      locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('crm.clients.col.last_activity',   locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('crm.clients.col.owner',           locale)}</th>
                  <th className="px-4 py-3 font-semibold text-end">&nbsp;</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((c) => {
                  const owner = Array.isArray(c.owner) ? c.owner[0] : c.owner
                  const last = lastActivity.get(c.id)
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        <Link href={`/app/crm/clients/${c.id}`} className="hover:text-teal-700">
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{c.industry ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{c.primary_contact_name ?? '—'}</td>
                      <td className="px-4 py-3 text-end font-mono text-slate-700">{engCount.get(c.id) ?? 0}</td>
                      <td className="px-4 py-3 text-end font-mono text-slate-700">{openDealCount.get(c.id) ?? 0}</td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        {last ? fmtDateTime(last, locale) : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{owner?.full_name ?? '—'}</td>
                      <td className="px-4 py-3 text-end">
                        <Link
                          href={`/app/crm/clients/${c.id}`}
                          className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-600 hover:text-teal-700"
                        >
                          {tServer('dms.clients.open', locale)}
                          <ArrowRight className="w-4 h-4" aria-hidden="true" />
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
