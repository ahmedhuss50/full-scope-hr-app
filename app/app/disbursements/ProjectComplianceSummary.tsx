/**
 * ProjectComplianceSummary
 * ----------------------------------------------------------------------------
 * Owner-facing dashboard section that surfaces two things at a glance:
 *
 *   1. ALERTS BANNER — projects that violate one of our compliance caps:
 *        - admin_marketing spending > 20% of buyer_collection allocation
 *        - construction spending > 76% of buyer_collection allocation
 *        - net cash-out has exceeded net cash-in
 *      Each alert links straight into the offending project so the owner
 *      can act without hunting.
 *
 *   2. PROJECT PERFORMANCE TABLE — one row per project with contract value,
 *      collected, spent, admin/construction spend ratios, and a status pill
 *      («تجاوز إداري» / «تجاوز إنشائي» / «تجاوز صرف» / «منتظم»).
 *
 * Rendering only — all data fetched here. Owner-only; caller decides.
 * Numbers reconcile with سجل الدفعات → تحصيل مشتري (per project) and the
 * escrow-account report (per project).
 */
import Link from 'next/link'
import { AlertTriangle, TrendingUp, ArrowLeft } from 'lucide-react'
import { createSupabaseService } from '@/lib/supabase/server'

// Distribution shares mirror the payments-list KPI derivation (see
// admin/lists/payments/page.tsx). If we ever make these per-tenant we plumb
// them in from tenant settings.
const SHARE_CONSTRUCTION = 0.76
const SHARE_ADMIN        = 0.20
// const SHARE_ESCROW    = 0.04 // not needed for cap comparison

function fmtSar(v: number | null | undefined): string {
  if (v == null) return '—'
  try {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR',
      maximumFractionDigits: 0,
    }).format(v)
  } catch {
    return `${v} ر.س`
  }
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return numerator / denominator
}

type ProjectMetrics = {
  id: string
  code: string
  name_ar: string
  contracts_total: number      // sum of sale prices for this project
  collected: number            // sum of buyer_collection payments
  spent_total: number          // sum of paid cases
  spent_admin: number          // sum of cases with disbursement_type_code = 'admin_marketing'
  spent_construction: number   // sum of cases with disbursement_type_code = 'construction'
  admin_allocation: number     // 20% × collected
  construction_allocation: number // 76% × collected
  over_admin: boolean
  over_construction: boolean
  over_cash: boolean           // spent > collected
}

export async function ProjectComplianceSummary({
  tenantId,
  projectIds,
}: {
  tenantId: string
  // Pre-scoped list of project ids the user is allowed to see. Empty →
  // renders nothing. Owner passes every project; scoped roles pass their
  // assigned subset (unused today but future-safe).
  projectIds: string[]
}) {
  if (projectIds.length === 0) return null

  const svc = createSupabaseService()

  // ---- Load project metadata ----
  const { data: projRows } = await svc
    .from('dsb_projects')
    .select('id, code, name_ar')
    .eq('tenant_id', tenantId)
    .in('id', projectIds)
    .order('code', { ascending: true })
  const projects = ((projRows ?? []) as Array<{ id: string; code: string; name_ar: string }>)

  // ---- Contract-value totals: sum of latest active sale price per unit,
  //      grouped by project. dsb_unit_sales lives under a unit which lives
  //      under a project, so we join up.
  const { data: unitRows } = await svc
    .from('dsb_project_units')
    .select('id, project_id')
    .eq('tenant_id', tenantId)
    .in('project_id', projectIds)
  const unitToProject = new Map<string, string>()
  for (const u of ((unitRows ?? []) as Array<{ id: string; project_id: string }>)) {
    unitToProject.set(u.id, u.project_id)
  }
  const unitIds = Array.from(unitToProject.keys())

  const contractsTotalByProject = new Map<string, number>()
  if (unitIds.length > 0) {
    // Chunk to stay under any query length limits.
    const CHUNK = 500
    for (let i = 0; i < unitIds.length; i += CHUNK) {
      const slice = unitIds.slice(i, i + CHUNK)
      const { data: saleRows } = await svc
        .from('dsb_unit_sales')
        .select('unit_id, price_with_vat_sar, price_before_tax_sar, sale_status, created_at')
        .eq('tenant_id', tenantId)
        .in('unit_id', slice)
        .order('created_at', { ascending: false })
      // pick one sale per unit — active preferred, else newest
      const chosenByUnit = new Map<string, { price: number | null }>()
      for (const s of ((saleRows ?? []) as Array<{
        unit_id: string
        price_with_vat_sar: number | null
        price_before_tax_sar: number | null
        sale_status: string | null
      }>)) {
        const prev = chosenByUnit.get(s.unit_id)
        if (!prev) {
          chosenByUnit.set(s.unit_id, { price: s.price_with_vat_sar ?? s.price_before_tax_sar ?? null })
          continue
        }
        if (s.sale_status === 'active' && prev.price == null) {
          chosenByUnit.set(s.unit_id, { price: s.price_with_vat_sar ?? s.price_before_tax_sar ?? null })
        }
      }
      for (const [uid, { price }] of chosenByUnit) {
        if (price == null) continue
        const pid = unitToProject.get(uid)
        if (!pid) continue
        contractsTotalByProject.set(pid, (contractsTotalByProject.get(pid) ?? 0) + Number(price))
      }
    }
  }

  // ---- Collections (buyer_collection payments per project) ----
  // Chunk-loop to bypass Supabase's 1k row cap.
  const collectedByProject = new Map<string, number>()
  {
    const CHUNK = 1000
    const HARD_LIMIT = 100
    for (let page = 0; page < HARD_LIMIT; page++) {
      const { data: payRows } = await svc
        .from('dsb_payments')
        .select('project_id, amount_sar')
        .eq('tenant_id', tenantId)
        .in('project_id', projectIds)
        .eq('deposit_category', 'buyer_collection')
        .range(page * CHUNK, page * CHUNK + CHUNK - 1)
      const rows = ((payRows ?? []) as Array<{ project_id: string | null; amount_sar: number | null }>)
      for (const r of rows) {
        if (!r.project_id) continue
        collectedByProject.set(r.project_id, (collectedByProject.get(r.project_id) ?? 0) + Number(r.amount_sar || 0))
      }
      if (rows.length < CHUNK) break
    }
  }

  // ---- Spending (cases in paid state per project, split by نوع الصرف) ----
  const spentTotalByProject = new Map<string, number>()
  const spentAdminByProject = new Map<string, number>()
  const spentConstructionByProject = new Map<string, number>()
  {
    const CHUNK = 1000
    const HARD_LIMIT = 100
    for (let page = 0; page < HARD_LIMIT; page++) {
      const { data: caseRows } = await svc
        .from('dsb_cases')
        .select('project_id, amount_sar, status, is_historical, extracted_fields')
        .eq('tenant_id', tenantId)
        .in('project_id', projectIds)
        .or('status.in.(signed,delivered),is_historical.eq.true')
        .range(page * CHUNK, page * CHUNK + CHUNK - 1)
      const rows = ((caseRows ?? []) as Array<{
        project_id: string | null
        amount_sar: number | null
        extracted_fields: Record<string, unknown> | null
      }>)
      for (const r of rows) {
        if (!r.project_id) continue
        const amt = Number(r.amount_sar || 0)
        spentTotalByProject.set(r.project_id, (spentTotalByProject.get(r.project_id) ?? 0) + amt)
        const type = (r.extracted_fields as { disbursement_type_code?: string | null } | null)?.disbursement_type_code ?? null
        if (type === 'admin_marketing') {
          spentAdminByProject.set(r.project_id, (spentAdminByProject.get(r.project_id) ?? 0) + amt)
        } else if (type === 'construction') {
          spentConstructionByProject.set(r.project_id, (spentConstructionByProject.get(r.project_id) ?? 0) + amt)
        }
      }
      if (rows.length < CHUNK) break
    }
  }

  // ---- Build per-project metrics ----
  const metrics: ProjectMetrics[] = projects.map((p) => {
    const contracts_total = contractsTotalByProject.get(p.id) ?? 0
    const collected = collectedByProject.get(p.id) ?? 0
    const spent_total = spentTotalByProject.get(p.id) ?? 0
    const spent_admin = spentAdminByProject.get(p.id) ?? 0
    const spent_construction = spentConstructionByProject.get(p.id) ?? 0
    const admin_allocation = collected * SHARE_ADMIN
    const construction_allocation = collected * SHARE_CONSTRUCTION
    return {
      id: p.id,
      code: p.code,
      name_ar: p.name_ar,
      contracts_total,
      collected,
      spent_total,
      spent_admin,
      spent_construction,
      admin_allocation,
      construction_allocation,
      over_admin:        spent_admin > admin_allocation && admin_allocation > 0,
      over_construction: spent_construction > construction_allocation && construction_allocation > 0,
      over_cash:         spent_total > collected && collected > 0,
    }
  })

  const violations = metrics.filter((m) => m.over_admin || m.over_construction || m.over_cash)

  // Hide the whole panel if there's genuinely nothing to say (no projects
  // with any data yet). Once at least one project has contracts or
  // collections we render the table even with zero violations.
  const hasAnyActivity = metrics.some((m) => m.contracts_total > 0 || m.collected > 0 || m.spent_total > 0)
  if (!hasAnyActivity) return null

  return (
    <section className="space-y-4">
      {/* Alerts banner — only when there are actual violations. */}
      {violations.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="font-bold text-red-900 text-sm">
                تنبيه رقابي: يوجد {violations.length}{' '}
                {violations.length === 1 ? 'مشروع تجاوز' : 'مشروع تجاوزوا'} حدود الصرف المسموحة
              </div>
              <ul className="mt-2 space-y-1 text-sm text-red-800">
                {violations.map((v) => (
                  <li key={v.id} className="flex items-center flex-wrap gap-2">
                    <Link
                      href={`/app/disbursements/admin/projects/${v.id}`}
                      className="font-semibold hover:underline"
                    >
                      {v.name_ar}
                    </Link>
                    <span className="text-xs opacity-75 font-mono" dir="ltr">{v.code}</span>
                    <span className="text-xs">·</span>
                    {v.over_admin && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-white/70 ring-1 ring-red-300">
                        تجاوز إداري: {fmtSar(v.spent_admin)} / {fmtSar(v.admin_allocation)}
                      </span>
                    )}
                    {v.over_construction && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-white/70 ring-1 ring-red-300">
                        تجاوز إنشائي: {fmtSar(v.spent_construction)} / {fmtSar(v.construction_allocation)}
                      </span>
                    )}
                    {v.over_cash && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-white/70 ring-1 ring-red-300">
                        تجاوز صرف: {fmtSar(v.spent_total)} / {fmtSar(v.collected)}
                      </span>
                    )}
                    <Link
                      href={`/app/disbursements/admin/projects/${v.id}/reports/escrow-account`}
                      className="text-xs inline-flex items-center gap-1 hover:underline"
                    >
                      فتح حساب الضمان
                      <ArrowLeft className="w-3 h-3" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Project performance table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-4 sm:px-5 py-3 border-b border-slate-100">
          <TrendingUp className="w-4 h-4 text-teal-700" aria-hidden="true" />
          <h2 className="serif font-bold text-base text-slate-900">أداء المشاريع</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-right">
              <tr>
                <Th>المشروع</Th>
                <Th>قيمة التعاقد</Th>
                <Th>المحصّل</Th>
                <Th>الإنجاز المالي</Th>
                <Th>المصروف</Th>
                <Th>الحالة</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {metrics.map((m) => {
                const progress = pct(m.collected, m.contracts_total)
                const statusPill = statusFor(m)
                return (
                  <tr key={m.id} className="hover:bg-slate-50/70">
                    <Td>
                      <Link
                        href={`/app/disbursements/admin/projects/${m.id}`}
                        className="font-semibold text-slate-900 hover:text-teal-800 hover:underline"
                      >
                        {m.name_ar}
                      </Link>
                      <div className="text-[11px] font-mono text-slate-500" dir="ltr">{m.code}</div>
                    </Td>
                    <Td><span className="font-mono">{fmtSar(m.contracts_total)}</span></Td>
                    <Td><span className="font-mono text-emerald-700">{fmtSar(m.collected)}</span></Td>
                    <Td className="min-w-[10rem]">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full bg-teal-500"
                            style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }}
                          />
                        </div>
                        <span className="font-mono text-[11px] text-slate-600 w-12 text-end">
                          {Math.round(progress * 100)}٪
                        </span>
                      </div>
                    </Td>
                    <Td><span className="font-mono text-amber-700">{fmtSar(m.spent_total)}</span></Td>
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
      </div>
    </section>
  )
}

function statusFor(m: ProjectMetrics): { cls: string; label: string } {
  if (m.over_admin) {
    return { cls: 'bg-red-50 text-red-800 ring-red-200', label: 'تجاوز إداري' }
  }
  if (m.over_construction) {
    return { cls: 'bg-red-50 text-red-800 ring-red-200', label: 'تجاوز إنشائي' }
  }
  if (m.over_cash) {
    return { cls: 'bg-red-50 text-red-800 ring-red-200', label: 'تجاوز صرف' }
  }
  return { cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200', label: 'منتظم' }
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  )
}
function Td({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return <td className={`px-3 py-2.5 text-sm text-slate-700 align-top ${className}`}>{children}</td>
}
