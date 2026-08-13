import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { Archive } from 'lucide-react'
import { CaseFiltersBar } from '../CaseFiltersBar'
import { EditableArchiveRow } from './EditableArchiveRow'
import { assignedProjectIds, applyProjectScope } from '@/lib/dsb/access'

/**
 * Archive — all cases in a terminal state (delivered OR rejected).
 *
 * Two terminal statuses live here:
 *   - delivered → the signed voucher was handed off to the recipient
 *   - rejected  → the reviewer formally refused the voucher (with a reason)
 *
 * Both leave every other view (dashboard kanban, board, documents register)
 * and live only here. A tab strip at the top switches between:
 *   الكل | المسلَّمة | المرفوضة   (URL param ?type=all|delivered|rejected)
 * Default is delivered (the historical behavior — most rows are still
 * successful deliveries and the operator's default question is "what
 * went out today").
 *
 * Date filters target `delivered_at` for delivered rows and `rejected_at`
 * for rejected rows. Under "all", we order by the greater of the two.
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

type ArchivedRow = {
  id: string
  case_number: string
  status: 'delivered' | 'rejected' | string
  voucher_number_text: string | null
  amount_sar: number | null
  delivered_at: string | null
  delivered_by_user_id: string | null
  rejected_at: string | null
  rejected_by_user_id: string | null
  rejection_reason: string | null
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

type ArchiveTab = 'all' | 'delivered' | 'rejected'
function parseTab(v: string | undefined): ArchiveTab {
  return v === 'rejected' || v === 'all' ? v : 'delivered'
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
    type?: string
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
  const currentUserId = profile.id as string

  // ---------- Project-scoped access ----------
  // Owner sees every project; everyone else (supervisor/employee/viewer/
  // deliverer) is limited to projects they're explicitly assigned to.
  const allowedProjectIds = await assignedProjectIds({
    svc,
    tenantId,
    userId: currentUserId,
    dsbRole,
  })

  // ---------- Filters from URL ----------
  const f = searchParams ?? {}
  const fClient   = (f.client   ?? '').trim() || null
  const fProject  = (f.project  ?? '').trim() || null
  const fEmployee = (f.employee ?? '').trim() || null
  const fFrom     = (f.from     ?? '').trim() || null
  const fTo       = (f.to       ?? '').trim() || null
  const fQ        = (f.q        ?? '').trim() || null
  const activeTab = parseTab(f.type)

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
    // Scoped users only see their assigned projects in the filter dropdown.
    .filter((p) => allowedProjectIds === null || allowedProjectIds.includes(p.id))
    .map((p) => ({ id: p.id, label: `${p.code} — ${p.name_ar}`, developer_id: p.developer_id }))
  const employeeOptions = ((employeeOptsRes.data ?? []) as Array<{ id: string; full_name: string | null }>)
    .map((u) => ({ id: u.id, label: u.full_name ?? '—' }))

  // ---------- Cases query with filters ----------
  let casesQuery = svc
    .from('dsb_cases')
    .select(
      `id, case_number, status, voucher_number_text, amount_sar, delivered_at,
       delivered_by_user_id, rejected_at, rejected_by_user_id, rejection_reason,
       recipient_name, recipient_phone,
       paid_from_account_id, paid_at, extracted_fields, is_historical,
       project:dsb_projects!dsb_cases_project_id_fkey(id, code, name_ar),
       developer:dsb_developers!dsb_cases_developer_id_fkey(id, company_name_ar),
       paid_from:dsb_project_accounts!dsb_cases_paid_from_account_id_fkey(id, label)`,
    )
    .eq('tenant_id', tenantId)
  if (activeTab === 'delivered') casesQuery = casesQuery.eq('status', 'delivered')
  else if (activeTab === 'rejected') casesQuery = casesQuery.eq('status', 'rejected')
  else casesQuery = casesQuery.in('status', ['delivered', 'rejected'])
  if (fClient) casesQuery = casesQuery.eq('developer_id', fClient)
  if (fProject) casesQuery = casesQuery.eq('project_id', fProject)
  // Date filters. In the "rejected" tab, filter by rejected_at instead of
  // delivered_at (which is null for rejected rows). Under "all" we filter
  // by delivered_at only — rejected rows won't be filtered by date under
  // "all", which keeps the query simple; users usually pick a specific
  // tab before date-filtering anyway.
  const dateCol = activeTab === 'rejected' ? 'rejected_at' : 'delivered_at'
  if (fFrom) casesQuery = casesQuery.gte(dateCol, `${fFrom}T00:00:00+03`)
  if (fTo) casesQuery = casesQuery.lte(dateCol, `${fTo}T23:59:59+03`)
  if (fQ) {
    // Universal search — spans everything a user might type in the box:
    // case/voucher IDs, unit + contract identifiers via the linked sale,
    // recipient + buyer + beneficiary names, phone, ID numbers. Values in
    // extracted_fields (JSONB) use the ->> text-extract operator; PostgREST
    // accepts them inside .or() the same as regular columns.
    const q = fQ
    casesQuery = casesQuery.or(
      [
        `case_number.ilike.%${q}%`,
        `voucher_number_text.ilike.%${q}%`,
        `recipient_name.ilike.%${q}%`,
        `recipient_phone.ilike.%${q}%`,
        `recipient_id_number.ilike.%${q}%`,
        `notes.ilike.%${q}%`,
        `extracted_fields->>beneficiary_name_ar.ilike.%${q}%`,
        `extracted_fields->>buyer_name_ar.ilike.%${q}%`,
        `extracted_fields->>buyer_id_number.ilike.%${q}%`,
        `extracted_fields->>invoice_number.ilike.%${q}%`,
        `extracted_fields->>contract_number.ilike.%${q}%`,
        `extracted_fields->>unit_number.ilike.%${q}%`,
      ].join(','),
    )
  }
  if (projectIdsForEmployee !== null) {
    const projectFilterIds =
      projectIdsForEmployee.length === 0
        ? ['00000000-0000-0000-0000-000000000000']
        : projectIdsForEmployee
    casesQuery = casesQuery.in('project_id', projectFilterIds)
  }
  // Owner sees everything; scoped users are constrained to their assigned
  // projects. Applied AFTER other filters so a scoped user with an explicit
  // ?project= filter can still narrow further within their allowed set.
  casesQuery = applyProjectScope(casesQuery, allowedProjectIds)
  // Order by the appropriate terminal timestamp. Under "all" we can't order
  // by two columns cleanly in PostgREST, so we sort in JS after the fetch.
  if (activeTab === 'rejected') {
    casesQuery = casesQuery.order('rejected_at', { ascending: false })
  } else {
    casesQuery = casesQuery.order('delivered_at', { ascending: false })
  }
  const { data: casesData } = await casesQuery
  let cases = (casesData ?? []) as ArchivedRow[]
  if (activeTab === 'all') {
    // Merge-sort: use whichever terminal timestamp exists for each row.
    cases = [...cases].sort((a, b) => {
      const aTs = a.rejected_at ?? a.delivered_at ?? ''
      const bTs = b.rejected_at ?? b.delivered_at ?? ''
      return bTs.localeCompare(aTs)
    })
  }

  // Resolve "delivered/rejected by" names in bulk so we can render them
  // in the table. We look up both sets in one query.
  const actorIds = Array.from(
    new Set(
      cases.flatMap((c) => [c.delivered_by_user_id, c.rejected_by_user_id])
        .filter((x): x is string => !!x),
    ),
  )
  const delivererNameById = new Map<string, string>()
  if (actorIds.length > 0) {
    const { data: users } = await svc
      .from('users')
      .select('id, full_name')
      .in('id', actorIds)
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
  const monthStartIso = (() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
  })()
  const deliveredCount = cases.filter((c) => c.status === 'delivered').length
  const rejectedCount  = cases.filter((c) => c.status === 'rejected').length
  const deliveredThisMonth = cases.filter(
    (c) => c.status === 'delivered' && c.delivered_at && c.delivered_at >= monthStartIso,
  ).length
  const totalAmount = cases
    .filter((c) => c.status === 'delivered')
    .reduce((sum, c) => sum + (c.amount_sar ?? 0), 0)

  // Preserve current filters when building tab links.
  function tabHref(t: ArchiveTab): string {
    const params = new URLSearchParams()
    if (t !== 'delivered') params.set('type', t)   // default = delivered, omit for tidiness
    if (fClient)   params.set('client', fClient)
    if (fProject)  params.set('project', fProject)
    if (fEmployee) params.set('employee', fEmployee)
    if (fFrom)     params.set('from', fFrom)
    if (fTo)       params.set('to', fTo)
    if (fQ)        params.set('q', fQ)
    const qs = params.toString()
    return qs ? `?${qs}` : ''
  }

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
            {activeTab === 'rejected'
              ? 'الوثائق المرفوضة'
              : activeTab === 'all'
                ? 'الوثائق المؤرشَفة'
                : 'الوثائق المسلَّمة'}
          </h1>
          <span className="text-sm text-slate-400 font-mono">({cases.length})</span>
        </div>
        <p className="text-sm text-slate-600">
          {activeTab === 'rejected'
            ? 'الطلبات التي رفضها المراجع — مؤرشَفة هنا مع سبب الرفض ولن تظهر في لوحة المراحل.'
            : activeTab === 'all'
              ? 'كل الطلبات التي وصلت لحالة نهائية (مسلَّمة أو مرفوضة).'
              : 'الطلبات التي اكتمل تسليمها للمستلم — مؤرشَفة هنا ولن تظهر في صندوق الصرفيات أو لوحة المراحل بعد التسليم.'}
        </p>
      </header>

      {/* Tab strip: مسلَّمة (default) / مرفوضة / الكل */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <TabLink href={tabHref('delivered')} active={activeTab === 'delivered'} label="المسلَّمة" />
        <TabLink href={tabHref('rejected')}  active={activeTab === 'rejected'}  label="المرفوضة" tone="red" />
        <TabLink href={tabHref('all')}       active={activeTab === 'all'}       label="الكل" />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <KpiCard label="مسلَّمة" value={String(deliveredCount)} />
        <KpiCard label="مرفوضة" value={String(rejectedCount)} />
        <KpiCard label="مسلَّمة هذا الشهر" value={String(deliveredThisMonth)} />
        <KpiCard label="إجمالي المبالغ (المسلَّمة)" value={fmtSar(totalAmount)} mono />
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
                  <Th>وقت التسليم / سلَّم</Th>
                  <Th>الإجراء</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cases.map((c) => {
                  const project = single(c.project)
                  const developer = single(c.developer)
                  const paidFrom = single(c.paid_from)
                  // Rejected rows use a static red-tinted row (not editable);
                  // delivered rows use the existing inline-editable component.
                  if (c.status === 'rejected') {
                    const rejecter = c.rejected_by_user_id
                      ? delivererNameById.get(c.rejected_by_user_id) ?? '—'
                      : '—'
                    return (
                      <RejectedArchiveRow
                        key={c.id}
                        caseId={c.id}
                        caseNumber={c.case_number}
                        project={project ? { code: project.code, name_ar: project.name_ar } : null}
                        developer={developer ? { company_name_ar: developer.company_name_ar } : null}
                        voucherNumber={c.voucher_number_text}
                        amountLabel={fmtSar(c.amount_sar)}
                        beneficiaryName={c.extracted_fields?.beneficiary_name_ar ?? null}
                        paidFromLabel={paidFrom?.label ?? null}
                        paidAt={c.paid_at}
                        rejectedAt={c.rejected_at}
                        rejecterName={rejecter}
                        rejectionReason={c.rejection_reason}
                      />
                    )
                  }
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
  // Tightened padding to match the row Td (px-2 py-2) so the whole archive
  // table fits without horizontal scroll on typical laptop widths.
  return (
    <th className="px-2 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-2 py-2 text-sm text-slate-700 align-top">{children}</td>
}

function TabLink({
  href,
  active,
  label,
  tone,
}: {
  href: string
  active: boolean
  label: string
  tone?: 'red'
}) {
  const activeCls = tone === 'red'
    ? 'border-red-600 text-red-700'
    : 'border-teal-600 text-teal-700'
  const idleCls = 'border-transparent text-slate-500 hover:text-slate-800'
  return (
    <Link
      href={href}
      className={`inline-flex items-center px-4 py-2 -mb-px text-sm font-semibold border-b-2 transition ${active ? activeCls : idleCls}`}
    >
      {label}
    </Link>
  )
}

/**
 * Static row for a rejected case in the archive.
 *
 * Kept separate from EditableArchiveRow because rejected cases have no
 * recipient / delivery time to edit — the operator's job here is just to
 * see the row and read why it was refused. The rejection reason is shown
 * inline (truncated) with the full text on hover via `title`.
 */
function RejectedArchiveRow({
  caseId,
  caseNumber,
  project,
  developer,
  voucherNumber,
  amountLabel,
  beneficiaryName,
  paidFromLabel,
  paidAt,
  rejectedAt,
  rejecterName,
  rejectionReason,
}: {
  caseId: string
  caseNumber: string
  project: { code: string; name_ar: string } | null
  developer: { company_name_ar: string } | null
  voucherNumber: string | null
  amountLabel: string
  beneficiaryName: string | null
  paidFromLabel: string | null
  paidAt: string | null
  rejectedAt: string | null
  rejecterName: string
  rejectionReason: string | null
}) {
  const rejectedAtLabel = rejectedAt
    ? new Date(rejectedAt).toLocaleString('ar-SA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh',
      })
    : '—'
  return (
    <tr className="bg-red-50/30 hover:bg-red-50/60 transition">
      <Td>
        <div className="flex flex-col gap-1">
          <Link
            href={`/app/disbursements/${caseId}`}
            className="font-mono text-xs text-teal-700 hover:underline whitespace-nowrap"
          >
            {caseNumber}
          </Link>
          <span
            className="inline-flex items-center gap-1 self-start rounded-md bg-red-100 text-red-800 ring-1 ring-inset ring-red-200 px-1.5 py-0.5 text-[10px] font-bold"
            title={rejectionReason ?? undefined}
          >
            مرفوضة
          </span>
        </div>
      </Td>
      <Td>{project ? `${project.code} — ${project.name_ar}` : '—'}</Td>
      <Td>{developer?.company_name_ar ?? '—'}</Td>
      <Td>{voucherNumber ? <span className="font-mono text-xs">{voucherNumber}</span> : '—'}</Td>
      <Td><span className="font-mono">{amountLabel}</span></Td>
      <Td>{beneficiaryName ?? '—'}</Td>
      <Td>{paidFromLabel ?? '—'}</Td>
      <Td>{paidAt ?? '—'}</Td>
      <Td>—</Td>
      <Td>
        <div className="flex flex-col text-xs">
          <span className="text-slate-800">{rejectedAtLabel}</span>
          <span className="text-slate-500">رفضها: {rejecterName}</span>
          {rejectionReason && (
            <span
              className="mt-1 text-red-700 line-clamp-2 max-w-[16rem]"
              title={rejectionReason}
            >
              «{rejectionReason}»
            </span>
          )}
        </div>
      </Td>
      <Td>
        <Link
          href={`/app/disbursements/${caseId}`}
          className="inline-flex items-center gap-1 text-xs text-teal-700 hover:underline"
        >
          فتح
        </Link>
      </Td>
    </tr>
  )
}
