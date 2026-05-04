import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'

export const dynamic = 'force-dynamic'

// ---------- types ----------
type EngagementStatus = 'planned' | 'active' | 'closed'

type ClientJoin = {
  id: string
  name: string | null
  trade_name: string | null
  legal_name: string | null
}

type TimeEntryJoin = {
  hours: number | null
  billable: boolean | null
}

type EngagementRow = {
  id: string
  code: string | null
  name: string | null
  status: EngagementStatus | null
  engagement_type: string | null
  budget_hours: number | null
  fee_amount: number | null
  fee_currency: string | null
  billed_amount: number | null
  collected_amount: number | null
  end_date: string | null
  clients: ClientJoin | ClientJoin[] | null
  time_entries: TimeEntryJoin[] | null
}

type RecruitingRow = {
  source: string | null
  application_count: number | null
  hire_count: number | null
  avg_time_to_hire_days: number | null
}

type FirmExpenseRow = {
  id: string
  category: string | null
  vendor: string | null
  description: string | null
  amount: number | null
  currency: string | null
  expense_date: string | null
  recurring: string | null
}

// ---------- helpers ----------
function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

function fmtCurrency(amount: number, locale: Locale, currency = 'SAR'): string {
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${amount.toLocaleString()} ${currency}`
  }
}

function fmtPercent(pct: number, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(pct)
  } catch {
    return `${(pct * 100).toFixed(1)}%`
  }
}

function fmtNumber(n: number, locale: Locale, digits = 0): string {
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(n)
  } catch {
    return n.toFixed(digits)
  }
}

function fmtDate(dateStr: string | null, locale: Locale): string {
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

type VarianceTone = 'green' | 'yellow' | 'red'

function varianceTone(actual: number, budget: number): VarianceTone {
  if (!budget) return 'green'
  const pct = actual / budget
  if (pct > 1.15) return 'red'
  if (pct > 1.0)  return 'yellow'
  return 'green'
}

function tonePill(tone: VarianceTone): string {
  switch (tone) {
    case 'red':    return 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200'
    case 'yellow': return 'bg-yellow-50 text-yellow-800 ring-1 ring-inset ring-yellow-200'
    case 'green':  return 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-200'
  }
}

function statusPill(status: EngagementStatus | null): string {
  switch (status) {
    case 'active':  return 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200'
    case 'closed':  return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
    case 'planned': return 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
    default:        return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
  }
}

function statusLabel(status: EngagementStatus | null, locale: Locale): string {
  if (status === 'active')  return tServer('costs.engagements.status.active',  locale)
  if (status === 'closed')  return tServer('costs.engagements.status.closed',  locale)
  if (status === 'planned') return tServer('costs.engagements.status.planned', locale)
  return '—'
}

function sourceLabel(source: string | null, locale: Locale): string {
  if (!source) return '—'
  const key = `form.source.${source}` as StringKey
  const s = tFn(key, locale)
  if (s === key) return source.replace(/_/g, ' ')
  return s
}

// ---------- page ----------
export default async function CostsPage() {
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

  const now = new Date()
  const yearStart = new Date(now.getFullYear(), 0, 1)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const yearStartIso  = yearStart.toISOString().slice(0, 10)
  const monthStartIso = monthStart.toISOString().slice(0, 10)
  const thirtyDaysAgoIso = thirtyDaysAgo.toISOString().slice(0, 10)

  const [engRes, recruitingRes, expensesRes, appsLast90Res] = await Promise.all([
    svc
      .from('engagements')
      .select(`
        id, code, name, status, engagement_type,
        budget_hours, fee_amount, fee_currency,
        billed_amount, collected_amount, end_date,
        clients(id, name, trade_name, legal_name),
        time_entries(hours, billable)
      `)
      .eq('tenant_id', tenantId)
      .order('end_date', { ascending: true, nullsFirst: false }),
    svc
      .from('recruiting_costs_v')
      .select('source, application_count, hire_count, avg_time_to_hire_days')
      .eq('tenant_id', tenantId),
    svc
      .from('firm_expenses')
      .select('id, category, vendor, description, amount, currency, expense_date, recurring')
      .eq('tenant_id', tenantId)
      .gte('expense_date', yearStartIso)
      .order('expense_date', { ascending: false }),
    svc
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('applied_at', ninetyDaysAgo.toISOString()),
  ])

  if (engRes.error)        console.error('[costs] engagements',         engRes.error)
  if (recruitingRes.error) console.error('[costs] recruiting_costs_v',  recruitingRes.error)
  if (expensesRes.error)   console.error('[costs] firm_expenses',       expensesRes.error)

  const engagements = (engRes.data ?? []) as unknown as EngagementRow[]
  const recruiting  = (recruitingRes.data ?? []) as unknown as RecruitingRow[]
  const expenses    = (expensesRes.data ?? []) as unknown as FirmExpenseRow[]

  // Section 1: engagement profitability
  const yearNow = now.getFullYear()
  const ytdEng = engagements.filter((e) => {
    if (e.status !== 'active' && e.status !== 'closed') return false
    if (!e.end_date) return false
    return e.end_date >= yearStartIso && new Date(e.end_date).getUTCFullYear() === yearNow
  })
  const totalBilledYtd    = ytdEng.reduce((s, e) => s + Number(e.billed_amount ?? 0), 0)
  const totalCollectedYtd = ytdEng.reduce((s, e) => s + Number(e.collected_amount ?? 0), 0)

  const closedYtd = ytdEng.filter((e) => e.status === 'closed')
  const closedFee       = closedYtd.reduce((s, e) => s + Number(e.fee_amount ?? 0), 0)
  const closedCollected = closedYtd.reduce((s, e) => s + Number(e.collected_amount ?? 0), 0)
  const marginPct = closedFee > 0 ? closedCollected / closedFee : 0

  type EngDisplay = {
    row: EngagementRow
    clientName: string
    actualHours: number
    variancePct: number
    deltaHours: number
    tone: VarianceTone
  }

  const engRows: EngDisplay[] = engagements.map((r) => {
    const client = Array.isArray(r.clients) ? r.clients[0] : r.clients
    const clientName = client?.trade_name ?? client?.name ?? client?.legal_name ?? '—'
    const actualHours = (r.time_entries ?? []).reduce((s, te) => s + Number(te.hours ?? 0), 0)
    const budget = Number(r.budget_hours ?? 0)
    const variancePct = budget > 0 ? actualHours / budget : 0
    const deltaHours = actualHours - budget
    const tone = varianceTone(actualHours, budget)
    return { row: r, clientName, actualHours, variancePct, deltaHours, tone }
  })

  engRows.sort((a, b) => {
    const aActive = a.row.status === 'active' ? 0 : 1
    const bActive = b.row.status === 'active' ? 0 : 1
    if (aActive !== bActive) return aActive - bActive
    return b.variancePct - a.variancePct
  })

  // Section 2: recruiting
  const totalApps90 = appsLast90Res.count ?? 0
  const totalApps   = recruiting.reduce((s, r) => s + Number(r.application_count ?? 0), 0)
  const totalHires  = recruiting.reduce((s, r) => s + Number(r.hire_count ?? 0), 0)
  const hireRate    = totalApps > 0 ? totalHires / totalApps : 0
  let weightedTtfNum = 0
  let weightedTtfDen = 0
  for (const r of recruiting) {
    const hires = Number(r.hire_count ?? 0)
    const ttf   = Number(r.avg_time_to_hire_days ?? 0)
    if (hires > 0 && ttf > 0) {
      weightedTtfNum += hires * ttf
      weightedTtfDen += hires
    }
  }
  const avgTtfDays = weightedTtfDen > 0 ? weightedTtfNum / weightedTtfDen : 0

  // Section 3: firm overhead
  const monthlySaas = expenses
    .filter((e) => e.category === 'SaaS' && e.recurring === 'monthly' && (e.expense_date ?? '') >= monthStartIso)
    .reduce((s, e) => s + Number(e.amount ?? 0), 0)

  const thisMonthTotal = expenses
    .filter((e) => (e.expense_date ?? '') >= monthStartIso)
    .reduce((s, e) => s + Number(e.amount ?? 0), 0)

  const ytdTotal = expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0)

  const thisMonthExpenses = expenses.filter((e) => (e.expense_date ?? '') >= monthStartIso)
  const byCategoryMap = new Map<string, number>()
  for (const e of thisMonthExpenses) {
    const cat = e.category ?? 'Other'
    byCategoryMap.set(cat, (byCategoryMap.get(cat) ?? 0) + Number(e.amount ?? 0))
  }
  const byCategory = Array.from(byCategoryMap.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
  const byCategoryMax = byCategory.reduce((m, x) => Math.max(m, x.amount), 0)

  const recentExpenses = expenses
    .filter((e) => (e.expense_date ?? '') >= thirtyDaysAgoIso)
    .slice(0, 8)

  return (
    <div className="space-y-12">
      <header className="space-y-2">
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          {tServer('costs.title', locale)}
        </h1>
        <p className="text-sm text-slate-500 max-w-2xl">
          {tServer('costs.subtitle', locale)}
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="serif font-bold text-xl text-slate-900">
          {tServer('costs.engagements.title', locale)}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            label={tServer('costs.engagements.metric.billed_ytd', locale)}
            value={fmtCurrency(totalBilledYtd, locale)}
          />
          <MetricCard
            label={tServer('costs.engagements.metric.collected_ytd', locale)}
            value={fmtCurrency(totalCollectedYtd, locale)}
          />
          <MetricCard
            label={tServer('costs.engagements.metric.margin', locale)}
            value={fmtPercent(marginPct, locale)}
          />
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {engRows.length === 0 ? (
            <div className="p-10 text-center text-slate-500 text-sm">
              {tServer('costs.engagements.empty', locale)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('costs.engagements.col.code',      locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('costs.engagements.col.client',    locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('costs.engagements.col.type',      locale)}</th>
                    <th className="px-4 py-3 font-semibold text-end">{tServer('costs.engagements.col.budget',     locale)}</th>
                    <th className="px-4 py-3 font-semibold text-end">{tServer('costs.engagements.col.actual',     locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('costs.engagements.col.variance',  locale)}</th>
                    <th className="px-4 py-3 font-semibold text-end">{tServer('costs.engagements.col.fee',        locale)}</th>
                    <th className="px-4 py-3 font-semibold text-end">{tServer('costs.engagements.col.billed',     locale)}</th>
                    <th className="px-4 py-3 font-semibold text-end">{tServer('costs.engagements.col.collected',  locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('costs.engagements.col.status',    locale)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {engRows.map(({ row, clientName, actualHours, variancePct, deltaHours, tone }) => {
                    const fee       = Number(row.fee_amount ?? 0)
                    const billed    = Number(row.billed_amount ?? 0)
                    const collected = Number(row.collected_amount ?? 0)
                    const currency  = row.fee_currency ?? 'SAR'
                    const deltaSign = deltaHours >= 0 ? '+' : '−'
                    const deltaAbs  = Math.abs(deltaHours)
                    return (
                      <tr key={row.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 font-mono text-xs text-slate-700 whitespace-nowrap">{row.code ?? '—'}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{clientName}</div>
                          <div className="text-xs text-slate-500">{row.name ?? ''}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{row.engagement_type ?? '—'}</td>
                        <td className="px-4 py-3 font-mono text-end text-slate-700 whitespace-nowrap">
                          {fmtNumber(Number(row.budget_hours ?? 0), locale, 0)}
                        </td>
                        <td className="px-4 py-3 font-mono text-end text-slate-900 whitespace-nowrap">
                          {fmtNumber(actualHours, locale, 0)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${tonePill(tone)}`}>
                            {fmtPercent(variancePct, locale)}
                            <span className="ms-1.5 opacity-75 font-mono">
                              ({deltaSign}{fmtNumber(deltaAbs, locale, 0)}h)
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-end text-slate-700 whitespace-nowrap">
                          {fmtCurrency(fee, locale, currency)}
                        </td>
                        <td className="px-4 py-3 font-mono text-end text-slate-700 whitespace-nowrap">
                          {fmtCurrency(billed, locale, currency)}
                        </td>
                        <td className="px-4 py-3 font-mono text-end text-slate-700 whitespace-nowrap">
                          {fmtCurrency(collected, locale, currency)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusPill(row.status)}`}>
                            {statusLabel(row.status, locale)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="serif font-bold text-xl text-slate-900">
          {tServer('costs.recruiting.title', locale)}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            label={tServer('costs.recruiting.metric.avg_ttf', locale)}
            value={avgTtfDays > 0
              ? `${fmtNumber(avgTtfDays, locale, 1)} ${tServer('costs.recruiting.metric.days', locale)}`
              : '—'}
          />
          <MetricCard
            label={tServer('costs.recruiting.metric.applications_90d', locale)}
            value={fmtNumber(totalApps90, locale, 0)}
          />
          <MetricCard
            label={tServer('costs.recruiting.metric.hire_rate', locale)}
            value={fmtPercent(hireRate, locale)}
          />
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {recruiting.length === 0 ? (
            <div className="p-10 text-center text-slate-500 text-sm">
              {tServer('costs.recruiting.empty', locale)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('costs.recruiting.col.source',       locale)}</th>
                    <th className="px-4 py-3 font-semibold text-end">{tServer('costs.recruiting.col.applications', locale)}</th>
                    <th className="px-4 py-3 font-semibold text-end">{tServer('costs.recruiting.col.hires',        locale)}</th>
                    <th className="px-4 py-3 font-semibold text-end">{tServer('costs.recruiting.col.hire_rate',    locale)}</th>
                    <th className="px-4 py-3 font-semibold text-end">{tServer('costs.recruiting.col.avg_ttf',      locale)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recruiting.map((r) => {
                    const apps  = Number(r.application_count ?? 0)
                    const hires = Number(r.hire_count ?? 0)
                    const rate  = apps > 0 ? hires / apps : 0
                    const ttf   = Number(r.avg_time_to_hire_days ?? 0)
                    return (
                      <tr key={r.source ?? 'unknown'} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 font-semibold text-slate-900">{sourceLabel(r.source, locale)}</td>
                        <td className="px-4 py-3 font-mono text-end text-slate-700">{fmtNumber(apps, locale, 0)}</td>
                        <td className="px-4 py-3 font-mono text-end text-slate-700">{hires > 0 ? fmtNumber(hires, locale, 0) : '—'}</td>
                        <td className="px-4 py-3 font-mono text-end text-slate-700">{hires > 0 ? fmtPercent(rate, locale) : '—'}</td>
                        <td className="px-4 py-3 font-mono text-end text-slate-700">
                          {ttf > 0 ? `${fmtNumber(ttf, locale, 1)} ${tServer('costs.recruiting.metric.days', locale)}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="serif font-bold text-xl text-slate-900">
          {tServer('costs.overhead.title', locale)}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            label={tServer('costs.overhead.metric.monthly_saas', locale)}
            value={fmtCurrency(monthlySaas, locale)}
          />
          <MetricCard
            label={tServer('costs.overhead.metric.this_month', locale)}
            value={fmtCurrency(thisMonthTotal, locale)}
          />
          <MetricCard
            label={tServer('costs.overhead.metric.ytd', locale)}
            value={fmtCurrency(ytdTotal, locale)}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white border border-slate-200 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">
              {tServer('costs.overhead.section.by_category', locale)}
            </h3>
            {byCategory.length === 0 ? (
              <div className="text-sm text-slate-500">
                {tServer('costs.overhead.empty', locale)}
              </div>
            ) : (
              <div className="space-y-3">
                {byCategory.map(({ category, amount }) => {
                  const widthPct = byCategoryMax > 0 ? (amount / byCategoryMax) * 100 : 0
                  return (
                    <div key={category}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-slate-700">{category}</span>
                        <span className="font-mono text-slate-900 font-semibold">
                          {fmtCurrency(amount, locale)}
                        </span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-teal-500 rounded-full"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">
              {tServer('costs.overhead.section.recent', locale)}
            </h3>
            {recentExpenses.length === 0 ? (
              <div className="text-sm text-slate-500">
                {tServer('costs.overhead.empty', locale)}
              </div>
            ) : (
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-2 py-2 font-semibold text-start">{tServer('costs.overhead.col.date',     locale)}</th>
                      <th className="px-2 py-2 font-semibold text-start">{tServer('costs.overhead.col.vendor',   locale)}</th>
                      <th className="px-2 py-2 font-semibold text-start">{tServer('costs.overhead.col.category', locale)}</th>
                      <th className="px-2 py-2 font-semibold text-end">{tServer('costs.overhead.col.amount',   locale)}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentExpenses.map((e) => (
                      <tr key={e.id}>
                        <td className="px-2 py-2 text-slate-700 whitespace-nowrap">{fmtDate(e.expense_date, locale)}</td>
                        <td className="px-2 py-2">
                          <div className="font-medium text-slate-900 truncate">{e.vendor ?? '—'}</div>
                          {e.description && (
                            <div className="text-xs text-slate-500 truncate">{e.description}</div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-slate-700">{e.category ?? '—'}</td>
                        <td className="px-2 py-2 font-mono text-end text-slate-900 whitespace-nowrap">
                          {fmtCurrency(Number(e.amount ?? 0), locale, e.currency ?? 'SAR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6">
      <div className="text-xs uppercase tracking-wider text-slate-600 font-semibold">
        {label}
      </div>
      <div className="mt-2 text-3xl font-black tracking-tight text-slate-900 font-mono">
        {value}
      </div>
    </div>
  )
}
