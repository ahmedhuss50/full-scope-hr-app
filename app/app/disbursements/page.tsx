/**
 * Disbursements — Owner / Supervisor / Employee dashboard
 * ----------------------------------------------------------------------------
 * v1 of the redesigned dashboard. Replaces the old kanban view with a
 * vertically-stacked, KPI-first layout modelled on the off-plan-sales.onrender
 * reference. Keeps the existing teal + slate palette, RTL layout, and reuses
 * the existing auth / project-scope preamble.
 *
 * Sections (top → bottom):
 *   1. Page header with date-range pill filter
 *   2. Five KPI cards
 *   3. Compliance breach banners (only when tripped)
 *   4. Two-column mid: "في انتظاري" queue + "مؤشرات الالتزام النظامي"
 *   5. Projects summary table
 *   6. Latest operations table (audit log)
 *
 * NOTE for future edit: the spec referenced `dsb_case_audit` but the actual
 * table in this codebase is `dsb_audit_log`. Renamed here — grep the file for
 * TODO comments before iterating.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import {
  Plus, Settings, LayoutDashboard, Activity, ArrowRightCircle,
  RotateCcw, CheckCircle2, XCircle, Move, UploadCloud, FileText,
  Inbox, ArrowLeft, CircleDollarSign,
} from 'lucide-react'
import { fmtDate } from '@/lib/dsb/datetime'
import { assignedProjectIds, applyProjectScope } from '@/lib/dsb/access'
import { DashboardDateRange } from './DashboardDateRange'
import { DismissibleBanner } from './DismissibleBanner'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Types & shared helpers (kept from previous version so peer files that
// import them keep compiling).
// ---------------------------------------------------------------------------

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
  extracted_fields: { beneficiary_name_ar?: string | null } | null
  project: ProjectLite | ProjectLite[] | null
  developer: DeveloperLite | DeveloperLite[] | null
}

type AuditRow = {
  id: string
  event: string
  from_status: string | null
  to_status: string | null
  occurred_at: string
  case:
    | { id: string; case_number: string; status?: string | null; project: { name_ar: string } | { name_ar: string }[] | null; developer?: { company_name_ar: string } | { company_name_ar: string }[] | null }
    | Array<{ id: string; case_number: string; status?: string | null; project: { name_ar: string } | { name_ar: string }[] | null; developer?: { company_name_ar: string } | { company_name_ar: string }[] | null }>
    | null
}

function single<T>(maybe: T | T[] | null | undefined): T | null {
  if (!maybe) return null
  return Array.isArray(maybe) ? (maybe[0] ?? null) : maybe
}

function fmtSar(amount: number | null): string {
  if (amount == null) return '—'
  try {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency', currency: 'SAR', maximumFractionDigits: 0,
    }).format(amount)
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

// ---------------------------------------------------------------------------
// Compliance constants (mirror ProjectComplianceSummary.tsx)
// ---------------------------------------------------------------------------
const SHARE_CONSTRUCTION = 0.76
const SHARE_ADMIN        = 0.20
const SHARE_ESCROW       = 0.04

// ---------------------------------------------------------------------------
// Date-range helpers
// ---------------------------------------------------------------------------
type RangeKey = 'month' | 'quarter' | 'year' | 'custom'

function resolveRange(
  range: RangeKey,
  customFrom: string | null,
  customTo: string | null,
): { fromIso: string; toIso: string; fromDate: string; toDate: string; label: string } {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  let from: Date, to: Date, label: string
  if (range === 'month') {
    from = new Date(Date.UTC(y, m, 1))
    to   = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59))
    label = 'هذا الشهر'
  } else if (range === 'year') {
    from = new Date(Date.UTC(y, 0, 1))
    to   = new Date(Date.UTC(y, 11, 31, 23, 59, 59))
    label = 'السنة'
  } else if (range === 'custom' && (customFrom || customTo)) {
    from = customFrom ? new Date(`${customFrom}T00:00:00Z`) : new Date(Date.UTC(y, 0, 1))
    to   = customTo   ? new Date(`${customTo}T23:59:59Z`)   : new Date(Date.UTC(y, 11, 31, 23, 59, 59))
    label = 'مخصّص'
  } else {
    // default: current quarter
    const qStart = Math.floor(m / 3) * 3
    from = new Date(Date.UTC(y, qStart, 1))
    to   = new Date(Date.UTC(y, qStart + 3, 0, 23, 59, 59))
    label = 'هذا الربع'
  }
  return {
    fromIso: from.toISOString(),
    toIso:   to.toISOString(),
    fromDate: from.toISOString().slice(0, 10),
    toDate:   to.toISOString().slice(0, 10),
    label,
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default async function DisbursementsDashboardPage({
  searchParams,
}: {
  searchParams?: { range?: string; from?: string; to?: string }
}) {
  // ---- Auth + role resolution (kept verbatim from previous version) ------
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
  if (dsbRole === 'developer') redirect('/developer')
  if (!dsbRole || !['employee', 'supervisor', 'owner', 'viewer', 'deliverer'].includes(dsbRole)) {
    redirect('/login')
  }
  const tenantId = profile.tenant_id as string
  const userId = profile.id as string
  const fullName = (profile.full_name as string | null) ?? null

  const allowedProjectIds = await assignedProjectIds({ svc, tenantId, userId, dsbRole })

  // ---- Parse date range from URL -----------------------------------------
  const rangeKeyRaw = (searchParams?.range ?? 'quarter').trim() as RangeKey
  const rangeKey: RangeKey = (['month', 'quarter', 'year', 'custom'] as const).includes(rangeKeyRaw as never)
    ? rangeKeyRaw
    : 'quarter'
  const { fromIso, toIso, fromDate, toDate, label: rangeLabel } = resolveRange(
    rangeKey,
    (searchParams?.from ?? '').trim() || null,
    (searchParams?.to   ?? '').trim() || null,
  )

  // "بانتظاري" — status the current user should action.
  const myInboxStatus =
    dsbRole === 'employee'   ? 'with_employee'   :
    dsbRole === 'supervisor' ? 'with_supervisor' :
    dsbRole === 'owner'      ? 'with_owner'      :
    null

  // ---- Batch all queries in parallel -------------------------------------
  // Each entry is either a Supabase query or an inline async fn so we can
  // still layer applyProjectScope + role-aware filters inline.
  const [
    projectsRes,
    unitsRes,
    unitSalesRes,
    paymentsRes,
    spentRes,
    myInboxCasesRes,
    auditRes,
  ] = await Promise.all([
    // Projects the user can see (name / code / license). NOTE: for
    // `dsb_projects` the scope column is `id`, not `project_id`.
    (() => {
      let q = svc
        .from('dsb_projects')
        .select('id, code, name_ar, rega_license_no')
        .eq('tenant_id', tenantId)
        .order('code', { ascending: true })
      q = applyProjectScope(q, allowedProjectIds, 'id')
      return q
    })(),

    // Units in accessible projects
    (() => {
      let q = svc
        .from('dsb_project_units')
        .select('id, project_id')
        .eq('tenant_id', tenantId)
      q = applyProjectScope(q, allowedProjectIds)
      return q.limit(10000)
    })(),

    // Unit sales — used to derive "sold" count and total sold contract
    // value. `dsb_unit_sales` has no project_id column, so scoping happens
    // in code: we only aggregate rows whose unit_id is in the units query
    // (which IS already scoped). Active sales only, mirroring
    // ProjectComplianceSummary.
    svc
      .from('dsb_unit_sales')
      .select('unit_id, price_with_vat_sar, price_before_tax_sar, sale_status')
      .eq('tenant_id', tenantId)
      .eq('sale_status', 'active')
      .limit(10000),

    // Buyer collections in date range → المحصّل
    (() => {
      let q = svc
        .from('dsb_payments')
        .select('project_id, amount_sar, payment_date, created_at')
        .eq('tenant_id', tenantId)
        .eq('deposit_category', 'buyer_collection')
        // Filter by payment_date if present, else created_at. We fetch a wide
        // window (from ≤ payment_date ≤ to) and let the DB do the filtering.
        // TODO(v2): confirm which of payment_date / created_at is the source
        // of truth in production data.
        .gte('payment_date', fromDate)
        .lte('payment_date', toDate)
      q = applyProjectScope(q, allowedProjectIds)
      return q.limit(10000)
    })(),

    // Spent (paid) cases in date range → المصروف + admin/construction split
    (() => {
      let q = svc
        .from('dsb_cases')
        .select('project_id, amount_sar, status, signed_at, voucher_date, is_historical, extracted_fields')
        .eq('tenant_id', tenantId)
        .in('status', ['signed', 'delivered'])
      q = applyProjectScope(q, allowedProjectIds)
      // Use signed_at as the primary spend date. Historical cases predate the
      // app so are excluded from range totals — they'll show under the
      // per-project totals if we ever surface those.
      // TODO(v2): union with voucher_date for is_historical=true rows.
      return q.gte('signed_at', fromIso).lte('signed_at', toIso).limit(10000)
    })(),

    // "بانتظاري" — cases the current user must action (all-time, not
    // date-scoped: an approval doesn't stop being an approval outside a
    // quarter boundary).
    (async () => {
      if (!myInboxStatus) return { data: [] as CaseRow[] }
      let q = svc
        .from('dsb_cases')
        .select(
          `id, case_number, voucher_number_text, amount_sar, status, submitted_at, signed_at, created_at, extracted_fields,
           project:dsb_projects!dsb_cases_project_id_fkey(id, code, name_ar, assigned_employee_id),
           developer:dsb_developers!dsb_cases_developer_id_fkey(id, company_name_ar)`,
        )
        .eq('tenant_id', tenantId)
        .eq('status', myInboxStatus)
      q = applyProjectScope(q, allowedProjectIds)
      const res = await q.order('submitted_at', { ascending: false, nullsFirst: false }).limit(200)
      return { data: (res.data ?? []) as CaseRow[] }
    })(),

    // Latest 10 audit events for "آخر العمليات"
    svc
      .from('dsb_audit_log')
      .select(
        `id, event, from_status, to_status, occurred_at,
         case:dsb_cases!dsb_audit_log_case_id_fkey(
           id, case_number, status,
           project:dsb_projects!dsb_cases_project_id_fkey(name_ar),
           developer:dsb_developers!dsb_cases_developer_id_fkey(company_name_ar)
         )`,
      )
      .eq('tenant_id', tenantId)
      .order('occurred_at', { ascending: false })
      .limit(10),
  ])

  const projects = (projectsRes.data ?? []) as Array<{
    id: string; code: string; name_ar: string; rega_license_no: string | null
  }>
  const units = (unitsRes.data ?? []) as Array<{ id: string; project_id: string }>
  const unitSales = (unitSalesRes.data ?? []) as Array<{
    unit_id: string; price_with_vat_sar: number | null; price_before_tax_sar: number | null
  }>
  const payments = (paymentsRes.data ?? []) as Array<{
    project_id: string | null; amount_sar: number | null
  }>
  const spent = (spentRes.data ?? []) as Array<{
    project_id: string | null; amount_sar: number | null
    extracted_fields: { disbursement_type_code?: string | null } | null
  }>
  const myInboxCases = myInboxCasesRes.data
  const audit = (auditRes.data ?? []) as AuditRow[]

  // ---- Aggregate per-project + totals ------------------------------------
  const unitCountByProject = new Map<string, number>()
  const unitToProject = new Map<string, string>()
  for (const u of units) {
    unitCountByProject.set(u.project_id, (unitCountByProject.get(u.project_id) ?? 0) + 1)
    unitToProject.set(u.id, u.project_id)
  }
  const soldCountByProject = new Map<string, number>()
  const soldValueByProject = new Map<string, number>()
  let totalSoldValue = 0
  let totalSoldCount = 0
  for (const s of unitSales) {
    const pid = unitToProject.get(s.unit_id)
    if (!pid) continue
    soldCountByProject.set(pid, (soldCountByProject.get(pid) ?? 0) + 1)
    const price = Number(s.price_with_vat_sar ?? s.price_before_tax_sar ?? 0)
    soldValueByProject.set(pid, (soldValueByProject.get(pid) ?? 0) + price)
    totalSoldValue += price
    totalSoldCount += 1
  }

  const collectedByProject = new Map<string, number>()
  let totalCollected = 0
  for (const p of payments) {
    if (!p.project_id) continue
    const amt = Number(p.amount_sar || 0)
    collectedByProject.set(p.project_id, (collectedByProject.get(p.project_id) ?? 0) + amt)
    totalCollected += amt
  }

  const spentByProject = new Map<string, number>()
  const spentAdminByProject = new Map<string, number>()
  const spentConstructionByProject = new Map<string, number>()
  let totalSpent = 0
  let totalAdminSpent = 0
  let totalConstructionSpent = 0
  for (const c of spent) {
    if (!c.project_id) continue
    const amt = Number(c.amount_sar || 0)
    spentByProject.set(c.project_id, (spentByProject.get(c.project_id) ?? 0) + amt)
    totalSpent += amt
    const type = c.extracted_fields?.disbursement_type_code ?? null
    if (type === 'admin_marketing') {
      spentAdminByProject.set(c.project_id, (spentAdminByProject.get(c.project_id) ?? 0) + amt)
      totalAdminSpent += amt
    } else if (type === 'construction') {
      spentConstructionByProject.set(c.project_id, (spentConstructionByProject.get(c.project_id) ?? 0) + amt)
      totalConstructionSpent += amt
    }
  }

  const totalUnits    = units.length
  const totalSoldPct  = totalUnits > 0 ? Math.round((totalSoldCount / totalUnits) * 100) : 0
  const escrowBalance = totalCollected - totalSpent
  const myInboxCount  = myInboxCases.length

  // ---- Compliance ratios (tenant-wide, on collected in range) ------------
  const adminRatio        = totalCollected > 0 ? totalAdminSpent / totalCollected : 0
  const constructionRatio = totalCollected > 0 ? totalConstructionSpent / totalCollected : 0
  const escrowRatio       = totalCollected > 0 ? escrowBalance / totalCollected : 0

  const breachAdmin        = totalCollected > 0 && adminRatio > SHARE_ADMIN
  const breachConstruction = totalCollected > 0 && constructionRatio > SHARE_CONSTRUCTION
  const breachEscrow       = totalCollected > 0 && escrowRatio < SHARE_ESCROW

  // ---- Group myInbox cases by type for the queue panel -------------------
  // We split by "requires signature" vs "requires review" using status +
  // extracted flags. For owner this is the classic توقيع bucket; supervisor
  // and employee just see مراجعة.
  const inboxBuckets: Array<{ key: string; label: string; items: CaseRow[] }> = []
  if (myInboxCases.length > 0) {
    if (dsbRole === 'owner') {
      inboxBuckets.push({ key: 'sign', label: 'بانتظار التوقيع', items: myInboxCases })
    } else {
      inboxBuckets.push({ key: 'review', label: 'بانتظار المراجعة', items: myInboxCases })
    }
  }

  return (
    <div className="space-y-5 max-w-7xl mx-auto" dir="rtl">

      {/* 1. Page header -----------------------------------------------------*/}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-teal-700">
            <LayoutDashboard className="w-4 h-4" aria-hidden="true" />
            الصرف
          </div>
          <h1 className="serif font-black text-2xl tracking-tight text-slate-900">
            لوحة المتابعة
          </h1>
          <p className="text-xs text-slate-500">
            {rangeLabel} · {fmtDate(fromIso)} — {fmtDate(toIso)}
            {' · '}
            {fullName ? `${fullName} (${roleLabelAr(dsbRole)})` : roleLabelAr(dsbRole)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <DashboardDateRange active={rangeKey} from={searchParams?.from ?? null} to={searchParams?.to ?? null} />
          <div className="flex items-center gap-2">
            <Link
              href="/app/disbursements/new"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              سند جديد
            </Link>
            <Link
              href="/app/disbursements/admin"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition"
            >
              <Settings className="w-3.5 h-3.5" aria-hidden="true" />
              إدارة
            </Link>
          </div>
        </div>
      </header>

      {/* 2. Five KPI cards --------------------------------------------------*/}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi
          label="الوحدات"
          value={fmtInt(totalUnits)}
          caption={`مباعة ${fmtInt(totalSoldCount)} · ${totalSoldPct}٪`}
        />
        <Kpi
          label="المحصّل"
          value={fmtSar(totalCollected)}
          caption={`من ${fmtSar(totalSoldValue)}`}
        />
        <Kpi
          label="المصروف"
          value={fmtSar(totalSpent)}
          tone={totalSpent > totalCollected && totalCollected > 0 ? 'red' : 'default'}
          caption={totalCollected > 0
            ? `${Math.round((totalSpent / totalCollected) * 100)}٪ من المحصّل`
            : '—'}
        />
        <Kpi
          label="حساب الضمان"
          value={fmtSar(escrowBalance)}
          tone={escrowBalance < 0 ? 'red' : 'default'}
          caption={totalCollected > 0
            ? `${Math.round(escrowRatio * 100)}٪ من المحصّل`
            : '—'}
        />
        <Kpi
          label="بانتظاري"
          value={fmtInt(myInboxCount)}
          tone={myInboxCount > 0 ? 'green' : 'default'}
          caption={roleLabelAr(dsbRole)}
        />
      </section>

      {/* 3. Compliance breach banners --------------------------------------*/}
      {(breachConstruction || breachEscrow || breachAdmin) && (
        <section className="space-y-2">
          {breachConstruction && (
            <DismissibleBanner
              tone="red"
              title="تجاوز سقف المصاريف الإنشائية"
              message={`المصروف الإنشائي ${Math.round(constructionRatio * 100)}٪ من المحصّل — يتجاوز الحد المسموح ${Math.round(SHARE_CONSTRUCTION * 100)}٪.`}
            />
          )}
          {breachEscrow && (
            <DismissibleBanner
              tone="amber"
              title="الرصيد دون مبلغ الحفظ"
              message={`رصيد حساب الضمان ${Math.round(escrowRatio * 100)}٪ من المحصّل — أقل من الحد الأدنى ${Math.round(SHARE_ESCROW * 100)}٪.`}
            />
          )}
          {breachAdmin && (
            <DismissibleBanner
              tone="red"
              title="تجاوز سقف المصاريف الإدارية والتسويقية"
              message={`المصروف الإداري ${Math.round(adminRatio * 100)}٪ من المحصّل — يتجاوز الحد المسموح ${Math.round(SHARE_ADMIN * 100)}٪.`}
            />
          )}
        </section>
      )}

      {/* 4. Two-column mid: inbox queue + compliance indicators -------------*/}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: inbox queue */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Inbox className="w-4 h-4 text-teal-700" aria-hidden="true" />
              <h2 className="serif font-bold text-base text-slate-900">في انتظاري</h2>
              <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full bg-teal-50 text-teal-700 text-[11px] font-bold font-mono">
                {myInboxCount}
              </span>
            </div>
            {myInboxStatus && (
              <Link
                href={`/app/disbursements/board?status=${myInboxStatus}`}
                className="text-xs font-semibold text-teal-700 hover:text-teal-900 inline-flex items-center gap-1"
              >
                فتح اللوحة الكاملة
                <ArrowLeft className="w-3 h-3" aria-hidden="true" />
              </Link>
            )}
          </div>
          {!myInboxStatus ? (
            <div className="p-6 text-center text-sm text-slate-500">
              لا يوجد صندوق واردات لدورك.
            </div>
          ) : inboxBuckets.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              لا يوجد ما ينتظر إجراءك.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {inboxBuckets.map((b) => {
                const sum = b.items.reduce((s, x) => s + Number(x.amount_sar || 0), 0)
                return (
                  <li key={b.key} className="px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{b.label}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {b.items.length} سند · إجمالي {fmtSar(sum)}
                      </div>
                    </div>
                    <Link
                      href={`/app/disbursements/board?status=${myInboxStatus}`}
                      className="text-xs font-semibold text-teal-700 hover:text-teal-900 whitespace-nowrap"
                    >
                      فتح ←
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Right: compliance ratios */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
            <CircleDollarSign className="w-4 h-4 text-teal-700" aria-hidden="true" />
            <h2 className="serif font-bold text-base text-slate-900">مؤشرات الالتزام النظامي</h2>
          </div>
          <div className="p-4 space-y-3">
            <RatioRow
              label={`سقف المصاريف الإدارية (${Math.round(SHARE_ADMIN * 100)}٪)`}
              ratio={adminRatio}
              threshold={SHARE_ADMIN}
              direction="cap"
            />
            <RatioRow
              label={`حساب الحفظ (${Math.round(SHARE_ESCROW * 100)}٪)`}
              ratio={escrowRatio}
              threshold={SHARE_ESCROW}
              direction="floor"
            />
            <RatioRow
              label={`سقف المصاريف الإنشائية (${Math.round(SHARE_CONSTRUCTION * 100)}٪)`}
              ratio={constructionRatio}
              threshold={SHARE_CONSTRUCTION}
              direction="cap"
            />
          </div>
        </div>
      </section>

      {/* 5. Projects summary table -----------------------------------------*/}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
          <h2 className="serif font-bold text-base text-slate-900">
            ملخص المشاريع ({projects.length})
          </h2>
        </div>
        {projects.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">لا توجد مشاريع.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-right">
                <tr>
                  <Th>المشروع</Th>
                  <Th>الوحدات</Th>
                  <Th>مباعة</Th>
                  <Th>المحصّل</Th>
                  <Th>المنصرف</Th>
                  <Th>الرصيد</Th>
                  <Th>الحالة</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projects.map((p) => {
                  const nUnits = unitCountByProject.get(p.id) ?? 0
                  const nSold  = soldCountByProject.get(p.id) ?? 0
                  const soldPct = nUnits > 0 ? Math.round((nSold / nUnits) * 100) : 0
                  const collected = collectedByProject.get(p.id) ?? 0
                  const spentP    = spentByProject.get(p.id) ?? 0
                  const spentAdmin = spentAdminByProject.get(p.id) ?? 0
                  const spentCon   = spentConstructionByProject.get(p.id) ?? 0
                  const balance   = collected - spentP
                  const pill = projectStatusPill({
                    collected, spentAdmin, spentCon,
                  })
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70">
                      <Td>
                        <Link
                          href={`/app/disbursements/admin/projects/${p.id}`}
                          className="font-semibold text-slate-900 hover:text-teal-800 hover:underline"
                        >
                          {p.name_ar}
                        </Link>
                        <div className="text-[11px] text-slate-500 mt-0.5" dir="ltr">
                          {p.rega_license_no ? `# ${p.rega_license_no}` : p.code}
                        </div>
                        {/* Sales-progress bar under project name */}
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="h-1.5 w-24 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full bg-teal-500"
                              style={{ width: `${Math.min(100, soldPct)}%` }}
                            />
                          </div>
                          <span className="font-mono text-[10px] text-slate-500">
                            {soldPct}٪
                          </span>
                        </div>
                      </Td>
                      <Td><span className="font-mono">{fmtInt(nUnits)}</span></Td>
                      <Td><span className="font-mono">{fmtInt(nSold)}</span></Td>
                      <Td><span className="font-mono text-emerald-700">{fmtSar(collected)}</span></Td>
                      <Td><span className="font-mono text-amber-700">{fmtSar(spentP)}</span></Td>
                      <Td>
                        <span className={`font-mono ${balance < 0 ? 'text-red-700' : 'text-slate-700'}`}>
                          {fmtSar(balance)}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ring-1 ring-inset ${pill.cls}`}
                        >
                          {pill.label}
                        </span>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 6. Latest operations ----------------------------------------------*/}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <Activity className="w-4 h-4 text-slate-500" aria-hidden="true" />
          <h2 className="serif font-bold text-base text-slate-900">آخر العمليات</h2>
        </div>
        {audit.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">لا يوجد نشاط حديث.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-right">
                <tr>
                  <Th>العملية</Th>
                  <Th>الطرف (المستفيد)</Th>
                  <Th>المشروع</Th>
                  <Th>التاريخ</Th>
                  <Th>الحالة</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {audit.map((a) => {
                  const c = single(a.case)
                  const proj = c ? single(c.project) : null
                  const dev  = c ? single(c.developer) : null
                  const ev = describeEvent(a.event, a.to_status)
                  const EvIcon = ev.Icon
                  const statusPill = caseStatusPill(a.to_status ?? c?.status ?? null)
                  return (
                    <tr key={a.id} className="hover:bg-slate-50/70">
                      <Td>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0 ${ev.iconCls}`}>
                            <EvIcon className="w-3 h-3" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900 truncate">{ev.label}</div>
                            {c && (
                              <Link
                                href={`/app/disbursements/${c.id}`}
                                className="font-mono text-[11px] text-teal-700 hover:text-teal-800"
                              >
                                {c.case_number}
                              </Link>
                            )}
                          </div>
                        </div>
                      </Td>
                      <Td>{dev?.company_name_ar ?? '—'}</Td>
                      <Td>{proj?.name_ar ?? '—'}</Td>
                      <Td><span className="text-slate-600">{timeAgoAr(a.occurred_at)}</span></Td>
                      <Td>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ring-1 ring-inset ${statusPill.cls}`}
                        >
                          {statusPill.label}
                        </span>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small subcomponents & helpers
// ---------------------------------------------------------------------------

function fmtInt(n: number): string {
  try {
    return new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 0 }).format(n)
  } catch {
    return String(n)
  }
}

function Kpi({
  label, value, caption, tone = 'default',
}: {
  label: string
  value: string
  caption?: string
  tone?: 'default' | 'red' | 'green'
}) {
  const valueCls =
    tone === 'red' ? 'text-red-700' :
    tone === 'green' ? 'text-emerald-700' :
    'text-slate-900'
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-[11px] text-slate-500 font-semibold mb-1 truncate">{label}</div>
      <div className={`text-[24px] leading-none font-semibold truncate ${valueCls}`}>{value}</div>
      {caption && (
        <div className="text-[11px] text-slate-500 mt-1.5 truncate">{caption}</div>
      )}
    </div>
  )
}

function RatioRow({
  label, ratio, threshold, direction,
}: {
  label: string
  ratio: number             // 0..1+
  threshold: number         // 0..1
  direction: 'cap' | 'floor' // cap = ratio should stay ≤ threshold; floor = ≥
}) {
  const pct = Math.max(0, Math.min(1, ratio))
  const okCap  = direction === 'cap'   && ratio <= threshold
  const okFlr  = direction === 'floor' && ratio >= threshold
  const okay = okCap || okFlr
  const nearCap = direction === 'cap' && ratio > threshold * 0.8 && ratio <= threshold
  const barCls =
    okay && !nearCap ? 'bg-emerald-500' :
    nearCap          ? 'bg-amber-500'   :
    'bg-red-500'
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs text-slate-700">{label}</div>
        <div className={`text-xs font-mono ${okay ? 'text-slate-700' : 'text-red-700 font-bold'}`}>
          {Math.round(ratio * 100)}٪
        </div>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${barCls}`} style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>
    </div>
  )
}

function projectStatusPill({
  collected, spentAdmin, spentCon,
}: {
  collected: number
  spentAdmin: number
  spentCon: number
}): { cls: string; label: string } {
  if (collected <= 0) {
    return { cls: 'bg-slate-100 text-slate-600 ring-slate-200', label: 'لا بيانات' }
  }
  if (spentCon > collected * SHARE_CONSTRUCTION) {
    return { cls: 'bg-red-50 text-red-800 ring-red-200', label: 'تجاوز إنشائي' }
  }
  if (spentAdmin > collected * SHARE_ADMIN) {
    return { cls: 'bg-amber-50 text-amber-800 ring-amber-200', label: 'تجاوز إداري' }
  }
  return { cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200', label: 'منتظم' }
}

function caseStatusPill(status: string | null): { cls: string; label: string } {
  switch (status) {
    case 'with_employee':          return { cls: 'bg-amber-50 text-amber-800 ring-amber-200',   label: 'الموظف' }
    case 'with_supervisor':        return { cls: 'bg-amber-50 text-amber-800 ring-amber-200',   label: 'السوبرفايزر' }
    case 'with_owner':             return { cls: 'bg-amber-50 text-amber-800 ring-amber-200',   label: 'المدير' }
    case 'signed':                 return { cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200', label: 'موقّعة' }
    case 'delivered':              return { cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200', label: 'مسلمة' }
    case 'sent_back_to_developer': return { cls: 'bg-red-50 text-red-800 ring-red-200',         label: 'مُرحّل للمطور' }
    case 'cancelled':              return { cls: 'bg-slate-100 text-slate-700 ring-slate-200',  label: 'ملغى' }
    default:                       return { cls: 'bg-slate-100 text-slate-700 ring-slate-200',  label: status ?? '—' }
  }
}

// ---- Audit-event descriptor (kept from previous version) -----------------

type EventDescriptor = { Icon: typeof FileText; iconCls: string; label: string }

function describeEvent(event: string, toStatus: string | null): EventDescriptor {
  if (event === 'uploaded')            return { Icon: UploadCloud,      iconCls: 'text-teal-600 bg-teal-50',     label: 'رفع وثيقة صرف جديدة' }
  if (event === 'employee_approved')   return { Icon: ArrowRightCircle, iconCls: 'text-amber-700 bg-amber-50',   label: 'اعتماد الموظف' }
  if (event === 'supervisor_approved') return { Icon: ArrowRightCircle, iconCls: 'text-amber-700 bg-amber-50',   label: 'اعتماد السوبرفايزر' }
  if (event === 'sent_back')           return { Icon: RotateCcw,        iconCls: 'text-red-700 bg-red-50',       label: 'إعادة إلى المطور' }
  if (event === 'signed')              return { Icon: CheckCircle2,     iconCls: 'text-green-700 bg-green-50',   label: 'توقيع المدير' }
  if (event === 'cancelled')           return { Icon: XCircle,          iconCls: 'text-slate-500 bg-slate-100',  label: 'إلغاء الطلب' }
  if (event === 'manual_move') {
    if (toStatus === 'with_supervisor')        return { Icon: ArrowRightCircle, iconCls: 'text-amber-700 bg-amber-50', label: 'نقل إلى السوبرفايزر' }
    if (toStatus === 'with_owner')             return { Icon: ArrowRightCircle, iconCls: 'text-amber-700 bg-amber-50', label: 'نقل إلى المدير' }
    if (toStatus === 'sent_back_to_developer') return { Icon: RotateCcw,        iconCls: 'text-red-700 bg-red-50',     label: 'إرجاع إلى المطور' }
    if (toStatus === 'signed')                 return { Icon: CheckCircle2,     iconCls: 'text-green-700 bg-green-50', label: 'توقيع نهائي' }
    return { Icon: Move, iconCls: 'text-slate-600 bg-slate-100', label: 'نقل يدوي' }
  }
  return { Icon: Activity, iconCls: 'text-slate-600 bg-slate-100', label: event }
}

// ---- Table cell primitives (align with ProjectComplianceSummary) ---------
function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  )
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 text-sm text-slate-700 align-top ${className}`}>{children}</td>
}
