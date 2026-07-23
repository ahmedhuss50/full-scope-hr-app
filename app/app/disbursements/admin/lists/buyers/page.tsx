import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Users } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ListToolbar, SortHeader, buildSortHref } from '../_shared/ListControls'

/**
 * Tenant-wide BUYERS list.
 * -----------------------------------------------------------------------
 * One row per `dsb_unit_sales` where buyer_name_ar is not null. Filters +
 * search + sort work the same way as the units list. Row → project page
 * scrolled to the unit.
 */
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100
const SORT_KEYS = ['buyer_name_ar', 'sale_date'] as const
type SortKey = (typeof SORT_KEYS)[number]
type SortDir = 'asc' | 'desc'

const SALE_STATUS_OPTIONS = [
  { value: 'active', label: 'نشط' },
  { value: 'cancelled', label: 'ملغي' },
  { value: 'cancelled_resold', label: 'ملغي/معاد' },
  { value: 'completed', label: 'منجز' },
]

type SaleRowRaw = {
  id: string
  unit_id: string
  sale_status: string
  sale_date: string | null
  buyer_name_ar: string | null
  buyer_id_type: string | null
  buyer_id_number: string | null
  buyer_nationality: string | null
  buyer_phone: string | null
}

function idTypeLabel(t: string | null): string {
  if (t === 'national') return 'وطنية'
  if (t === 'residency') return 'إقامة'
  if (t === 'passport') return 'جواز'
  return '—'
}

function escapeOrTerm(s: string): string {
  // See units/page.tsx for rationale — .or() splits on commas + parens.
  return s.replace(/[,()]/g, ' ').trim()
}

function saleStatusLabel(s: string): { cls: string; label: string } {
  switch (s) {
    case 'active':
      return { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'نشط' }
    case 'cancelled':
      return { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'ملغي' }
    case 'cancelled_resold':
      return { cls: 'bg-amber-50 text-amber-800 ring-amber-200', label: 'ملغي/معاد' }
    case 'completed':
      return { cls: 'bg-blue-50 text-blue-700 ring-blue-200', label: 'منجز' }
    default:
      return { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: s }
  }
}

export default async function BuyersListPage({
  searchParams,
}: {
  searchParams?: {
    page?: string
    q?: string
    project?: string
    sale_status?: string
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

  // ---- URL params ----
  const q = (searchParams?.q ?? '').trim()
  const projectFilter = (searchParams?.project ?? '').trim()
  const saleStatusFilter = (searchParams?.sale_status ?? '').trim()
  const rawSort = (searchParams?.sort ?? 'buyer_name_ar') as SortKey
  const sort: SortKey = SORT_KEYS.includes(rawSort) ? rawSort : 'buyer_name_ar'
  const dir: SortDir = searchParams?.dir === 'desc' ? 'desc' : 'asc'
  const rawPage = Number.parseInt(searchParams?.page ?? '1', 10)
  const requestedPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1

  // ---- Project + developer lookups ----
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

  // Filter by project → restrict the unit_ids we'll pull sales for.
  let unitIdFilter: string[] | null = null
  if (projectFilter) {
    const { data: unitsInProject } = await svc
      .from('dsb_project_units')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('project_id', projectFilter)
    unitIdFilter = ((unitsInProject ?? []) as Array<{ id: string }>).map((u) => u.id)
    if (unitIdFilter.length === 0) unitIdFilter = ['00000000-0000-0000-0000-000000000000']
  }

  // ---- Fetch sales (one row per buyer) ----
  let salesQuery = svc
    .from('dsb_unit_sales')
    .select(
      'id, unit_id, sale_status, sale_date, buyer_name_ar, buyer_id_type, buyer_id_number, buyer_nationality, buyer_phone',
    )
    .eq('tenant_id', tenantId)
    .not('buyer_name_ar', 'is', null)

  if (unitIdFilter) salesQuery = salesQuery.in('unit_id', unitIdFilter)
  if (saleStatusFilter) salesQuery = salesQuery.eq('sale_status', saleStatusFilter)
  if (q) {
    const esc = escapeOrTerm(q)
    salesQuery = salesQuery.or(
      `buyer_name_ar.ilike.%${esc}%,buyer_id_number.ilike.%${esc}%,buyer_phone.ilike.%${esc}%`,
    )
  }

  const { data: salesData } = await salesQuery
  const allSales = (salesData ?? []) as SaleRowRaw[]

  // ---- Load matching unit rows so we can render project + unit_number ----
  const unitIds = Array.from(new Set(allSales.map((s) => s.unit_id)))
  const unitById = new Map<string, { id: string; unit_number: string; project_id: string }>()
  if (unitIds.length > 0) {
    const CHUNK = 300
    for (let i = 0; i < unitIds.length; i += CHUNK) {
      const slice = unitIds.slice(i, i + CHUNK)
      const { data: unitData } = await svc
        .from('dsb_project_units')
        .select('id, unit_number, project_id')
        .eq('tenant_id', tenantId)
        .in('id', slice)
      for (const u of ((unitData ?? []) as Array<{
        id: string
        unit_number: string
        project_id: string
      }>)) {
        unitById.set(u.id, u)
      }
    }
  }

  // ---- Sort in memory ----
  const sortMul = dir === 'asc' ? 1 : -1
  const sorted = [...allSales].sort((a, b) => {
    if (sort === 'buyer_name_ar') {
      const av = a.buyer_name_ar ?? ''
      const bv = b.buyer_name_ar ?? ''
      return av.localeCompare(bv, 'ar') * sortMul
    }
    // sale_date — nulls last regardless of direction
    const av = a.sale_date ?? ''
    const bv = b.sale_date ?? ''
    if (!av && !bv) return 0
    if (!av) return 1
    if (!bv) return -1
    return av.localeCompare(bv) * sortMul
  })

  const totalCount = sorted.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const page = Math.min(requestedPage, totalPages)
  const pageStart = (page - 1) * PAGE_SIZE
  const pageRows = sorted.slice(pageStart, pageStart + PAGE_SIZE)

  const basePath = '/app/disbursements/admin/lists/buyers'
  const baseParams = new URLSearchParams()
  if (q) baseParams.set('q', q)
  if (projectFilter) baseParams.set('project', projectFilter)
  if (saleStatusFilter) baseParams.set('sale_status', saleStatusFilter)
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
          <Users className="w-4 h-4" aria-hidden="true" />
          قائمة المشترين
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="serif font-black text-2xl tracking-tight text-slate-900">
            المشترون
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
        searchPlaceholder="بحث بالاسم أو رقم الهوية أو الجوال…"
        extraSelects={[
          {
            name: 'sale_status',
            label: 'كل حالات البيع',
            value: saleStatusFilter,
            options: SALE_STATUS_OPTIONS,
          },
        ]}
        preservedParams={{ sort, dir }}
      />

      {pageRows.length === 0 ? (
        <div className="text-sm text-slate-500 italic text-center py-12 border border-dashed border-slate-200 rounded-xl bg-white">
          {allSales.length === 0 ? 'لا يوجد مشترون مطابقون.' : 'الصفحة فارغة.'}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-right">
                  <SortHeader
                    label="اسم المشتري"
                    sortKey="buyer_name_ar"
                    currentSort={sort}
                    currentDir={dir}
                    basePath={basePath}
                    otherParams={{
                      q,
                      project: projectFilter,
                      sale_status: saleStatusFilter,
                    }}
                  />
                  <Th>نوع الهوية</Th>
                  <Th>رقم الهوية</Th>
                  <Th>الجنسية</Th>
                  <Th>الجوال</Th>
                  <Th>المشروع</Th>
                  <Th>رقم الوحدة</Th>
                  <SortHeader
                    label="تاريخ البيع"
                    sortKey="sale_date"
                    currentSort={sort}
                    currentDir={dir}
                    basePath={basePath}
                    otherParams={{
                      q,
                      project: projectFilter,
                      sale_status: saleStatusFilter,
                    }}
                  />
                  <Th>حالة البيع</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.map((s) => {
                  const unit = unitById.get(s.unit_id)
                  const project = unit ? projectById.get(unit.project_id) : undefined
                  const href = unit
                    ? `/app/disbursements/admin/projects/${unit.project_id}#unit-${encodeURIComponent(unit.unit_number)}`
                    : '#'
                  const status = saleStatusLabel(s.sale_status)
                  return (
                    <tr key={s.id} className="hover:bg-slate-50 transition">
                      <Td className="max-w-[14rem] truncate">
                        <Link
                          href={href}
                          className="text-teal-700 hover:text-teal-900 hover:underline"
                        >
                          {s.buyer_name_ar ?? '—'}
                        </Link>
                      </Td>
                      <Td>{idTypeLabel(s.buyer_id_type)}</Td>
                      <Td className="font-mono text-xs" dir="ltr">
                        {s.buyer_id_number ?? '—'}
                      </Td>
                      <Td className="max-w-[8rem] truncate">
                        {s.buyer_nationality ?? '—'}
                      </Td>
                      <Td className="font-mono text-xs" dir="ltr">
                        {s.buyer_phone ?? '—'}
                      </Td>
                      <Td className="max-w-[12rem] truncate">
                        {project?.name_ar ?? '—'}
                      </Td>
                      <Td className="font-mono text-xs">
                        {unit?.unit_number ?? '—'}
                      </Td>
                      <Td className="font-mono text-xs" dir="ltr">
                        {s.sale_date ?? '—'}
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${status.cls}`}
                        >
                          {status.label}
                        </span>
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
