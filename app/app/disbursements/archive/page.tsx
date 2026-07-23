import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { Archive } from 'lucide-react'
import { CaseFiltersBar } from '../CaseFiltersBar'
import { EditableArchiveRow } from './EditableArchiveRow'

/**
 * Archive — all cases with status = 'delivered'.
 *
 * Delivery is the terminal state in the workflow: once a signed case has
 * been handed off to the recipient, it leaves every other view (dashboard
 * kanban, board, documents register) and lives only here. Filters mirror
 * the dashboard/register so the user can slice by client / project /
 * employee / date.
 *
 * Date filters target `delivered_at` (when archival happened) since that's
 * the only timestamp that matters in this context.
 */

export const dynamic = 'force-dynamic'

function fmtSar(amount: number | null): string {
  if (amount == null) return '—'
  try {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${amount} ر.س`
  }
}

type ProjectLite = { id: string; code: string; name_ar: string }
type DeveloperLite = { id: string; company_name_ar: string }
type PaidFromLite = { id: string; label: string }

type DeliveredRow = {
  id: string
  case_number: string
  voucher_number_text: string | null
  amount_sar: number | null
  delivered_at: string | null
  delivered_by_user_id: string | null
  recipient_name: string | null
  recipient_phone: string | null
  paid_from_account_id: string | null
  paid_at: string | null
  // Flag set by the historical-cases importer (migration 056). Rendered
  // as a "تاريخي" chip in the row so the reader can tell workflow-driven
  // deliveries apart from bulk-imported legacy records at a glance.
  is_historical: boolean | null
  // Only beneficiary_name_ar is pulled from the JSONB — matches the
  // kanban cards on the dashboard.
  extracted_fields: { beneficiary_name_ar?: string | null } | null
  project: ProjectLite | ProjectLite[] | null
  developer: DeveloperLite | DeveloperLite[] | null
  paid_from: PaidFromLite | PaidFromLite[] | null
}

function single<T>(maybe: T | T[] | null | undefined): T | null {
  if (!maybe) return null
  return Array.isArray(maybe) ? (maybe[0] ?? null) : maybe
}

export default async function ArchivePage({
  searchParams,
}: {
  searchParams?: {
    client?: string
    project?: string
    employee?: string
    from?: string
    to?: string
    q?: string
  }
}) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) redirect('/login')

  const dsbRole = (profile.dsb_role as string | null) ?? null
  // Read-access only — viewer + deliverer can browse the archive.
  if (!dsbRole || !['employee', 'supervisor', 'owner', 'viewer', 'deliverer'].includes(dsbRole)) {
    redirect('/app/disbursements')
  }

  const tenantId = profile.tenant_id as string

  // ---------- Filters from URL ----------
  const f = searchParams ?? {}
  const fClient   = (f.client   ?? '').trim() || null
  const fProject  = (f.project  ?? '').trim() || null
  const fEmployee = (f.employee ?? '').trim() || null
  const fFrom     = (f.from     ?? '').trim() || null
  const fTo       = (f.to       ?? '').trim() || null
  const fQ        = (f.q        ?? '').trim() || null

  // Employee-filter: resolve their assigned projects first, then constrain
  // the cases query to that project set. Same pattern as the register.
  let projectIdsForEmployee: string[] | null = null
  if (fEmployee) {
    const { data: empProjects } = await svc
      .from('dsb_projects')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('assigned_employee_id', fEmployee)
    projectIdsForEmployee = ((empProjects ?? []) as { id: string }[]).map((p) => p.id)
  }

  // ---------- Filter-bar dropdown options ----------
  const [clientOptsRes, projectOptsRes, employeeOptsRes] = await Promise.all([
    svc
      .from('dsb_developers')
      .select('id, company_name_ar')
      .eq('tenant_id', tenantId)
      .order('company_name_ar', { ascending: true }),
    svc
      .from('dsb_projects')
      .select('id, code, name_ar, developer_id')
      .eq('tenant_id', tenantId)
      .order('code', { ascending: true }),
    svc
      .from('users')
      .select('id, full_name')
      .eq('tenant_id', tenantId)
      .in('dsb_role', ['employee', 'supervisor', 'owner', 'deliverer'])
      .order('full_name', { ascending: true }),
  ])
  const clientOptions = ((clientOptsRes.data ?? []) as Array<{ id: string; company_name_ar: string }>)
    .map((c) => ({ id: c.id, label: c.company_name_ar }))
  const projectOptions = ((projectOptsRes.data ?? []) as Array<{ id: string; code: string; name_ar: string; developer_id: string | null }>)
    .map((p) => ({ id: p.id, label: `${p.code} — ${p.name_ar}`, developer_id: p.developer_id }))
  const employeeOptions = ((employeeOptsRes.data ?? []) as Array<{ id: string; full_name: string | null }>)
    .map((u) => ({ id: u.id, label: u.full_name ?? '—' }))

  // ---------- Cases query with filters ----------
  let casesQuery = svc
    .from('dsb_cases')
    .select(
      `id, case_number, voucher_number_text, amount_sar, delivered_at,
       delivered_by_user_id, recipient_name, recipient_phone,
       paid_from_account_id, paid_at, extracted_fields, is_historical,
       project:dsb_projects!dsb_cases_project_id_fkey(id, code, name_ar),
       developer:dsb_developers!dsb_cases_developer_id_fkey(id, company_name_ar),
       paid_from:dsb_project_accounts!dsb_cases_paid_from_account_id_fkey(id, label)`,
    )
    .eq('tenant_id', tenantId)
    .eq('status', 'delivered')
  if (fClient) casesQuery = casesQuery.eq('developer_id', fClient)
  if (fProject) casesQuery = casesQuery.eq('project_id', fProject)
  if (fFrom) casesQuery = casesQuery.gte('delivered_at', `${fFrom}T00:00:00+03`)
  if (fTo) casesQuery = casesQuery.lte('delivered_at', `${fTo}T23:59:59+03`)
  if (fQ) {
    casesQuery = casesQuery.or(
      `case_number.ilike.%${fQ}%,voucher_number_text.ilike.%${fQ}%,recipient_name.ilike.%${fQ}%`,
    )
  }
  if (projectIdsForEmployee !== null) {
    const projectFilterIds =
      projectIdsForEmployee.length === 0
        ? ['00000000-0000-0000-0000-000000000000']
        : projectIdsForEmployee
    casesQuery = casesQuery.in('project_id', projectFilterIds)
  }
  const { data: casesData } = await casesQuery.order('delivered_at', { ascending: false })
  const cases = (casesData ?? []) as DeliveredRow[]

  // Resolve "delivered by" names in bulk so we can render them in the table.
  const delivererIds = Array.from(
    new Set(cases.map((c) => c.delivered_by_user_id).filter((x): x is string => !!x)),
  )
  const delivererNameById = new Map<string, string>()
  if (delivererIds.length > 0) {
    const { data: users } = await svc
      .from('users')
      .select('id, full_name')
      .in('id', delivererIds)
    for (const u of (users ?? []) as { id: string; full_name: string | null }[]) {
      delivererNameById.set(u.id, u.full_name ?? '—')
    }
  }

  // For the inline paid-from picker we need the full list of accounts
  // available to each row's project. We do a single bulk fetch over all
  // distinct projects, then group by project_id.
  // Fetch EVERY tenant account (not just the ones for the cases' projects).
  // Each option is labeled "{project} · {label}" so the user can pick any
  // account regardless of which project it's administratively assigned to —
  // important when the importer routed accounts to a slightly-different
  // project name and the user needs the dropdown to surface them anyway.
  // Server-side validation in updateDeliveryInfo no longer requires the
  // account to belong to the case's project; tenant-membership is enough.
  const { data: allAccountsData } = await svc
    .from('dsb_project_accounts')
    .select(`id, project_id, label, is_active,
             project:dsb_projects!dsb_project_accounts_project_id_fkey(id, name_ar)`)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('label', { ascending: true })
  type AccountWithProject = {
    id: string
    project_id: string
    label: string
    project: { id: string; name_ar: string } | { id: string; name_ar: string }[] | null
  }
  const allTenantAccounts: Array<{ id: string; label: string; projectId: string; projectName: string }> =
    ((allAccountsData ?? []) as AccountWithProject[]).map((a) => {
      const proj = single(a.project)
      return {
        id: a.id,
        label: a.label,
        projectId: a.project_id,
        projectName: proj?.name_ar ?? '—',
      }
    })

  /**
   * For a given case, build the dropdown options: account list with the
   * case's project's accounts FIRST (so the common case is one click), the
   * rest after. Each option's display label includes the project so the user
   * can disambiguate. Labels stay in the source label field; project name is
   * prefixed only in the displayLabel.
   */
  function accountOptionsForCaseProject(caseProjectId: string | null) {
    if (!caseProjectId) return allTenantAccounts.map((a) => ({ id: a.id, label: `${a.projectName} · ${a.label}` }))
    const matching: Array<{ id: string; label: string }> = []
    const others: Array<{ id: string; label: string }> = []
    for (const a of allTenantAccounts) {
      const display = `${a.projectName} · ${a.label}`
      if (a.projectId === caseProjectId) matching.push({ id: a.id, label: display })
      else others.push({ id: a.id, label: display })
    }
    return [...matching, ...others]
  }

  // ---------- KPI strip ----------
  // "This month" uses Riyadh-time month start; we keep this calc simple and
  // approximate with browser local — the registry isn't a financial report.
  const totalDelivered = cases.length
  const monthStartIso = (() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
  })()
  const deliveredThisMonth = cases.filter(
    (c) => c.delivered_at && c.delivered_at >= monthStartIso,
  ).length
  const totalAmount = cases.reduce((sum, c) => sum + (c.amount_sar ?? 0), 0)

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      <header className="space-y-2">
        <Link
          href="/app/disbursements"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          ← العودة إلى صندوق الصرفيات
        </Link>
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Archive className="w-4 h-4" aria-hidden="true" />
          الأرشيف
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            الوثائق المسلَّمة
          </h1>
          <span className="text-sm text-slate-400 font-mono">({cases.length})</span>
        </div>
        <p className="text-sm text-slate-600">
          الطلبات التي اكتمل تسليمها للمستلم — جميعها مؤرشَفة هنا ولن تظهر في
          صندوق الصرفيات أو لوحة المراحل بعد التسليم.
        </p>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard label="إجمالي المؤرشَفة" value={String(totalDelivered)} />
        <KpiCard label="مؤرشَفة هذا الشهر" value={String(deliveredThisMonth)} />
        <KpiCard label="إجمالي المبالغ" value={fmtSar(totalAmount)} mono />
      </div>

      <CaseFiltersBar
        clients={clientOptions}
        projects={projectOptions}
        employees={employeeOptions}
        // Hide status from the filter bar — every row here is 'delivered' by
        // definition.
        hideStatus
      />

      {cases.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500 shadow-sm">
          لا توجد وثائق مؤرشَفة بعد.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-right">
                  <Th>رقم الطلب</Th>
                  <Th>المشروع</Th>
                  <Th>العميل</Th>
                  <Th>رقم السند</Th>
                  <Th>المبلغ</Th>
                  <Th>المستفيد</Th>
                  <Th>حساب الدفع</Th>
                  <Th>تاريخ السداد</Th>
                  <Th>المستلم</Th>
                  <Th>وقت التسليم</Th>
                  <Th>سلَّم</Th>
                  <Th>الإجراء</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cases.map((c) => {
                  const project = single(c.project)
                  const developer = single(c.developer)
                  const paidFrom = single(c.paid_from)
                  const deliverer = c.delivered_by_user_id
                    ? delivererNameById.get(c.delivered_by_user_id) ?? '—'
                    : '—'
                  // All tenant accounts, with this case's project's accounts
                  // sorted FIRST. Lets the user pick any uploaded account
                  // regardless of which project the importer assigned it to.
                  const projectAccounts = accountOptionsForCaseProject(project?.id ?? null)
                  return (
                    <EditableArchiveRow
                      key={c.id}
                      caseId={c.id}
                      caseNumber={c.case_number}
                      project={project ? { code: project.code, name_ar: project.name_ar } : null}
                      developer={developer ? { company_name_ar: developer.company_name_ar } : null}
                      voucherNumber={c.voucher_number_text}
                      amountLabel={fmtSar(c.amount_sar)}
                      beneficiaryName={c.extracted_fields?.beneficiary_name_ar ?? null}
                      recipientName={c.recipient_name}
                      recipientPhone={c.recipient_phone}
                      deliveredAt={c.delivered_at}
                      delivererName={deliverer}
                      // Viewer is read-only; staff + deliverer can edit
                      // the recipient name / delivery time inline.
                      canEdit={['employee', 'supervisor', 'owner', 'deliverer'].includes(dsbRole ?? '')}
                      paidFromAccountId={c.paid_from_account_id}
                      // If the FK was nulled out by a deleted account,
                      // paid_from will be null even when paid_from_account_id
                      // is non-null in some race conditions — we display "—"
                      // in either case via the row's fallback.
                      paidFromLabel={paidFrom?.label ?? null}
                      accountOptions={projectAccounts}
                      paidAt={c.paid_at}
                      isHistorical={!!c.is_historical}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-black text-slate-900 ${mono ? 'font-mono' : 'serif'}`}>
        {value}
      </div>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 text-sm text-slate-700 align-top">{children}</td>
}
