import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { FileText, Plus, Settings, LayoutDashboard, Activity, UploadCloud, ArrowRightCircle, RotateCcw, CheckCircle2, XCircle, Move } from 'lucide-react'
import { fmtDate, fmtDateTime } from '@/lib/dsb/datetime'
import { CaseFiltersBar } from './CaseFiltersBar'

export const dynamic = 'force-dynamic'

type ProjectLite = { id: string; code: string; name_ar: string; assigned_employee_id?: string | null }
type DeveloperLite = { id: string; company_name_ar: string }

type CaseRow = {
  id: string
  case_number: string
  voucher_number_text: string | null
  amount_sar: number | null
  status: string
  submitted_at: string | null
  signed_at: string | null
  created_at: string
  project: ProjectLite | ProjectLite[] | null
  developer: DeveloperLite | DeveloperLite[] | null
}

type AuditRow = {
  id: string
  event: string
  from_status: string | null
  to_status: string | null
  occurred_at: string
  case: { id: string; case_number: string; project: { name_ar: string } | { name_ar: string }[] | null } | { id: string; case_number: string; project: { name_ar: string } | { name_ar: string }[] | null }[] | null
}

function single<T>(maybe: T | T[] | null | undefined): T | null {
  if (!maybe) return null
  return Array.isArray(maybe) ? (maybe[0] ?? null) : maybe
}

function fmtSar(amount: number | null): string {
  if (amount == null) return '—'
  try {
    return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${amount} ر.س`
  }
}
function timeAgoAr(s: string | null): string {
  if (!s) return '—'
  const then = new Date(s).getTime()
  if (Number.isNaN(then)) return s
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (diffSec < 60) return 'الآن'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `منذ ${diffMin} دقيقة`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `منذ ${diffHr} ساعة`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `منذ ${diffDay} يوم`
  return fmtDate(s)
}

function roleLabelAr(role: string | null): string {
  if (role === 'employee') return 'الموظف'
  if (role === 'supervisor') return 'السوبرفايزر'
  if (role === 'owner') return 'المدير'
  return '—'
}

const PIPELINE_COLUMNS: {
  key: 'with_employee' | 'with_supervisor' | 'with_owner' | 'signed' | 'sent_back_to_developer'
  title: string
  headCls: string
}[] = [
  { key: 'with_employee',          title: 'بانتظار الموظف',         headCls: 'bg-amber-50 text-amber-800 border-amber-200' },
  { key: 'with_supervisor',        title: 'بانتظار السوبرفايزر',    headCls: 'bg-amber-50 text-amber-800 border-amber-200' },
  { key: 'with_owner',             title: 'بانتظار التوقيع',         headCls: 'bg-amber-50 text-amber-800 border-amber-200' },
  { key: 'signed',                 title: 'موقّعة',                  headCls: 'bg-green-50 text-green-800 border-green-200' },
  { key: 'sent_back_to_developer', title: 'أعيدت إلى المطور',        headCls: 'bg-red-50 text-red-800 border-red-200' },
]

type EventDescriptor = {
  Icon: typeof FileText
  iconCls: string
  label: string
}

function describeEvent(event: string, toStatus: string | null): EventDescriptor {
  if (event === 'uploaded') {
    return { Icon: UploadCloud, iconCls: 'text-teal-600 bg-teal-50', label: 'تم رفع وثيقة صرف جديدة' }
  }
  if (event === 'employee_approved') {
    return { Icon: ArrowRightCircle, iconCls: 'text-amber-700 bg-amber-50', label: 'اعتمد الموظف وأرسل للسوبرفايزر' }
  }
  if (event === 'supervisor_approved') {
    return { Icon: ArrowRightCircle, iconCls: 'text-amber-700 bg-amber-50', label: 'اعتمد السوبرفايزر وأرسل للتوقيع النهائي' }
  }
  if (event === 'sent_back') {
    return { Icon: RotateCcw, iconCls: 'text-red-700 bg-red-50', label: 'أعيدت إلى المطور' }
  }
  if (event === 'signed') {
    return { Icon: CheckCircle2, iconCls: 'text-green-700 bg-green-50', label: 'وقّع المدير نهائيًا' }
  }
  if (event === 'cancelled') {
    return { Icon: XCircle, iconCls: 'text-slate-500 bg-slate-100', label: 'أُلغي الطلب' }
  }
  if (event === 'manual_move') {
    if (toStatus === 'with_supervisor') {
      return { Icon: ArrowRightCircle, iconCls: 'text-amber-700 bg-amber-50', label: 'اعتمد الموظف وأرسل للسوبرفايزر' }
    }
    if (toStatus === 'with_owner') {
      return { Icon: ArrowRightCircle, iconCls: 'text-amber-700 bg-amber-50', label: 'اعتمد السوبرفايزر وأرسل للتوقيع النهائي' }
    }
    if (toStatus === 'sent_back_to_developer') {
      return { Icon: RotateCcw, iconCls: 'text-red-700 bg-red-50', label: 'أعيدت إلى المطور' }
    }
    if (toStatus === 'signed') {
      return { Icon: CheckCircle2, iconCls: 'text-green-700 bg-green-50', label: 'وقّع المدير نهائيًا' }
    }
    return { Icon: Move, iconCls: 'text-slate-600 bg-slate-100', label: 'تم نقل الطلب يدويًا' }
  }
  return { Icon: Activity, iconCls: 'text-slate-600 bg-slate-100', label: event }
}

function startOfMonthIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)).toISOString()
}

export default async function DisbursementsDashboardPage({
  searchParams,
}: {
  searchParams?: {
    client?: string
    project?: string
    employee?: string
    status?: string
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
    .select('id, tenant_id, dsb_role, full_name')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) redirect('/login')

  const dsbRole = (profile.dsb_role as string | null) ?? null
  // Developers (clients) belong in /developer, not the staff dashboard.
  // Redirect them directly instead of going through /app (which would just
  // bounce back here and cause ERR_TOO_MANY_REDIRECTS).
  if (dsbRole === 'developer') redirect('/developer')
  // Open to every internal role — including viewer (read-only) and deliverer
  // (read + deliver). Write actions are gated separately at the action layer.
  if (!dsbRole || !['employee', 'supervisor', 'owner', 'viewer', 'deliverer'].includes(dsbRole)) {
    redirect('/login')
  }

  const tenantId = profile.tenant_id as string
  const userId = profile.id as string
  const fullName = (profile.full_name as string | null) ?? null

  const monthStart = startOfMonthIso()
  // For avg cycle: signed in the last 30 days.
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const myInboxStatus =
    dsbRole === 'employee' ? 'with_employee' :
    dsbRole === 'supervisor' ? 'with_supervisor' :
    dsbRole === 'owner' ? 'with_owner' :
    null

  // ---------- Filter values from URL (CaseFiltersBar writes these) ----------
  const f = searchParams ?? {}
  const fClient   = (f.client   ?? '').trim() || null
  const fProject  = (f.project  ?? '').trim() || null
  const fEmployee = (f.employee ?? '').trim() || null
  const fStatus   = (f.status   ?? '').trim() || null
  const fFrom     = (f.from     ?? '').trim() || null
  const fTo       = (f.to       ?? '').trim() || null
  const fQ        = (f.q        ?? '').trim() || null

  // If filtering by assigned employee, we must first resolve the projects
  // assigned to them — assignment lives on dsb_projects, not on dsb_cases.
  // Project assignment is the UNION of:
  //   * legacy dsb_projects.assigned_employee_id (single pointer), and
  //   * dsb_project_employees junction (many-to-many, the new model).
  let projectIdsForEmployee: string[] | null = null
  if (fEmployee) {
    const [legacyRes, junctionRes] = await Promise.all([
      svc
        .from('dsb_projects')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('assigned_employee_id', fEmployee),
      svc
        .from('dsb_project_employees')
        .select('project_id')
        .eq('tenant_id', tenantId)
        .eq('user_id', fEmployee),
    ])
    const fromLegacy = ((legacyRes.data ?? []) as { id: string }[]).map((p) => p.id)
    const fromJunction = ((junctionRes.data ?? []) as { project_id: string }[]).map((p) => p.project_id)
    projectIdsForEmployee = Array.from(new Set([...fromLegacy, ...fromJunction]))
    // If they have no projects, no cases will match — short-circuit later.
  }

  // Pre-compute the current user's project IDs (junction + legacy) once.
  // Used by the my-inbox count below, and by the dashboard's "in my queue"
  // filter for employees.
  const myProjectIds: string[] = await (async () => {
    const [legacyRes, junctionRes] = await Promise.all([
      svc
        .from('dsb_projects')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('assigned_employee_id', userId),
      svc
        .from('dsb_project_employees')
        .select('project_id')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId),
    ])
    const fromLegacy = ((legacyRes.data ?? []) as { id: string }[]).map((p) => p.id)
    const fromJunction = ((junctionRes.data ?? []) as { project_id: string }[]).map((p) => p.project_id)
    return Array.from(new Set([...fromLegacy, ...fromJunction]))
  })()

  // ---------- Dropdown options for the filter bar ----------
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

  // For employee role, my-inbox needs filtering by assigned_employee_id on project.
  // Run all queries in parallel.
  const [
    casesRes,
    activeCountRes,
    signedThisMonthCountRes,
    sentBackCountRes,
    myInboxAllRes, // employee inbox count needs a list filter; supervisor/owner just need a head count
    avgCycleRes,
    auditRes,
  ] = await Promise.all([
    (async () => {
      // Build the cases query with all active filters applied. We layer them
      // on a base query because Supabase's PostgREST builder is chainable.
      let q = svc
        .from('dsb_cases')
        .select(
          `id, case_number, voucher_number_text, amount_sar, status, submitted_at, signed_at, created_at,
           project:dsb_projects!dsb_cases_project_id_fkey(id, code, name_ar, assigned_employee_id),
           developer:dsb_developers!dsb_cases_developer_id_fkey(id, company_name_ar)`,
        )
        .eq('tenant_id', tenantId)
      if (fClient) q = q.eq('developer_id', fClient)
      if (fProject) q = q.eq('project_id', fProject)
      if (fStatus) q = q.eq('status', fStatus)
      if (fFrom) q = q.gte('submitted_at', `${fFrom}T00:00:00+03`)
      if (fTo) q = q.lte('submitted_at', `${fTo}T23:59:59+03`)
      if (fQ) {
        // Match against case_number OR voucher_number_text (free-text search).
        q = q.or(`case_number.ilike.%${fQ}%,voucher_number_text.ilike.%${fQ}%`)
      }
      if (projectIdsForEmployee !== null) {
        if (projectIdsForEmployee.length === 0) {
          // Employee filter active but they own zero projects → no matches.
          return { data: [], error: null } as { data: unknown[]; error: null }
        }
        q = q.in('project_id', projectIdsForEmployee)
      }
      return q
        .order('submitted_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(500)
    })(),
    svc
      .from('dsb_cases')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['with_employee', 'with_supervisor', 'with_owner']),
    svc
      .from('dsb_cases')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'signed')
      .gte('signed_at', monthStart),
    svc
      .from('dsb_cases')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'sent_back_to_developer'),
    (async () => {
      if (!myInboxStatus) return { count: 0 } as { count: number }
      if (dsbRole === 'employee') {
        // My inbox for an employee = cases in `with_employee` status whose
        // project is in MY assigned set (junction ∪ legacy single pointer).
        // If I'm not on any project, the count is 0 without querying.
        if (myProjectIds.length === 0) return { count: 0 }
        const { count } = await svc
          .from('dsb_cases')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('status', myInboxStatus)
          .in('project_id', myProjectIds)
        return { count: count ?? 0 }
      }
      const { count } = await svc
        .from('dsb_cases')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', myInboxStatus)
      return { count: count ?? 0 }
    })(),
    svc
      .from('dsb_cases')
      .select('created_at, signed_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'signed')
      .gte('signed_at', thirtyDaysAgoIso)
      .limit(500),
    svc
      .from('dsb_audit_log')
      .select(
        `id, event, from_status, to_status, occurred_at,
         case:dsb_cases!dsb_audit_log_case_id_fkey(id, case_number, project:dsb_projects!dsb_cases_project_id_fkey(name_ar))`,
      )
      .eq('tenant_id', tenantId)
      .order('occurred_at', { ascending: false })
      .limit(10),
  ])

  const cases = (casesRes.data ?? []) as CaseRow[]
  const activeCount = activeCountRes.count ?? 0
  const signedThisMonthCount = signedThisMonthCountRes.count ?? 0
  const sentBackCount = sentBackCountRes.count ?? 0
  const myInboxCount = myInboxAllRes.count ?? 0

  // Average days to sign over last 30 days of signed cases.
  let avgCycleLabel = '—'
  const cyc = (avgCycleRes.data ?? []) as Array<{ created_at: string | null; signed_at: string | null }>
  const diffs: number[] = []
  for (const r of cyc) {
    if (r.created_at && r.signed_at) {
      const a = new Date(r.created_at).getTime()
      const b = new Date(r.signed_at).getTime()
      if (!Number.isNaN(a) && !Number.isNaN(b) && b >= a) {
        diffs.push((b - a) / (1000 * 60 * 60 * 24))
      }
    }
  }
  if (diffs.length > 0) {
    const avg = diffs.reduce((s, x) => s + x, 0) / diffs.length
    // Format with Arabic-Indic digits via Intl.
    try {
      avgCycleLabel = new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 1 }).format(avg)
    } catch {
      avgCycleLabel = avg.toFixed(1)
    }
  }

  // Group cases by status for the kanban.
  const byStatus = new Map<string, CaseRow[]>()
  for (const col of PIPELINE_COLUMNS) byStatus.set(col.key, [])
  for (const c of cases) {
    const bucket = byStatus.get(c.status)
    if (bucket) bucket.push(c)
  }
  // Trim signed to 10 most recent.
  const signedAll = byStatus.get('signed') ?? []
  byStatus.set('signed', signedAll.slice(0, 10))

  const audit = (auditRes.data ?? []) as AuditRow[]

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      {/* Welcome header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
            <LayoutDashboard className="w-4 h-4" aria-hidden="true" />
            الصرف
          </div>
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            {fullName ? `مرحبًا، ${fullName}` : 'مرحبًا بك'}
          </h1>
          <p className="text-sm text-slate-600">نظرة عامة على سندات الصرف</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/app/disbursements/new"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            سند صرف جديد
          </Link>
          <Link
            href="/app/disbursements/admin"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 transition"
          >
            <Settings className="w-4 h-4" aria-hidden="true" />
            إدارة
          </Link>
        </div>
      </header>

      {/* Filters — URL-driven; affects the cases query above and the
          inline-kanban / list below. KPIs stay tenant-wide for context. */}
      <CaseFiltersBar
        clients={clientOptions}
        projects={projectOptions}
        employees={employeeOptions}
      />

      {/* KPI strip */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          label="في صندوقي"
          value={String(myInboxCount)}
          hint={roleLabelAr(dsbRole)}
        />
        <KpiCard label="إجمالي النشطة" value={String(activeCount)} />
        <KpiCard label="موقّعة هذا الشهر" value={String(signedThisMonthCount)} />
        <KpiCard
          label="أعيدت إلى المطور"
          value={String(sentBackCount)}
          tone={sentBackCount > 0 ? 'red' : 'default'}
        />
        <KpiCard label="متوسط الزمن للتوقيع (يوم)" value={avgCycleLabel} />
      </section>

      {/* Kanban + Activity feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Kanban */}
        <section className="lg:col-span-2 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-slate-100">
            <h2 className="serif font-bold text-lg text-slate-900">مسار السندات</h2>
            <Link
              href="/app/disbursements/board"
              className="inline-flex items-center text-xs font-semibold text-teal-700 hover:text-teal-800"
            >
              عرض اللوحة الكاملة ←
            </Link>
          </div>
          <div className="p-3 sm:p-4">
            {cases.length === 0 ? (
              <div className="text-center text-sm text-slate-500 py-10">
                لا يوجد سندات بعد.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                {PIPELINE_COLUMNS.map((col) => {
                  const items = byStatus.get(col.key) ?? []
                  return (
                    <div
                      key={col.key}
                      className="flex flex-col bg-slate-50/60 border border-slate-200 rounded-xl overflow-hidden min-h-[160px]"
                    >
                      <div className={`flex items-center justify-between gap-2 px-3 py-2 border-b ${col.headCls}`}>
                        <div className="text-xs font-bold truncate">{col.title}</div>
                        <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full bg-white/70 text-[11px] font-bold font-mono">
                          {items.length}
                        </span>
                      </div>
                      <div className="p-2 space-y-2 flex-1">
                        {items.length === 0 ? (
                          <div className="text-center text-xs text-slate-400 py-6">—</div>
                        ) : (
                          items.map((c) => {
                            const proj = single(c.project)
                            const dev = single(c.developer)
                            return (
                              <Link
                                key={c.id}
                                href={`/app/disbursements/${c.id}`}
                                className="block bg-white rounded-lg border border-slate-200 p-2.5 hover:border-teal-300 hover:shadow-sm transition"
                              >
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="font-mono text-[11px] text-slate-500 truncate">
                                    {c.case_number}
                                  </span>
                                </div>
                                {proj && (
                                  <div className="text-[11px] text-slate-500 truncate">
                                    <span className="font-mono">{proj.code}</span>
                                    <span className="text-slate-400"> · </span>
                                    <span>{proj.name_ar}</span>
                                  </div>
                                )}
                                {dev && (
                                  <div className="text-[11px] text-slate-400 truncate">
                                    {dev.company_name_ar}
                                  </div>
                                )}
                                {c.voucher_number_text && (
                                  <div className="text-xs text-slate-600 truncate mt-0.5">
                                    سند {c.voucher_number_text}
                                  </div>
                                )}
                                <div className="text-sm font-bold text-slate-900 mt-1">
                                  {fmtSar(c.amount_sar)}
                                </div>
                                <div className="text-[11px] text-slate-400 mt-0.5">
                                  {fmtDateTime(c.submitted_at ?? c.created_at)}
                                </div>
                              </Link>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {/* Activity feed */}
        <aside className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 sm:px-5 py-3 border-b border-slate-100">
            <Activity className="w-4 h-4 text-slate-500" aria-hidden="true" />
            <h2 className="serif font-bold text-lg text-slate-900">النشاط الأخير</h2>
          </div>
          {audit.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              لا يوجد نشاط حديث.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {audit.map((a) => {
                const c = single(a.case)
                const proj = c ? single(c.project) : null
                const ev = describeEvent(a.event, a.to_status)
                const EvIcon = ev.Icon
                return (
                  <li key={a.id} className="px-4 sm:px-5 py-3">
                    <div className="flex items-start gap-3">
                      <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full shrink-0 ${ev.iconCls}`}>
                        <EvIcon className="w-4 h-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {ev.label}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                          {c ? (
                            <Link
                              href={`/app/disbursements/${c.id}`}
                              className="font-mono text-teal-700 hover:text-teal-800"
                            >
                              {c.case_number}
                            </Link>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                          {proj && (
                            <>
                              <span className="text-slate-300">·</span>
                              <span className="truncate">{proj.name_ar}</span>
                            </>
                          )}
                          <span className="text-slate-300">·</span>
                          <span>{timeAgoAr(a.occurred_at)}</span>
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  )
}

function KpiCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'red'
}) {
  const tones = {
    default: 'bg-white border-slate-200',
    red: 'bg-red-50 border-red-200',
  }
  const valueCls = tone === 'red' ? 'text-red-800' : 'text-slate-900'
  return (
    <div className={`border rounded-xl p-4 ${tones[tone]}`}>
      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-1 truncate">{label}</div>
      <div className={`text-2xl font-bold truncate ${valueCls}`}>{value}</div>
      {hint && (
        <div className="text-[11px] text-slate-500 mt-1 truncate">{hint}</div>
      )}
    </div>
  )
}
