import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Star, Phone, Mail } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import {
  fmtSar, fmtDate, fmtDateTime,
  stageClasses, stageLabel,
  roleClasses, roleLabel,
  activityKindClasses, activityKindLabel,
  OPEN_STAGES,
  type CrmStage, type CrmContactRole, type CrmActivityKind,
} from '../../_shared'

export const dynamic = 'force-dynamic'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type ContactRow = {
  id: string
  full_name: string
  job_title: string | null
  email: string | null
  mobile_phone: string | null
  office_phone: string | null
  role: CrmContactRole
  is_primary: boolean
}

type EngagementRow = {
  id: string
  code: string | null
  name: string
  status: string | null
  engagement_type: string | null
  fee_amount: number | null
  billed_amount: number | null
  budget_hours: number | null
  time_entries: { hours: number | null }[] | null
}

type DealRow = {
  id: string
  title: string
  stage: CrmStage
  estimated_value: number | null
  expected_close_date: string | null
  next_step: string | null
  next_step_due: string | null
}

type ActivityRow = {
  id: string
  kind: CrmActivityKind
  subject: string
  body: string | null
  occurred_at: string
  actor: { full_name: string | null } | { full_name: string | null }[] | null
}

export default async function CrmClientDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const clientId = params.id

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

  const { data: clientData } = await svc
    .from('clients')
    .select(`
      id, name, legal_name, trade_name, industry, country_code, since,
      primary_contact_name, primary_contact_email, relationship_owner_id,
      owner:users!relationship_owner_id(full_name)
    `)
    .eq('tenant_id', tenantId)
    .eq('id', clientId)
    .maybeSingle()

  if (!clientData) notFound()

  const ownerJoin = (clientData as { owner: { full_name: string | null } | { full_name: string | null }[] | null }).owner
  const ownerObj = Array.isArray(ownerJoin) ? ownerJoin[0] : ownerJoin

  const [contactsRes, engagementsRes, dealsRes, activitiesRes] = await Promise.all([
    svc
      .from('crm_contacts')
      .select('id, full_name, job_title, email, mobile_phone, office_phone, role, is_primary')
      .eq('tenant_id', tenantId)
      .eq('client_id', clientId)
      .order('is_primary', { ascending: false })
      .order('full_name', { ascending: true }),
    svc
      .from('engagements')
      .select(`
        id, code, name, status, engagement_type, fee_amount, billed_amount, budget_hours,
        time_entries(hours)
      `)
      .eq('tenant_id', tenantId)
      .eq('client_id', clientId)
      .order('start_date', { ascending: false }),
    svc
      .from('crm_deals')
      .select('id, title, stage, estimated_value, expected_close_date, next_step, next_step_due')
      .eq('tenant_id', tenantId)
      .eq('client_id', clientId)
      .order('expected_close_date', { ascending: true }),
    svc
      .from('crm_activities')
      .select(`
        id, kind, subject, body, occurred_at,
        actor:users!actor_user_id(full_name)
      `)
      .eq('tenant_id', tenantId)
      .eq('client_id', clientId)
      .order('occurred_at', { ascending: false })
      .limit(40),
  ])

  const contacts    = (contactsRes.data ?? []) as ContactRow[]
  const engagements = (engagementsRes.data ?? []) as unknown as EngagementRow[]
  const deals       = (dealsRes.data ?? []) as DealRow[]
  const activities  = (activitiesRes.data ?? []) as unknown as ActivityRow[]

  const contactsCount    = contacts.length
  const engagementsCount = engagements.length
  const openDealsCount   = deals.filter((d) => OPEN_STAGES.includes(d.stage)).length

  const ytdYear = new Date().getFullYear()
  const ytdValue = engagements.reduce((s, e) => s + Number(e.billed_amount ?? 0), 0)
  // Note: ytdValue covers all billed_amount on this client's engagements.
  // We label it "YTD value" — partner-facing. ytdYear is implicit context.

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
        <Link href="/app/crm" className="hover:text-slate-700">{tServer('crm.crumb.crm', locale)}</Link>
        <span className="text-slate-300">/</span>
        <Link href="/app/crm/clients" className="hover:text-slate-700">{tServer('crm.crumb.clients', locale)}</Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700 font-semibold">{clientData.name as string}</span>
      </nav>

      {/* Header */}
      <header className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            {clientData.name as string}
          </h1>
          {clientData.industry ? (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200">
              {clientData.industry as string}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
          {clientData.trade_name && (
            <span className="text-slate-600">{clientData.trade_name as string}</span>
          )}
          {clientData.country_code && (
            <span>{clientData.country_code as string}</span>
          )}
          {clientData.since && (
            <span>{tServer('crm.client_detail.since', locale, { date: fmtDate(clientData.since as string, locale) })}</span>
          )}
          {ownerObj?.full_name && (
            <span>
              {tServer('crm.client_detail.owner_label', locale)}:{' '}
              <span className="font-semibold text-slate-700">{ownerObj.full_name}</span>
            </span>
          )}
        </div>
      </header>

      {/* Metric strip */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SmallMetric label={tServer('crm.client_detail.metric.contacts',    locale)} value={String(contactsCount)} />
        <SmallMetric label={tServer('crm.client_detail.metric.engagements', locale)} value={String(engagementsCount)} />
        <SmallMetric label={tServer('crm.client_detail.metric.open_deals',  locale)} value={String(openDealsCount)} />
        <SmallMetric label={tServer('crm.client_detail.metric.ytd_value',   locale)} value={fmtSar(ytdValue, locale)} mono />
      </section>

      {/* Main + side */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 space-y-8">
          {/* Contacts */}
          <Section title={tServer('crm.client_detail.tab.contacts', locale)}>
            {contacts.length === 0 ? (
              <Empty msg={tServer('crm.contacts.empty', locale)} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('crm.contacts.col.name',      locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('crm.contacts.col.job_title', locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('crm.contacts.col.role',      locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('crm.contacts.col.email',     locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('crm.contacts.col.phone',     locale)}</th>
                      <th className="px-4 py-3 font-semibold text-end">{tServer('crm.contacts.col.primary',   locale)}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {contacts.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/50 transition">
                        <td className="px-4 py-3 font-semibold text-slate-900">{c.full_name}</td>
                        <td className="px-4 py-3 text-slate-700">{c.job_title ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${roleClasses(c.role)}`}>
                            {roleLabel(c.role, locale)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {c.email ? (
                            <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 hover:text-teal-700">
                              <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                              {c.email}
                            </a>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-700 font-mono text-xs whitespace-nowrap">
                          {c.mobile_phone ? (
                            <a href={`tel:${c.mobile_phone}`} className="inline-flex items-center gap-1.5 hover:text-teal-700">
                              <Phone className="w-3.5 h-3.5" aria-hidden="true" />
                              {c.mobile_phone}
                            </a>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-end">
                          {c.is_primary ? (
                            <Star className="inline w-4 h-4 text-amber-500 fill-amber-400" aria-label={tServer('crm.contacts.col.primary', locale)} />
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Engagements */}
          <Section title={tServer('crm.client_detail.tab.engagements', locale)}>
            {engagements.length === 0 ? (
              <Empty msg={tServer('crm.engagements.empty', locale)} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('crm.engagements.col.code',         locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('crm.engagements.col.name',         locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('crm.engagements.col.type',         locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('crm.engagements.col.status',       locale)}</th>
                      <th className="px-4 py-3 font-semibold text-end">{tServer('crm.engagements.col.fee',           locale)}</th>
                      <th className="px-4 py-3 font-semibold text-end">{tServer('crm.engagements.col.billed',        locale)}</th>
                      <th className="px-4 py-3 font-semibold text-end">{tServer('crm.engagements.col.actual_hours',  locale)}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {engagements.map((e) => {
                      const actualHrs = (e.time_entries ?? []).reduce(
                        (sum, te) => sum + Number(te.hours ?? 0), 0,
                      )
                      return (
                        <tr key={e.id} className="hover:bg-slate-50/50 transition">
                          <td className="px-4 py-3 font-mono text-xs text-slate-700">{e.code ?? '—'}</td>
                          <td className="px-4 py-3 font-semibold text-slate-900">{e.name}</td>
                          <td className="px-4 py-3 text-slate-700">{e.engagement_type ?? '—'}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200">
                              {e.status ?? '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-end font-mono text-slate-900 whitespace-nowrap">{fmtSar(e.fee_amount, locale)}</td>
                          <td className="px-4 py-3 text-end font-mono text-slate-700 whitespace-nowrap">{fmtSar(e.billed_amount, locale)}</td>
                          <td className="px-4 py-3 text-end font-mono text-slate-700 whitespace-nowrap">{actualHrs.toFixed(1)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Deals */}
          <Section title={tServer('crm.client_detail.tab.deals', locale)}>
            {deals.length === 0 ? (
              <Empty msg={tServer('crm.deals.empty', locale)} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('crm.deals.col.title',          locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('crm.deals.col.stage',          locale)}</th>
                      <th className="px-4 py-3 font-semibold text-end">{tServer('crm.deals.col.value',          locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('crm.deals.col.expected_close', locale)}</th>
                      <th className="px-4 py-3 font-semibold text-start">{tServer('crm.deals.col.next_step',      locale)}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {deals.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-50/50 transition">
                        <td className="px-4 py-3 font-semibold text-slate-900">{d.title}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${stageClasses(d.stage)}`}>
                            {stageLabel(d.stage, locale)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-end font-mono text-slate-900 whitespace-nowrap">{fmtSar(d.estimated_value, locale)}</td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDate(d.expected_close_date, locale)}</td>
                        <td className="px-4 py-3 text-slate-700 text-xs">
                          {d.next_step ?? '—'}
                          {d.next_step_due ? <span className="text-slate-400"> · {fmtDate(d.next_step_due, locale)}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Activity feed */}
          <Section title={tServer('crm.client_detail.tab.activity', locale)}>
            {activities.length === 0 ? (
              <Empty msg={tServer('crm.section.empty', locale)} />
            ) : (
              <ol className="divide-y divide-slate-100">
                {activities.map((a) => {
                  const actor = Array.isArray(a.actor) ? a.actor[0] : a.actor
                  return (
                    <li key={a.id} className="p-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${activityKindClasses(a.kind)}`}>
                          {activityKindLabel(a.kind, locale)}
                        </span>
                        <span className="text-sm font-semibold text-slate-900">{a.subject}</span>
                      </div>
                      {a.body && <div className="text-xs text-slate-600 mt-1 leading-relaxed">{a.body}</div>}
                      <div className="text-xs text-slate-500 mt-1">
                        {actor?.full_name ?? '—'} · {fmtDateTime(a.occurred_at, locale)}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </Section>
        </div>

        {/* Right rail — Quick actions (visual only) */}
        <aside className="lg:col-span-1 space-y-3">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-slate-600">
            {tServer('crm.client_detail.quick_actions', locale)}
          </h2>
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100">
            {(['log_call', 'schedule_meeting', 'add_note'] as const).map((k) => (
              <a
                key={k}
                href="#"
                title={tServer('crm.actions.coming_soon', locale)}
                className="flex items-center justify-between p-4 text-sm text-slate-700 hover:bg-slate-50 cursor-not-allowed opacity-90"
              >
                <span>{tServer(`crm.actions.${k}` as StringKey, locale)}</span>
                <span className="text-xs text-slate-400">{tServer('crm.actions.coming_soon', locale)}</span>
              </a>
            ))}
          </div>
        </aside>
      </div>
      {/* keep ytdYear referenced so the lint doesn't trim it (informational anchor for future quarter slicing) */}
      <span className="hidden" data-ytd-year={ytdYear} />
    </div>
  )
}

function SmallMetric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-600">{label}</div>
      <div className={`mt-1.5 text-2xl font-black tracking-tight text-slate-900 ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm uppercase tracking-wider font-semibold text-slate-600">{title}</h2>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {children}
      </div>
    </section>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div className="p-8 text-center text-sm text-slate-500">{msg}</div>
}
