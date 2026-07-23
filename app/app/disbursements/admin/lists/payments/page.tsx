import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Coins } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ListToolbar, SortHeader, buildSortHref } from '../_shared/ListControls'

/**
 * Tenant-wide PAYMENTS ledger.
 * -----------------------------------------------------------------------
 * Rows: one per dsb_payments (migration 056). Standalone financial
 * transactions independent of the case workflow. Filters by project /
 * account. Search matches reference_number / beneficiary_name /
 * description. Sortable by payment_date (default desc) or amount_sar.
 *
 * Same in-memory sort-then-slice pattern as the other three list pages —
 * a tenant typically has thousands of payments, not millions.
 * -----------------------------------------------------------------------
 * Owner-only.
 */
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100
const SORT_KEYS = ['payment_date', 'amount_sar'] as const
type SortKey = (typeof SORT_KEYS)[number]
type SortDir = 'asc' | 'desc'

type PaymentRowRaw = {
  id: string
  project_id: string | null
  account_id: string | null
  case_id: string | null
  unit_id: string | null
  payment_date: string
  amount_sar: number
  vat_sar: number | null
  currency: string
  beneficiary_name: string | null
  description: string | null
  reference_number: string | null
  payment_method: string | null
}

function escapeOrTerm(s: string): string {
  return s.replace(/[,()]/g, ' ').trim()
}

function fmtNum(v: number | null): string {
  if (v === null) return '—'
  const n = Math.round(v)
  if (Math.abs(v - n) < 0.005) return n.toLocaleString('en-US')
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export default async function PaymentsListPage({
  searchParams,
}: {
  searchParams?: {
    page?: string
    q?: string
    project?: string
    account?: string
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
  const accountFilter = (searchParams?.account ?? '').trim()
  const rawSort = (searchParams?.sort ?? 'payment_date') as SortKey
  const sort: SortKey = SORT_KEYS.includes(rawSort) ? rawSort : 'payment_date'
  // Default direction matches the user-preferred read: newest first.
  const rawDir = searchParams?.dir
  const dir: SortDir = rawDir === 'asc' ? 'asc' : 'desc'
  const rawPage = Number.parseInt(searchParams?.page ?? '1', 10)
  const requestedPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1

  // ---- Project + account dropdown options ----
  const [projRows, acctRows] = await Promise.all([
    svc
      .from('dsb_projects')
      .select('id, name_ar')
      .eq('tenant_id', tenantId)
      .order('name_ar', { ascending: true }),
    svc
      .from('dsb_project_accounts')
      .select('id, project_id, label, account_number')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('label', { ascending: true }),
  ])
  const projects = ((projRows.data ?? []) as Array<{ id: string; name_ar: string }>)
  const projectById = new Map(projects.map((p) => [p.id, p]))
  const accounts = ((acctRows.data ?? []) as Array<{
    id: string
    project_id: string
    label: string
    account_number: string | null
  }>)
  const accountById = new Map(accounts.map((a) => [a.id, a]))

  // ---- Fetch payments ----
  let paymentsQuery = svc
    .from('dsb_payments')
    .select(
      'id, project_id, account_id, case_id, unit_id, payment_date, amount_sar, vat_sar, currency, beneficiary_name, description, reference_number, payment_method',
    )
    .eq('tenant_id', tenantId)
  if (projectFilter) paymentsQuery = paymentsQuery.eq('project_id', projectFilter)
  if (accountFilter) paymentsQuery = paymentsQuery.eq('account_id', accountFilter)
  if (q) {
    const esc = escapeOrTerm(q)
    paymentsQuery = paymentsQuery.or(
      `reference_number.ilike.%${esc}%,beneficiary_name.ilike.%${esc}%,description.ilike.%${esc}%`,
    )
  }

  const { data: paymentsData } = await paymentsQuery
  const allPayments = (paymentsData ?? []) as PaymentRowRaw[]

  // ---- Case + unit lookups for the display columns ----
  const caseIds = Array.from(new Set(allPayments.map((p) => p.case_id).filter((x): x is string => !!x)))
  const unitIds = Array.from(new Set(allPayments.map((p) => p.unit_id).filter((x): x is string => !!x)))
  const caseNumberById = new Map<string, string>()
  if (caseIds.length > 0) {
    const CHUNK = 300
    for (let i = 0; i < caseIds.length; i += CHUNK) {
      const slice = caseIds.slice(i, i + CHUNK)
      const { data } = await svc
        .from('dsb_cases')
        .select('id, case_number')
        .eq('tenant_id', tenantId)
        .in('id', slice)
      for (const c of ((data ?? []) as Array<{ id: string; case_number: string }>)) {
        caseNumberById.set(c.id, c.case_number)
      }
    }
  }
  const unitNumberById = new Map<string, string>()
  if (unitIds.length > 0) {
    const CHUNK = 300
    for (let i = 0; i < unitIds.length; i += CHUNK) {
      const slice = unitIds.slice(i, i + CHUNK)
      const { data } = await svc
        .from('dsb_project_units')
        .select('id, unit_number')
        .eq('tenant_id', tenantId)
        .in('id', slice)
      for (const u of ((data ?? []) as Array<{ id: string; unit_number: string }>)) {
        unitNumberById.set(u.id, u.unit_number)
      }
    }
  }

  // ---- Sort ----
  const sortMul = dir === 'asc' ? 1 : -1
  const sorted = [...allPayments].sort((a, b) => {
    if (sort === 'amount_sar') {
      return (a.amount_sar - b.amount_sar) * sortMul
    }
    // payment_date — always defined (NOT NULL column). String compare on
    // YYYY-MM-DD is chronologically correct.
    return a.payment_date.localeCompare(b.payment_date) * sortMul
  })

  const totalCount = sorted.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const page = Math.min(requestedPage, totalPages)
  const pageStart = (page - 1) * PAGE_SIZE
  const pageRows = sorted.slice(pageStart, pageStart + PAGE_SIZE)

  // ---- Aggregate stats (over the filtered set, not just the page) ----
  const totalAmount = allPayments.reduce((sum, p) => sum + (p.amount_sar || 0), 0)
  const totalVat = allPayments.reduce((sum, p) => sum + (p.vat_sar ?? 0), 0)

  const basePath = '/app/disbursements/admin/lists/payments'
  const baseParams = new URLSearchParams()
  if (q) baseParams.set('q', q)
  if (projectFilter) baseParams.set('project', projectFilter)
  if (accountFilter) baseParams.set('account', accountFilter)
  baseParams.set('sort', sort)
  baseParams.set('dir', dir)

  const otherParamsForSort = {
    q,
    project: projectFilter,
    account: accountFilter,
  }

  // Filter the account dropdown to accounts for the selected project — if
  // no project selected we surface all accounts labeled with their project.
  const accountOptions = accounts
    .filter((a) => !projectFilter || a.project_id === projectFilter)
    .map((a) => {
      const proj = projectById.get(a.project_id)
      const projLabel = proj?.name_ar ?? '—'
      return {
        value: a.id,
        label: projectFilter ? a.label : `${projLabel} · ${a.label}`,
      }
    })

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
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <Coins className="w-4 h-4" aria-hidden="true" />
          سجل الدفعات
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="serif font-black text-2xl tracking-tight text-slate-900">
            الدفعات
          </h1>
          <span className="text-sm text-slate-400 font-mono">
            ({totalCount.toLocaleString('en-US')})
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard label="عدد الدفعات" value={totalCount.toLocaleString('en-US')} />
        <KpiCard label="إجمالي المبالغ" value={fmtNum(totalAmount)} mono />
        <KpiCard label="إجمالي الضريبة" value={fmtNum(totalVat)} mono />
      </div>

      <ListToolbar
        basePath={basePath}
        q={q}
        projectFilter={projectFilter}
        projects={projects}
        searchPlaceholder="بحث بالمرجع أو المستفيد أو البيان…"
        extraSelects={[
          {
            name: 'account',
            label: 'كل الحسابات',
            value: accountFilter,
            options: accountOptions,
          },
        ]}
        preservedParams={{ sort, dir }}
      />

      {pageRows.length === 0 ? (
        <div className="text-sm text-slate-500 italic text-center py-12 border border-dashed border-slate-200 rounded-xl bg-white">
          {allPayments.length === 0 ? 'لا توجد دفعات مطابقة.' : 'الصفحة فارغة.'}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-right">
                  <SortHeader
                    label="التاريخ"
                    sortKey="payment_date"
                    currentSort={sort}
                    currentDir={dir}
                    basePath={basePath}
                    otherParams={otherParamsForSort}
                  />
                  <SortHeader
                    label="المبلغ"
                    sortKey="amount_sar"
                    currentSort={sort}
                    currentDir={dir}
                    basePath={basePath}
                    otherParams={otherParamsForSort}
                  />
                  <Th>الضريبة</Th>
                  <Th>المستفيد</Th>
                  <Th>البيان</Th>
                  <Th>المرجع</Th>
                  <Th>المشروع</Th>
                  <Th>الحساب</Th>
                  <Th>الطلب</Th>
                  <Th>الوحدة</Th>
                  <Th>الطريقة</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.map((p) => {
                  const proj = p.project_id ? projectById.get(p.project_id) : null
                  const acct = p.account_id ? accountById.get(p.account_id) : null
                  const caseNo = p.case_id ? caseNumberById.get(p.case_id) : null
                  const unitNo = p.unit_id ? unitNumberById.get(p.unit_id) : null
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 transition">
                      <Td className="font-mono text-xs" dir="ltr">
                        {p.payment_date}
                      </Td>
                      <Td className="font-mono text-xs font-semibold" dir="ltr">
                        {fmtNum(p.amount_sar)}
                      </Td>
                      <Td className="font-mono text-xs" dir="ltr">
                        {fmtNum(p.vat_sar)}
                      </Td>
                      <Td className="max-w-[12rem] truncate">
                        {p.beneficiary_name ?? '—'}
                      </Td>
                      <Td className="max-w-[14rem] truncate">
                        {p.description ?? '—'}
                      </Td>
                      <Td className="font-mono text-xs">
                        {p.reference_number ?? '—'}
                      </Td>
                      <Td className="max-w-[10rem] truncate">
                        {proj?.name_ar ?? '—'}
                      </Td>
                      <Td className="max-w-[10rem] truncate">
                        {acct?.label ?? '—'}
                      </Td>
                      <Td className="font-mono text-xs">{caseNo ?? '—'}</Td>
                      <Td className="font-mono text-xs">{unitNo ?? '—'}</Td>
                      <Td className="max-w-[8rem] truncate">
                        {p.payment_method ?? '—'}
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
