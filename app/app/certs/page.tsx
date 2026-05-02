import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'

export const dynamic = 'force-dynamic'

// ---------- types ----------
type CertStatus =
  | 'active'
  | 'expiring_soon'
  | 'expired'
  | 'renewed'
  | 'revoked'
  | 'pending_verification'

type EmployeeJoin = {
  legal_first_name: string | null
  legal_last_name: string | null
  preferred_name: string | null
  job_title: string | null
}

type EmployeeCredentialRow = {
  id: string
  credential_type: string | null
  holder_role: string | null
  issuing_authority: string | null
  jurisdiction: string | null
  issued_on: string | null
  expires_on: string | null
  status: CertStatus | null
  employees: EmployeeJoin | EmployeeJoin[] | null
}

type FirmCredentialRow = {
  id: string
  credential_type: string | null
  issuing_authority: string | null
  jurisdiction: string | null
  issued_on: string | null
  expires_on: string | null
  status: CertStatus | null
}

// ---------- helpers ----------
function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const target = new Date(dateStr + 'T00:00:00Z')
  const today = new Date()
  // Normalize to UTC midnight
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const targetUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate())
  return Math.round((targetUtc - todayUtc) / (1000 * 60 * 60 * 24))
}

type Urgency = 'red' | 'amber' | 'yellow' | 'green'

function urgencyOf(daysLeft: number | null, status: CertStatus | null): Urgency {
  if (status === 'expired' || status === 'revoked') return 'red'
  if (daysLeft === null) return 'green'
  if (daysLeft < 30) return 'red'
  if (daysLeft < 60) return 'amber'
  if (daysLeft < 180) return 'yellow'
  return 'green'
}

function chipClasses(u: Urgency): string {
  switch (u) {
    case 'red':    return 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200'
    case 'amber':  return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200'
    case 'yellow': return 'bg-yellow-50 text-yellow-800 ring-1 ring-inset ring-yellow-200'
    case 'green':  return 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-200'
  }
}

function formatDate(dateStr: string | null, locale: Locale): string {
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

function statusLabel(status: CertStatus | null, locale: Locale): string {
  const s = status ?? 'pending_verification'
  return tServer(`certs.status.${s}` as StringKey, locale)
}

function daysLabel(daysLeft: number | null, locale: Locale): string {
  if (daysLeft === null) return '—'
  if (daysLeft < 0) return tServer('certs.days.expired_n', locale, { n: Math.abs(daysLeft) })
  return tServer('certs.days.in_n', locale, { n: daysLeft })
}

// ---------- page ----------
export default async function CertsPage() {
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

  const [empRes, firmRes] = await Promise.all([
    svc
      .from('employee_credentials')
      .select(`
        id, credential_type, holder_role, issuing_authority, jurisdiction,
        issued_on, expires_on, status,
        employees(legal_first_name, legal_last_name, preferred_name, job_title)
      `)
      .eq('tenant_id', tenantId)
      .order('expires_on', { ascending: true, nullsFirst: false }),
    svc
      .from('firm_credentials')
      .select(`
        id, credential_type, issuing_authority, jurisdiction,
        issued_on, expires_on, status
      `)
      .eq('tenant_id', tenantId)
      .order('expires_on', { ascending: true, nullsFirst: false }),
  ])

  if (empRes.error) console.error('[certs] employee_credentials', empRes.error)
  if (firmRes.error) console.error('[certs] firm_credentials', firmRes.error)

  const empRows = (empRes.data ?? []) as EmployeeCredentialRow[]
  const firmRows = (firmRes.data ?? []) as FirmCredentialRow[]

  // Aggregate metrics — counts span both employee + firm credentials.
  const allDays = [
    ...empRows.map((r) => ({ d: daysUntil(r.expires_on), s: r.status })),
    ...firmRows.map((r) => ({ d: daysUntil(r.expires_on), s: r.status })),
  ]
  const expiring30 = allDays.filter((x) => x.s !== 'expired' && x.s !== 'revoked' && x.d !== null && x.d >= 0 && x.d < 30).length
  const expiring60 = allDays.filter((x) => x.s !== 'expired' && x.s !== 'revoked' && x.d !== null && x.d >= 30 && x.d < 60).length
  const activeCount = allDays.filter((x) => x.s === 'active' && (x.d === null || x.d >= 60)).length

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          {tServer('certs.title', locale)}
        </h1>
        <p className="text-sm text-slate-500 max-w-2xl">
          {tServer('certs.subtitle', locale)}
        </p>
      </header>

      {/* Metric cards */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          tone="red"
          label={tServer('certs.expiring_30', locale)}
          value={expiring30}
        />
        <MetricCard
          tone="amber"
          label={tServer('certs.expiring_60', locale)}
          value={expiring60}
        />
        <MetricCard
          tone="green"
          label={tServer('certs.active', locale)}
          value={activeCount}
        />
      </section>

      {/* Employee Credentials */}
      <section className="space-y-3">
        <h2 className="serif font-bold text-xl text-slate-900">
          {tServer('certs.section.employee', locale)}
        </h2>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          {empRows.length === 0 ? (
            <div className="p-10 text-center text-slate-500 text-sm">
              {tServer('certs.section.empty', locale)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('certs.col.holder',       locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('certs.col.credential',   locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('certs.col.authority',    locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('certs.col.jurisdiction', locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('certs.col.issued',       locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('certs.col.expires',      locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('certs.col.days_until',   locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('certs.col.status',       locale)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {empRows.map((r) => {
                    const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
                    const fullName = emp?.preferred_name
                      ?? [emp?.legal_first_name, emp?.legal_last_name].filter(Boolean).join(' ')
                      ?? '—'
                    const subRole = r.holder_role ?? emp?.job_title ?? '—'
                    const days = daysUntil(r.expires_on)
                    const u = urgencyOf(days, r.status)
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/50 transition">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{fullName || '—'}</div>
                          <div className="text-xs text-slate-500">{subRole}</div>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">{r.credential_type ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-700">{r.issuing_authority ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-700">{r.jurisdiction ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{formatDate(r.issued_on, locale)}</td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{formatDate(r.expires_on, locale)}</td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{daysLabel(days, locale)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${chipClasses(u)}`}>
                            {statusLabel(r.status, locale)}
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

      {/* Firm Credentials */}
      <section className="space-y-3">
        <h2 className="serif font-bold text-xl text-slate-900">
          {tServer('certs.section.firm', locale)}
        </h2>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          {firmRows.length === 0 ? (
            <div className="p-10 text-center text-slate-500 text-sm">
              {tServer('certs.section.empty', locale)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('certs.col.credential',   locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('certs.col.authority',    locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('certs.col.jurisdiction', locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('certs.col.issued',       locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('certs.col.expires',      locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('certs.col.days_until',   locale)}</th>
                    <th className="px-4 py-3 font-semibold text-start">{tServer('certs.col.status',       locale)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {firmRows.map((r) => {
                    const days = daysUntil(r.expires_on)
                    const u = urgencyOf(days, r.status)
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/50 transition">
                        <td className="px-4 py-3 font-semibold text-slate-900">{r.credential_type ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-700">{r.issuing_authority ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-700">{r.jurisdiction ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{formatDate(r.issued_on, locale)}</td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{formatDate(r.expires_on, locale)}</td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{daysLabel(days, locale)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${chipClasses(u)}`}>
                            {statusLabel(r.status, locale)}
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
    </div>
  )
}

// ---------- subcomponents ----------
function MetricCard({
  tone, label, value,
}: {
  tone: 'red' | 'amber' | 'green'
  label: string
  value: number
}) {
  const palette = {
    red:   { bg: 'bg-red-50',   border: 'border-red-100',   value: 'text-red-700',   label: 'text-red-900/70' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-100', value: 'text-amber-700', label: 'text-amber-900/70' },
    green: { bg: 'bg-green-50', border: 'border-green-100', value: 'text-green-700', label: 'text-green-900/70' },
  }[tone]
  return (
    <div className={`rounded-xl border ${palette.border} ${palette.bg} p-5 shadow-sm`}>
      <div className={`text-xs font-semibold uppercase tracking-wider ${palette.label}`}>
        {label}
      </div>
      <div className={`mt-2 text-4xl font-black tracking-tight ${palette.value}`}>
        {value}
      </div>
    </div>
  )
}
