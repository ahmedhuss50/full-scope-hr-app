import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { Plus, Search, FolderKanban } from 'lucide-react'
import { assignedProjectIds } from '@/lib/dsb/access'

export const dynamic = 'force-dynamic'

// -----------------------------------------------------------------------------
// Dedicated projects picker page.
//
// The old admin landing page (/app/disbursements/admin) mixed projects with
// users, clients, and settings. This page is projects-only: search + card grid
// with per-project mini stats. Each card links into the project detail page.
// -----------------------------------------------------------------------------

type ProjectRow = {
  id: string
  code: string
  name_ar: string
  rega_license_no: string | null
  developer_id: string | null
  status: string | null
}

type DeveloperRow = { id: string; company_name_ar: string }

type ProjectStats = { units: number; sold: number; cases: number }

function statusPill(kind: 'ok' | 'admin' | 'construction'): { cls: string; label: string } {
  // Compliance thresholds aren't wired here yet — every project reads as
  // 'منتظم' until we have the summary numbers in the projects table. Keep
  // the classes for the other two so wiring them later is one-liner.
  switch (kind) {
    case 'admin':
      return { cls: 'bg-amber-50 text-amber-800 ring-amber-200', label: 'تجاوز إداري' }
    case 'construction':
      return { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'تجاوز إنشائي' }
    default:
      return { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'منتظم' }
  }
}

export default async function ProjectsListPage({
  searchParams,
}: {
  searchParams?: { q?: string }
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
  if (!dsbRole || !['employee', 'supervisor', 'owner'].includes(dsbRole)) {
    redirect('/app/disbursements')
  }
  const isOwner = dsbRole === 'owner'
  const tenantId = profile.tenant_id as string
  const currentUserId = profile.id as string

  // Owner sees every project; scoped roles only those in the junction.
  const allowedProjectIds = await assignedProjectIds({
    svc,
    tenantId,
    userId: currentUserId,
    dsbRole,
  })

  let projectsQuery = svc
    .from('dsb_projects')
    .select('id, code, name_ar, rega_license_no, developer_id, status')
    .eq('tenant_id', tenantId)
    .order('name_ar', { ascending: true })

  if (allowedProjectIds !== null) {
    // Empty allowed list still needs to force a no-match — .in([]) returns
    // everything on some clients, so slot the impossible sentinel.
    projectsQuery = projectsQuery.in(
      'id',
      allowedProjectIds.length > 0 ? allowedProjectIds : ['00000000-0000-0000-0000-000000000000'],
    )
  }

  const { data: projectsData } = await projectsQuery
  const allProjects = (projectsData ?? []) as ProjectRow[]

  // Filter by ?q= — in-page filter over name_ar / code / rega_license_no.
  const rawQuery = (searchParams?.q ?? '').trim()
  const needle = rawQuery.toLowerCase()
  const projects = needle
    ? allProjects.filter((p) => {
        return (
          (p.name_ar ?? '').toLowerCase().includes(needle) ||
          (p.code ?? '').toLowerCase().includes(needle) ||
          (p.rega_license_no ?? '').toLowerCase().includes(needle)
        )
      })
    : allProjects

  // Developer names for the sub-title.
  const developerIds = Array.from(
    new Set(projects.map((p) => p.developer_id).filter((id): id is string => !!id)),
  )
  const developerNameById = new Map<string, string>()
  if (developerIds.length > 0) {
    const { data: devRows } = await svc
      .from('dsb_developers')
      .select('id, company_name_ar')
      .in('id', developerIds)
    for (const d of (devRows ?? []) as DeveloperRow[]) {
      developerNameById.set(d.id, d.company_name_ar)
    }
  }

  // Batch mini-stats: one query per collection filtered by all project ids.
  // Aggregation happens in memory — cheaper than N queries per project.
  const projectIds = projects.map((p) => p.id)
  const statsByProjectId = new Map<string, ProjectStats>()
  for (const id of projectIds) statsByProjectId.set(id, { units: 0, sold: 0, cases: 0 })

  if (projectIds.length > 0) {
    const [unitsRes, salesRes, casesRes] = await Promise.all([
      svc
        .from('dsb_project_units')
        .select('project_id')
        .eq('tenant_id', tenantId)
        .in('project_id', projectIds),
      svc
        .from('dsb_unit_sales')
        .select('project_id')
        .eq('tenant_id', tenantId)
        .eq('sale_status', 'active')
        .in('project_id', projectIds),
      svc
        .from('dsb_cases')
        .select('project_id')
        .eq('tenant_id', tenantId)
        .in('project_id', projectIds),
    ])

    for (const row of (unitsRes.data ?? []) as { project_id: string }[]) {
      const s = statsByProjectId.get(row.project_id)
      if (s) s.units += 1
    }
    for (const row of (salesRes.data ?? []) as { project_id: string }[]) {
      const s = statsByProjectId.get(row.project_id)
      if (s) s.sold += 1
    }
    for (const row of (casesRes.data ?? []) as { project_id: string }[]) {
      const s = statsByProjectId.get(row.project_id)
      if (s) s.cases += 1
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">المشاريع</h1>
          <p className="text-sm text-slate-500 mt-1">اختر مشروعًا لعرض تفاصيله</p>
        </div>
        {isOwner && (
          <Link
            href="/app/disbursements/admin/projects/new"
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 shadow-sm"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            إضافة مشروع
          </Link>
        )}
      </div>

      {/* Search — plain GET form so the URL carries ?q=… and the server
          re-renders with the filter applied. No JS needed. */}
      <form method="get" className="relative max-w-md">
        <span className="absolute inset-y-0 start-3 flex items-center pointer-events-none text-slate-400">
          <Search className="w-4 h-4" aria-hidden="true" />
        </span>
        <input
          type="search"
          name="q"
          defaultValue={rawQuery}
          placeholder="ابحث بالاسم، الرمز، أو رقم الرخصة"
          className="w-full ps-10 pe-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        />
      </form>

      {/* Empty state */}
      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
            <FolderKanban className="w-6 h-6" aria-hidden="true" />
          </div>
          {rawQuery ? (
            <p className="text-sm text-slate-600">
              لا توجد نتائج مطابقة لبحثك «{rawQuery}».
            </p>
          ) : (
            <>
              <p className="text-sm text-slate-700 font-medium mb-3">
                لا توجد مشاريع بعد. أضِف مشروعك الأول.
              </p>
              {isOwner && (
                <Link
                  href="/app/disbursements/admin/projects/new"
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 shadow-sm"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  إضافة مشروع
                </Link>
              )}
            </>
          )}
        </div>
      ) : (
        <ul className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const stats = statsByProjectId.get(p.id) ?? { units: 0, sold: 0, cases: 0 }
            const developerName = p.developer_id ? developerNameById.get(p.developer_id) ?? null : null
            // Placeholder — always 'منتظم' until compliance thresholds
            // land on dsb_projects (see statusPill comment).
            const pill = statusPill('ok')
            return (
              <li key={p.id}>
                <Link
                  href={`/app/disbursements/admin/projects/${p.id}`}
                  className="group block h-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-teal-300 hover:shadow transition"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-slate-900 group-hover:text-teal-600 truncate">
                        {p.name_ar}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 mt-0.5 truncate">
                        {p.code}
                        {p.rega_license_no ? ` · رخصة ${p.rega_license_no}` : ''}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ring-inset ${pill.cls}`}
                    >
                      {pill.label}
                    </span>
                  </div>

                  {developerName && (
                    <div className="text-xs text-slate-500 mb-3 truncate">
                      {developerName}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100">
                    <MiniStat label="عدد الوحدات" value={stats.units} />
                    <MiniStat label="المباعة" value={stats.sold} />
                    <MiniStat label="عدد الطلبات" value={stats.cases} />
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold text-slate-900 leading-none">{value}</div>
      <div className="text-[10px] text-slate-500 mt-1">{label}</div>
    </div>
  )
}
