import Link from 'next/link'
import { Users, Briefcase, FolderLock, ArrowRight, Globe, FileText } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { strings, t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'

export const dynamic = 'force-dynamic'

/**
 * Suite-shell landing — the user picks a module here.
 *
 * "Full Scope" was previously a single HR product (this page used to be the HR
 * dashboard). After the pivot, the suite has four modules: HR + DMS (both
 * Active) and CRM + Accounting (Preview placeholders). HR lives at /app/hr,
 * DMS at /app/dms.
 *
 * Stats on the HR + DMS tiles are computed live from the tenant's data.
 */

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

export default async function AppPickerPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, full_name, locale, dsb_role, tenants(name)')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) return null

  const tenantId = profile.tenant_id as string
  const userId = profile.id as string
  const locale = ((profile.locale as Locale) ?? 'ar')
  const tenant = Array.isArray(profile.tenants) ? profile.tenants[0] : profile.tenants
  const tenantName = (tenant?.name as string) ?? '—'
  const fullName = (profile.full_name as string | null) ?? user.email ?? ''
  const dsbRole = (profile.dsb_role as 'employee' | 'supervisor' | 'owner' | 'developer' | null) ?? null

  // Live stats for the HR + DMS + CRM + Disbursements tiles + Portal banner.
  // Disbursements inbox status depends on the caller's dsb_role.
  const dsbInboxStatus =
    dsbRole === 'employee'   ? 'with_employee'   :
    dsbRole === 'supervisor' ? 'with_supervisor' :
    dsbRole === 'owner'      ? 'with_owner'      :
    null

  const [employeesRes, jobsRes, empCertsRes, firmCertsRes, pendingAppsRes, dmsDocsRes, dmsClientsRes, crmDealsRes, portalInvitesRes, portalLastLoginRes, dsbInboxRes, dsbActiveRes, dsbSignedRes] = await Promise.all([
    svc
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('active', true),
    svc
      .from('job_requisitions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'open'),
    svc
      .from('employee_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['expiring_soon', 'expired']),
    svc
      .from('firm_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['expiring_soon', 'expired']),
    svc
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['applied', 'in_review']),
    svc
      .from('dms_documents')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),
    svc
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'active'),
    svc
      .from('crm_deals')
      .select('stage, estimated_value')
      .eq('tenant_id', tenantId),
    svc
      .from('portal_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('active', true),
    svc
      .from('portal_access_log')
      .select('occurred_at')
      .eq('tenant_id', tenantId)
      .eq('action', 'login')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Disbursements inbox count — scoped to caller's role.
    dsbInboxStatus
      ? (dsbRole === 'employee'
          ? svc
              .from('dsb_cases')
              .select('id, project:dsb_projects!dsb_cases_project_id_fkey(assigned_employee_id)')
              .eq('tenant_id', tenantId)
              .eq('status', dsbInboxStatus)
          : svc
              .from('dsb_cases')
              .select('id', { count: 'exact', head: true })
              .eq('tenant_id', tenantId)
              .eq('status', dsbInboxStatus))
      : Promise.resolve({ data: null, count: 0, error: null } as { data: unknown; count: number | null; error: unknown }),
    svc
      .from('dsb_cases')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['with_employee', 'with_supervisor', 'with_owner']),
    svc
      .from('dsb_cases')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'signed'),
  ])

  const employees = employeesRes.count ?? 0
  const jobs      = jobsRes.count ?? 0
  const certs     = (empCertsRes.count ?? 0) + (firmCertsRes.count ?? 0)
  const pending   = pendingAppsRes.count ?? 0
  const dmsDocs    = dmsDocsRes.count ?? 0
  const dmsClients = dmsClientsRes.count ?? 0

  // CRM tile stats — clients (reuse dmsClients count, same `clients` table) +
  // open deals + pipeline value (sum of estimated_value over open stages).
  type DealMini = { stage: string; estimated_value: number | null }
  const crmDeals = (crmDealsRes.data ?? []) as DealMini[]
  const OPEN = new Set(['lead', 'qualified', 'proposal', 'negotiation', 'on_hold'])
  const crmOpenDeals = crmDeals.filter((d) => OPEN.has(d.stage)).length
  const crmPipelineValue = crmDeals
    .filter((d) => OPEN.has(d.stage))
    .reduce((s, d) => s + Number(d.estimated_value ?? 0), 0)
  const crmClients = dmsClients
  const crmPipelineFormatted = (() => {
    try {
      return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
        style: 'currency', currency: 'SAR', maximumFractionDigits: 0,
      }).format(crmPipelineValue)
    } catch {
      return `${crmPipelineValue.toLocaleString()} SAR`
    }
  })()

  // Disbursements tile stats
  type DsbInboxProjectRow = { id: string; project: { assigned_employee_id: string | null } | { assigned_employee_id: string | null }[] | null }
  let dsbInboxCount = 0
  if (dsbRole === 'employee') {
    const rows = ((dsbInboxRes as { data: DsbInboxProjectRow[] | null }).data ?? [])
    dsbInboxCount = rows.filter((r) => {
      const p = Array.isArray(r.project) ? r.project[0] : r.project
      return p?.assigned_employee_id === userId
    }).length
  } else {
    dsbInboxCount = (dsbInboxRes as { count: number | null }).count ?? 0
  }
  const dsbActiveCount = (dsbActiveRes as { count: number | null }).count ?? 0
  const dsbSignedCount = (dsbSignedRes as { count: number | null }).count ?? 0

  // Client Portal banner — surface invited count + most recent client login.
  const portalInvitedCount = portalInvitesRes.count ?? 0
  const portalLastLoginIso = (portalLastLoginRes.data as { occurred_at: string } | null)?.occurred_at ?? null
  const portalLastLoginFormatted = portalLastLoginIso
    ? (() => {
        try {
          return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
            day: 'numeric', month: 'short', year: 'numeric',
          }).format(new Date(portalLastLoginIso))
        } catch {
          return portalLastLoginIso.slice(0, 10)
        }
      })()
    : (locale === 'ar' ? '—' : 'never')

  return (
    <div className="space-y-10 max-w-6xl mx-auto">
      {/* Welcome header */}
      <header className="space-y-3">
        <h1 className="serif font-black text-4xl tracking-tight text-slate-900">
          {tServer('app.welcome', locale)}
        </h1>
        <p className="text-base text-slate-600 max-w-2xl">
          {tServer('app.welcome_subtitle', locale)}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
          <span>
            <span className="text-slate-400">{tServer('app.signed_in_as', locale)}:</span>{' '}
            <span className="font-semibold text-slate-700">{fullName}</span>
          </span>
          <span className="text-slate-300">·</span>
          <span>
            <span className="text-slate-400">{tServer('app.firm_label', locale)}:</span>{' '}
            <span className="font-semibold text-slate-700">{tenantName}</span>
          </span>
        </div>
      </header>

      {/* Module tiles — 2x2 on md, 4-up on lg. Active modules on top row. */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* HR tile — active, navigates into the HR module */}
        <Link
          href="/app/hr"
          className="group block bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md hover:border-teal-300 transition"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-teal-50">
              <Users className="w-6 h-6 text-teal-600" aria-hidden="true" />
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 ring-1 ring-inset ring-green-200">
              {tServer('app.module.status.active', locale)}
            </span>
          </div>
          <h2 className="serif font-bold text-xl text-slate-900 mb-1.5">
            {tServer('app.module.hr.title', locale)}
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            {tServer('app.module.hr.description', locale)}
          </p>
          <div className="text-xs text-slate-500 font-mono mb-4 min-h-[1.25rem]">
            {tServer('app.module.hr.stats', locale, { employees, jobs, certs })}
          </div>
          <div className="inline-flex items-center text-sm font-semibold text-teal-600 group-hover:text-teal-700">
            {tServer('app.module.hr.title', locale)}
            <ArrowRight className="w-4 h-4 ms-1.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
          </div>
        </Link>

        {/* DMS tile — active, navigates into the Documents module */}
        <Link
          href="/app/dms"
          className="group block bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md hover:border-teal-300 transition"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-teal-50">
              <FolderLock className="w-6 h-6 text-teal-600" aria-hidden="true" />
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 ring-1 ring-inset ring-green-200">
              {tServer('app.module.status.active', locale)}
            </span>
          </div>
          <h2 className="serif font-bold text-xl text-slate-900 mb-1.5">
            {tServer('app.module.dms.title', locale)}
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            {tServer('app.module.dms.description', locale)}
          </p>
          <div className="text-xs text-slate-500 font-mono mb-4 min-h-[1.25rem]">
            {tServer('app.module.dms.stats', locale, { docs: dmsDocs, clients: dmsClients })}
          </div>
          <div className="inline-flex items-center text-sm font-semibold text-teal-600 group-hover:text-teal-700">
            {tServer('app.module.dms.title', locale)}
            <ArrowRight className="w-4 h-4 ms-1.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
          </div>
        </Link>

        {/* CRM tile — active */}
        <Link
          href="/app/crm"
          className="group block bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md hover:border-teal-300 transition"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-teal-50">
              <Briefcase className="w-6 h-6 text-teal-600" aria-hidden="true" />
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 ring-1 ring-inset ring-green-200">
              {tServer('app.module.status.active', locale)}
            </span>
          </div>
          <h2 className="serif font-bold text-xl text-slate-900 mb-1.5">
            {tServer('app.module.crm.title', locale)}
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            {tServer('app.module.crm.description', locale)}
          </p>
          <div className="text-xs text-slate-500 font-mono mb-4 min-h-[1.25rem]">
            {tServer('app.module.crm.stats', locale, {
              clients: crmClients,
              open_deals: crmOpenDeals,
              pipeline_value: crmPipelineFormatted,
            })}
          </div>
          <div className="inline-flex items-center text-sm font-semibold text-teal-600 group-hover:text-teal-700">
            {tServer('app.module.crm.title', locale)}
            <ArrowRight className="w-4 h-4 ms-1.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
          </div>
        </Link>

        {/* Disbursements (الصرف) tile — active. Replaces the previous Escrow Control tile. */}
        <Link
          href="/app/disbursements?tab=mine"
          className="group block bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md hover:border-teal-300 transition"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-teal-50">
              <FileText className="w-6 h-6 text-teal-600" aria-hidden="true" />
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 ring-1 ring-inset ring-green-200">
              {tServer('app.module.status.active', locale)}
            </span>
          </div>
          <h2 className="serif font-bold text-xl text-slate-900 mb-1.5">
            {tServer('app.module.dsb.title', locale)}
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            {tServer('app.module.dsb.description', locale)}
          </p>
          <div className="text-xs text-slate-500 font-mono mb-4 min-h-[1.25rem]">
            {tServer('app.module.dsb.stats', locale, {
              inbox: dsbInboxCount,
              active: dsbActiveCount,
              signed: dsbSignedCount,
            })}
          </div>
          <div className="inline-flex items-center text-sm font-semibold text-teal-600 group-hover:text-teal-700">
            {tServer('app.module.dsb.title', locale)}
            <ArrowRight className="w-4 h-4 ms-1.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
          </div>
        </Link>
      </section>

      {/* Client Portal banner — promotes the separate /portal experience.
          Distinct visual treatment from the module tiles so it reads as
          a "secondary surface for your customers", not another firm app. */}
      <section>
        <Link
          href="/portal"
          className="group flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-xl p-5 shadow-sm hover:shadow-md transition"
        >
          <div className="flex items-start gap-4 min-w-0">
            <div className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-white/10 ring-1 ring-inset ring-white/20 shrink-0">
              <Globe className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold mb-1">
                {tServer('app.portal_banner.title', locale)}
              </div>
              <div className="text-xs text-slate-300">
                {tServer('app.portal_banner.body', locale, {
                  invited: portalInvitedCount,
                  date: portalLastLoginFormatted,
                })}
              </div>
            </div>
          </div>
          <div className="inline-flex items-center text-sm font-semibold text-teal-300 group-hover:text-teal-200 shrink-0">
            {tServer('app.portal_banner.cta', locale)}
            <ArrowRight className="w-4 h-4 ms-1.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
          </div>
        </Link>
      </section>

      {/* Recently used / quick links into HR */}
      {(pending > 0 || certs > 0) && (
        <section className="space-y-3">
          <h3 className="text-xs uppercase tracking-wider font-semibold text-slate-500">
            {strings['app.recently_used.title'][locale]}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {pending > 0 && (
              <Link
                href="/app/hr/applications"
                className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition"
              >
                <span className="text-sm text-slate-700">
                  {tServer('app.recently_used.review_apps', locale, { n: pending })}
                </span>
                <ArrowRight className="w-4 h-4 text-slate-400" aria-hidden="true" />
              </Link>
            )}
            {certs > 0 && (
              <Link
                href="/app/hr/certs"
                className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition"
              >
                <span className="text-sm text-slate-700">
                  {tServer('app.recently_used.expiring_certs', locale, { n: certs })}
                </span>
                <ArrowRight className="w-4 h-4 text-slate-400" aria-hidden="true" />
              </Link>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
