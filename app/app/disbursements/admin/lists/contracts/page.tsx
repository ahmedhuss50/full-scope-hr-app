import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, FileSignature } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ListToolbar, SortHeader, buildSortHref } from '../_shared/ListControls'

/**
 * Tenant-wide CONTRACTS list.
 * -----------------------------------------------------------------------
 * One row per `dsb_unit_sales` (we treat each sale record as a contract,
 * since contract_number lives on the sale). Financial columns from
 * migration 055 (retention %, collection %) are surfaced here — this is
 * the primary place the owner reviews payment progress.
 */
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100
const SORT_KEYS = ['contract_number', 'sale_date', 'price_before_tax_sar'] as const
type SortKey = (typeof SORT_KEYS)[number]
type SortDir = 'asc' | 'desc'

type SaleRowRaw = {
  id: string
  unit_id: string
  buyer_name_ar: string | null
  contract_number: string | null
  contract_type: string | null
  financing_type: string | null
  financing_bank: string | null
  sale_date: string | null
  price_before_tax_sar: number | null
  vat_sar: number | null
  price_with_vat_sar: number | null
  delivery_status: string | null
  delivery_date: string | null
  installment_number: number | null
  retention_percentage: number | null
  collection_percentage: number | null
}

// Distinct financing_type values found in the tenant's data — used to
// populate the filter dropdown so it never lists options that don't
// exist for this tenant.
async function fetchFinancingTypes(
  svc: ReturnType<typeof createSupabaseService>,
  tenantId: string,
): Promise<string[]> {
  const { data } = await svc
    .from('dsb_unit_sales')
    .select('financing_type')
    .eq('tenant_id', tenantId)
    .not('financing_type', 'is', null)
  const set = new Set<string>()
  for (const r of ((data ?? []) as Array<{ financing_type: string | null }>)) {
    if (r.financing_type) set.add(r.financing_type)
  }
  return Array.from(set).sort()
}

function escapeOrTerm(s: string): string {
  // See units/page.tsx for rationale — .or() splits on commas + parens.
  return s.replace(/[,()]/g, ' ').trim()
}

function fmtNum(v: number | null): string {
  if (v === null) return '—'
  const n = Math.round(v)
  if (Math.abs(v - n) < 0.005) return n.toLocaleString('en-US')
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function fmtPct(v: number | null): string {
  if (v === null) return '—'
  const pct = Math.abs(v) <= 1 ? v * 100 : v
  return `${pct.toFixed(pct >= 100 ? 0 : 1)}%`
}

function deliveryLabel(status: string | null, date: string | null): string {
  if (status === 'delivered') return date ? `مُسلَّمة (${date})` : 'مُسلَّمة'
  if (status === 'pending') return 'بانتظار'
  if (status === 'other') return 'أخرى'
  return status ?? '—'
}

export default async function ContractsListPage({
  searchParams,
}: {
  searchParams?: {
    page?: string
    q?: string
    project?: string
    financing_type?: string
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
  const financingFilter = (searchParams?.financing_type ?? '').trim()
  const rawSort = (searchParams?.sort ?? 'contract_number') as SortKey
  const sort: SortKey = SORT_KEYS.includes(rawSort) ? rawSort : 'contract_number'
  const dir: SortDir = searchParams?.dir === 'desc' ? 'desc' : 'asc'
  const rawPage = Number.parseInt(searchParams?.page ?? '1', 10)
  const requestedPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1

  // ---- Project lookup ----
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

  // Restrict to units in the selected project, if any.
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

  // ---- Fetch sales / contracts ----
  let salesQuery = svc
    .from('dsb_unit_sales')
    .select(
      'id, unit_id, buyer_name_ar, contract_number, contract_type, financing_type, financing_bank, sale_date, price_before_tax_sar, vat_sar, price_with_vat_sar, delivery_status, delivery_date, installment_number, retention_percentage, collection_percentage',
    )
    .eq('tenant_id', tenantId)

  if (unitIdFilter) salesQuery = salesQuery.in('unit_id', unitIdFilter)
  if (financingFilter) salesQuery = salesQuery.eq('financing_type', financingFilter)
  if (q) {
    const esc = escapeOrTerm(q)
    salesQuery = salesQuery.or(
      `contract_number.ilike.%${esc}%,buyer_name_ar.ilike.%${esc}%`,
    )
  }

  const { data: salesData } = await salesQuery
  const allSales = (salesData ?? []) as SaleRowRaw[]

  // ---- Load matching units ----
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

  const financingTypes = await fetchFinancingTypes(svc, tenantId)

  // ---- Sort ----
  const sortMul = dir === 'asc' ? 1 : -1
  const sorted = [...allSales].sort((a, b) => {
    if (sort === 'contract_number') {
      const av = a.contract_number ?? ''
      const bv = b.contract_number ?? ''
      return av.localeCompare(bv, 'ar', { numeric: true }) * sortMul
    }
    if (sort === 'sale_date') {
      const av = a.sale_date ?? ''
      const bv = b.sale_date ?? ''
      if (!av && !bv) return 0
      if (!av) return 1
      if (!bv) return -1
      return av.localeCompare(bv) * sortMul
    }
    // price_before_tax_sar — nulls last.
    const av = a.price_before_tax_sar
    const bv = b.price_before_tax_sar
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return (av - bv) * sortMul
  })

  const totalCount = sorted.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const page = Math.min(requestedPage, totalPages)
  const pageStart = (page - 1) * PAGE_SIZE
  const pageRows = sorted.slice(pageStart, pageStart + PAGE_SIZE)

  const basePath = '/app/disbursements/admin/lists/contracts'
  const baseParams = new URLSearchParams()
  if (q) baseParams.set('q', q)
  if (projectFilter) baseParams.set('project', projectFilter)
  if (financingFilter) baseParams.set('financing_type', financingFilter)
  baseParams.set('sort', sort)
  baseParams.set('dir', dir)

  const otherParamsForSort = {
    q,
    project: projectFilter,
    financing_type: financingFilter,
  }

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
          <FileSignature className="w-4 h-4" aria-hidden="true" />
          قائمة العقود
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="serif font-black text-2xl tracking-tight text-slate-900">
            العقود
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
        searchPlaceholder="بحث برقم العقد أو اسم المشتري…"
        extraSelects={[
          {
            name: 'financing_type',
            label: 'كل أنواع التمويل',
            value: financingFilter,
            options: financingTypes.map((v) => ({ value: v, label: v })),
          },
        ]}
        preservedParams={{ sort, dir }}
      />

      {pageRows.length === 0 ? (
        <div className="text-sm text-slate-500 italic text-center py-12 border border-dashed border-slate-200 rounded-xl bg-white">
          {allSales.length === 0 ? 'لا توجد عقود مطابقة.' : 'الصفحة فارغة.'}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-right">
                  <SortHeader
                    label="رقم العقد"
                    sortKey="contract_number"
                    currentSort={sort}
                    currentDir={dir}
                    basePath={basePath}
                    otherParams={otherParamsForSort}
                  />
                  <Th>المشتري</Th>
                  <Th>المشروع</Th>
                  <Th>رقم الوحدة</Th>
                  <SortHeader
                    label="تاريخ البيع"
                    sortKey="sale_date"
                    currentSort={sort}
                    currentDir={dir}
                    basePath={basePath}
                    otherParams={otherParamsForSort}
                  />
                  <SortHeader
                    label="السعر"
                    sortKey="price_before_tax_sar"
                    currentSort={sort}
                    currentDir={dir}
                    basePath={basePath}
                    otherParams={otherParamsForSort}
                  />
                  <Th>ضريبة</Th>
                  <Th>الشامل</Th>
                  <Th>التمويل</Th>
                  <Th>البنك</Th>
                  <Th>تاريخ التسليم</Th>
                  <Th>حالة التسليم</Th>
                  <Th># الأقساط</Th>
                  <Th>النسبة المستقطعة</Th>
                  <Th>نسبة التحصيل</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.map((s) => {
                  const unit = unitById.get(s.unit_id)
                  const project = unit ? projectById.get(unit.project_id) : undefined
                  const href = unit
                    ? `/app/disbursements/admin/projects/${unit.project_id}#unit-${encodeURIComponent(unit.unit_number)}`
                    : '#'
                  return (
                    <tr key={s.id} className="hover:bg-slate-50 transition">
                      <Td className="font-mono text-xs">
                        <Link
                          href={href}
                          className="text-teal-700 hover:text-teal-900 hover:underline"
                        >
                          {s.contract_number ?? '—'}
                        </Link>
                      </Td>
                      <Td className="max-w-[12rem] truncate">
                        {s.buyer_name_ar ?? '—'}
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
                      <Td className="font-mono text-xs" dir="ltr">
                        {fmtNum(s.price_before_tax_sar)}
                      </Td>
                      <Td className="font-mono text-xs" dir="ltr">
                        {fmtNum(s.vat_sar)}
                      </Td>
                      <Td className="font-mono text-xs" dir="ltr">
                        {fmtNum(s.price_with_vat_sar)}
                      </Td>
                      <Td className="max-w-[10rem] truncate">
                        {s.financing_type ?? '—'}
                      </Td>
                      <Td className="max-w-[10rem] truncate">
                        {s.financing_bank ?? '—'}
                      </Td>
                      <Td className="font-mono text-xs" dir="ltr">
                        {s.delivery_date ?? '—'}
                      </Td>
                      <Td>{deliveryLabel(s.delivery_status, null)}</Td>
                      <Td className="font-mono text-xs" dir="ltr">
                        {s.installment_number ?? '—'}
                      </Td>
                      <Td className="font-mono text-xs" dir="ltr">
                        {fmtPct(s.retention_percentage)}
                      </Td>
                      <Td className="font-mono text-xs" dir="ltr">
                        {fmtPct(s.collection_percentage)}
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
