import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { LayoutDashboard } from 'lucide-react'
import { CaseFiltersBar } from '../CaseFiltersBar'

export const dynamic = 'force-dynamic'

type ProjectLite = { id: string; code: string; name_ar: string }
type DeveloperLite = { id: string; company_name_ar: string }

type CaseRow = {
  id: string
  case_number: string
  voucher_number_text: string | null
  amount_sar: number | null
  status: string
  submitted_at: string | null
  created_at: string
  project: ProjectLite | ProjectLite[] | null
  developer: DeveloperLite | DeveloperLite[] | null
}

function single<T>(maybe: T | T[] | null | undefined): T | null {
  if (!maybe) return null
  return Array.isArray(maybe) ? (maybe[0] ?? null) : maybe
}

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

function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(s))
  } catch {
    return s
  }
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

export default async function DisbursementsBoardPage({
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
  // Read-access only — viewer + deliverer can see the kanban too.
  if (!dsbRole || !['employee', 'supervisor', 'owner', 'viewer', 'deliverer'].includes(dsbRole)) {
    redirect('/app/disbursements')
  }

  const tenantId = profile.tenant_id as string

  // ---------- URL filter values (same shape as dashboard / archive) ----------
  // The board is intentionally status-grouped (each column IS a status), so
  // we do NOT honour a status filter here. The rest mirror the dashboard.
  const f = searchParams ?? {}
  const fClient   = (f.client   ?? '').trim() || null
  const fProject  = (f.project  ?? '').trim() || null
  const fEmployee = (f.employee ?? '').trim() || null
  const fFrom     = (f.from     ?? '').trim() || null
  const fTo       = (f.to       ?? '').trim() || null
  const fQ        = (f.q        ?? '').trim() || null

  // Resolve project IDs the employee filter restricts us to. An employee
  // can be linked to a project either via the legacy assigned_employee_id
  // column or via the dsb_project_employees junction (multi-assignment).
  let projectIdsForEmployee: string[] | null = null
  if (fEmployee) {
    const [{ data: legacyRows }, { data: junctionRows }] = await Promise.all([
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
    const set = new Set<string>()
    for (const r of (legacyRows ?? []) as { id: string }[]) set.add(r.id)
    for (const r of (junctionRows ?? []) as { project_id: string }[]) set.add(r.project_id)
    projectIdsForEmployee = Array.from(set)
  }

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

  // ---------- Cases query with filters applied ----------
  let casesQuery = svc
    .from('dsb_cases')
    .select(
      `id, case_number, voucher_number_text, amount_sar, status, submitted_at, created_at,
       project:dsb_projects!dsb_cases_project_id_fkey(id, code, name_ar),
       developer:dsb_developers!dsb_cases_developer_id_fkey(id, company_name_ar)`,
    )
    .eq('tenant_id', tenantId)
  if (fClient)  casesQuery = casesQuery.eq('developer_id', fClient)
  if (fProject) casesQuery = casesQuery.eq('project_id', fProject)
  if (fFrom)    casesQuery = casesQuery.gte('submitted_at', `${fFrom}T00:00:00+03`)
  if (fTo)      casesQuery = casesQuery.lte('submitted_at', `${fTo}T23:59:59+03`)
  if (fQ)       casesQuery = casesQuery.or(`case_number.ilike.%${fQ}%,voucher_number_text.ilike.%${fQ}%`)
  if (projectIdsForEmployee !== null) {
    // No projects matched the employee filter → force a no-match.
    const projectFilterIds =
      projectIdsForEmployee.length === 0
        ? ['00000000-0000-0000-0000-000000000000']
        : projectIdsForEmployee
    casesQuery = casesQuery.in('project_id', projectFilterIds)
  }
  const { data: casesData } = await casesQuery.order('created_at', { ascending: false })
  const cases = (casesData ?? []) as CaseRow[]

  // Group by pipeline column.
  const byStatus = new Map<string, CaseRow[]>()
  for (const col of PIPELINE_COLUMNS) byStatus.set(col.key, [])
  for (const c of cases) {
    const bucket = byStatus.get(c.status)
    if (bucket) bucket.push(c)
  }

  const totalCount = cases.length
  const signedCount = byStatus.get('signed')?.length ?? 0
  const sentBackCount = byStatus.get('sent_back_to_developer')?.length ?? 0

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      {/* Header */}
      <header className="space-y-3">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <LayoutDashboard className="w-4 h-4" aria-hidden="true" />
          لوحة المراحل
        </div>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
              لوحة الصرفيات
            </h1>
            <p className="text-sm text-slate-600">
              كل سندات الصرف في كل المشاريع، مرتبة حسب المرحلة.
            </p>
          </div>
          {/* Right-side stat strip */}
          <div className="shrink-0 flex items-center gap-2 flex-wrap">
            <div className="inline-flex flex-col items-center justify-center px-4 py-2 rounded-lg bg-white border border-slate-200 shadow-sm min-w-[5rem]">
              <span className="text-[11px] text-slate-500 font-semibold">إجمالي السندات</span>
              <span className="font-mono font-bold text-lg text-slate-900">{totalCount}</span>
            </div>
            <div className="inline-flex flex-col items-center justify-center px-4 py-2 rounded-lg bg-green-50 border border-green-200 shadow-sm min-w-[5rem]">
              <span className="text-[11px] text-green-700 font-semibold">موقّعة</span>
              <span className="font-mono font-bold text-lg text-green-800">{signedCount}</span>
            </div>
            <div className="inline-flex flex-col items-center justify-center px-4 py-2 rounded-lg bg-red-50 border border-red-200 shadow-sm min-w-[5rem]">
              <span className="text-[11px] text-red-700 font-semibold">أعيدت إلى المطور</span>
              <span className="font-mono font-bold text-lg text-red-800">{sentBackCount}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Filters — same URL-driven control used on the dashboard. Status is
          hidden here because the board IS grouped by status (each column). */}
      <CaseFiltersBar
        clients={clientOptions}
        projects={projectOptions}
        employees={employeeOptions}
        hideStatus
      />

      {/* Pipeline */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {PIPELINE_COLUMNS.map((col) => {
              const items = byStatus.get(col.key) ?? []
              return (
                <div
                  key={col.key}
                  className="flex flex-col bg-slate-50/60 border border-slate-200 rounded-xl overflow-hidden min-h-[160px]"
                >
                  <div
                    className={`flex items-center justify-between gap-2 px-3 py-2 border-b ${col.headCls}`}
                  >
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
                              {fmtDate(c.submitted_at ?? c.created_at)}
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
        </div>
      </section>
    </div>
  )
}
