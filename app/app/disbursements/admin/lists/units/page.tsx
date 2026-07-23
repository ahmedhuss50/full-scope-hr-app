import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Building2 } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ListToolbar, SortHeader, buildSortHref } from '../_shared/ListControls'

/**
 * Tenant-wide UNITS list.
 * -----------------------------------------------------------------------
 * Rows: one per dsb_project_units row across all projects.
 * Columns: unit_number | block | zone | type | area | district | city
 *          | project | developer | sales_count.
 * Filters: project dropdown.  Search: unit_number / notes.
 * Sort: unit_number | area_m2 | sales_count.
 * Row click → /admin/projects/{projectId}#unit-{unit_number}.
 *
 * Pagination: URL ?page=n, 100 rows per page. We fetch ALL matching rows
 * for the tenant (typically ~600) then sort + slice in memory — cheaper
 * than a two-query per-column-sort dance and keeps the sales-count sort
 * trivial.
 */
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100
const SORT_KEYS = ['unit_number', 'area_m2', 'sales_count'] as const
type SortKey = (typeof SORT_KEYS)[number]
type SortDir = 'asc' | 'desc'

type UnitRowRaw = {
  id: string
  project_id: string
  unit_number: string
  zone_number: string | null
  block_number: string | null
  unit_type: string | null
  area_m2: number | null
  district: string | null
  city: string | null
  region: string | null
  notes: string | null
}

function unitTypeLabel(t: string | null): string {
  if (t === 'villa') return 'فيلا'
  if (t === 'apartment') return 'شقة'
  if (t === 'other') return 'أخرى'
  return '—'
}

/**
 * PostgREST's .or() uses commas as delimiters and parens for grouping.
 * A user-typed search string with either character breaks parsing and,
 * worst-case, could smuggle in extra clauses. Strip both — legitimate
 * unit numbers and buyer names never need them.
 */
function escapeOrTerm(s: string): string {
  return s.replace(/[,()]/g, ' ').trim()
}

export default async function UnitsListPage({
  searchParams,
}: {
  searchParams?: {
    page?: string
    q?: string
    project?: string
    sort?: string
    dir?: string
  }
}) {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) redirect('/login')
  if (profile.dsb_role !== 'owner') redirect('/app/disbursements/admin')

  const tenantId = profile.tenant_id as string

  // ---- URL params (validated) ----
  const q = (searchParams?.q ?? '').trim()
  const projectFilter = (searchParams?.project ?? '').trim()
  const rawSort = (searchParams?.sort ?? 'unit_number') as SortKey
  const sort: SortKey = SORT_KEYS.includes(rawSort) ? rawSort : 'unit_number'
  const dir: SortDir = searchParams?.dir === 'desc' ? 'desc' : 'asc'
  const rawPage = Number.parseInt(searchParams?.page ?? '1', 10)
  const requestedPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1

  // ---- Project + developer lookups (once, tenant-wide) ----
  const { data: projRows } = await svc
    .from('dsb_projects')
    .select('id, name_ar, developer_id')
    .eq('tenant_id', tenantId)
    .order('name_ar', { ascending: true })
  const projects = ((projRows ?? []) as Array<{
    id: string
    name_ar: string
    developer_id: string | null
  }>)
  const projectById = new Map(projects.map((p) => [p.id, p]))

  const developerIds = Array.from(
    new Set(projects.map((p) => p.developer_id).filter((x): x is string => !!x)),
  )
  const developerNameById = new Map<string, string>()
  if (developerIds.length > 0) {
    const { data: devRows } = await svc
      .from('dsb_developers')
      .select('id, company_name_ar')
      .eq('tenant_id', tenantId)
      .in('id', developerIds)
    for (const d of ((devRows ?? []) as Array<{ id: string; company_name_ar: string }>)) {
      developerNameById.set(d.id, d.company_name_ar)
    }
  }

  // ---- Fetch all matching units for the tenant, filtered + searched ----
  let unitQuery = svc
    .from('dsb_project_units')
    .select(
      'id, project_id, unit_number, zone_number, block_number, unit_type, area_m2, district, city, region, notes',
    )
    .eq('tenant_id', tenantId)

  if (projectFilter) unitQuery = unitQuery.eq('project_id', projectFilter)
  if (q) {
    const esc = escapeOrTerm(q)
    unitQuery = unitQuery.or(`unit_number.ilike.%${esc}%,notes.ilike.%${esc}%`)
  }

  const { data: unitData } = await unitQuery
  const allUnits = (unitData ?? []) as UnitRowRaw[]

  // ---- Sales counts (one query, bounded by the filtered unit list) ----
  const salesCountByUnit = new Map<string, number>()
  if (allUnits.length > 0) {
    const CHUNK = 300
    for (let i = 0; i < allUnits.length; i += CHUNK) {
      const ids = allUnits.slice(i, i + CHUNK).map((u) => u.id)
      const { data: salesData } = await svc
        .from('dsb_unit_sales')
        .select('unit_id')
        .eq('tenant_id', tenantId)
        .in('unit_id', ids)
      for (const s of ((salesData ?? []) as Array<{ unit_id: string }>)) {
        salesCountByUnit.set(s.unit_id, (salesCountByUnit.get(s.unit_id) ?? 0) + 1)
      }
    }
  }

  // ---- Sort in memory ----
  const sortMul = dir === 'asc' ? 1 : -1
  const sorted = [...allUnits].sort((a, b) => {
    if (sort === 'unit_number') {
      return a.unit_number.localeCompare(b.unit_number, 'ar', { numeric: true }) * sortMul
    }
    if (sort === 'area_m2') {
      const av = a.area_m2 ?? -Infinity
      const bv = b.area_m2 ?? -Infinity
      return (av - bv) * sortMul
    }
    // sales_count
    const av = salesCountByUnit.get(a.id) ?? 0
    const bv = salesCountByUnit.get(b.id) ?? 0
    return (av - bv) * sortMul
  })

  const totalCount = sorted.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const page = Math.min(requestedPage, totalPages)
  const pageStart = (page - 1) * PAGE_SIZE
  const pageRows = sorted.slice(pageStart, pageStart + PAGE_SIZE)

  const basePath = '/app/disbursements/admin/lists/units'
  const baseParams = new URLSearchParams()
  if (q) baseParams.set('q', q)
  if (projectFilter) baseParams.set('project', projectFilter)
  baseParams.set('sort', sort)
  baseParams.set('dir', dir)

  return (
    <div className="space-y-6 max-w-7xl mx-auto" dir="rtl">
      <header className="space-y-2">
        <Link
          href="/app/disbursements/admin/lists"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          <ArrowRight className="w-3.5 h-3.5 ms-1 rotate-180" aria-hidden="true" />
          العودة إلى القوائم
        </Link>
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <Building2 className="w-4 h-4" aria-hidden="true" />
          قائمة الوحدات
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="serif font-black text-2xl tracking-tight text-slate-900">
            الوحدات
          </h1>
          <span className="text-sm text-slate-400 font-mono">
            ({totalCount.toLocaleString('en-US')})
          </span>
        </div>
      </header>

      <ListToolbar
        basePath={basePath}
        q={q}
        projectFilter={projectFilter}
        projects={projects.map((p) => ({ id: p.id, name_ar: p.name_ar }))}
        searchPlaceholder="بحث برقم الوحدة أو الملاحظات…"
        preservedParams={{ sort, dir }}
      />

      {pageRows.length === 0 ? (
        <div className="text-sm text-slate-500 italic text-center py-12 border border-dashed border-slate-200 rounded-xl bg-white">
          {allUnits.length === 0 ? 'لا توجد وحدات مطابقة.' : 'الصفحة فارغة.'}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-right">
                  <SortHeader
                    label="رقم الوحدة"
                    sortKey="unit_number"
                    currentSort={sort}
                    currentDir={dir}
                    basePath={basePath}
                    otherParams={{ q, project: projectFilter }}
                  />
                  <Th>البلوك</Th>
                  <Th>ZONE</Th>
                  <Th>نوع الوحدة</Th>
                  <SortHeader
                    label="المساحة"
                    sortKey="area_m2"
                    currentSort={sort}
                    currentDir={dir}
                    basePath={basePath}
                    otherParams={{ q, project: projectFilter }}
                  />
                  <Th>الحي</Th>
                  <Th>المدينة</Th>
                  <Th>المشروع</Th>
                  <Th>العميل</Th>
                  <SortHeader
                    label="# المبيعات"
                    sortKey="sales_count"
                    currentSort={sort}
                    currentDir={dir}
                    basePath={basePath}
                    otherParams={{ q, project: projectFilter }}
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.map((u) => {
                  const project = projectById.get(u.project_id)
                  const devName = project?.developer_id
                    ? developerNameById.get(project.developer_id) ?? '—'
                    : '—'
                  const salesCount = salesCountByUnit.get(u.id) ?? 0
                  const href = `/app/disbursements/admin/projects/${u.project_id}#unit-${encodeURIComponent(u.unit_number)}`
                  return (
                    <tr key={u.id} className="hover:bg-slate-50 transition">
                      <Td>
                        <Link
                          href={href}
                          className="font-mono text-xs text-teal-700 hover:text-teal-900 hover:underline"
                        >
                          {u.unit_number}
                        </Link>
                      </Td>
                      <Td>{u.block_number ?? '—'}</Td>
                      <Td>{u.zone_number ?? '—'}</Td>
                      <Td>{unitTypeLabel(u.unit_type)}</Td>
                      <Td className="font-mono text-xs" dir="ltr">
                        {u.area_m2 != null ? u.area_m2 : '—'}
                      </Td>
                      <Td className="max-w-[10rem] truncate">{u.district ?? '—'}</Td>
                      <Td className="max-w-[10rem] truncate">{u.city ?? '—'}</Td>
                      <Td className="max-w-[14rem] truncate">
                        {project?.name_ar ?? '—'}
                      </Td>
                      <Td className="max-w-[14rem] truncate">{devName}</Td>
                      <Td className="font-mono text-xs">
                        {salesCount > 0 ? salesCount : '—'}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            basePath={basePath}
            baseParams={baseParams}
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Presentation helpers (kept local; not worth another shared file)
// ---------------------------------------------------------------------------

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  )
}

function Td({ children, className, dir }: { children: React.ReactNode; className?: string; dir?: string }) {
  return (
    <td className={`px-3 py-2 text-sm text-slate-700 align-top ${className ?? ''}`} dir={dir}>
      {children}
    </td>
  )
}

function Pagination({
  basePath,
  baseParams,
  page,
  totalPages,
  totalCount,
}: {
  basePath: string
  baseParams: URLSearchParams
  page: number
  totalPages: number
  totalCount: number
}) {
  const prevHref = buildSortHref(basePath, baseParams, { page: String(Math.max(1, page - 1)) })
  const nextHref = buildSortHref(basePath, baseParams, {
    page: String(Math.min(totalPages, page + 1)),
  })
  const first = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const last = Math.min(totalCount, page * PAGE_SIZE)

  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-100 text-xs text-slate-600 flex-wrap">
      <div>
        عرض {first}–{last} من {totalCount.toLocaleString('en-US')}
      </div>
      <div className="inline-flex items-center gap-2">
        <Link
          href={prevHref}
          aria-disabled={page <= 1}
          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-white font-semibold hover:bg-slate-50 transition ${page <= 1 ? 'pointer-events-none opacity-40' : ''}`}
        >
          السابق
        </Link>
        <span className="font-mono">
          {page} / {totalPages}
        </span>
        <Link
          href={nextHref}
          aria-disabled={page >= totalPages}
          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-white font-semibold hover:bg-slate-50 transition ${page >= totalPages ? 'pointer-events-none opacity-40' : ''}`}
        >
          التالي
        </Link>
      </div>
    </div>
  )
}
