/**
 * سجل المشترين — Buyers Register (per project)
 *
 * A rolled-up read of every unit in the project, its latest sale/buyer/
 * contract, and the collections (payments) accumulated against that sale.
 *
 * Data spine (see the data-model diagram):
 *   dsb_project_units  ← dsb_unit_sales  ← dsb_payments (via unit_id or
 *                                          via dsb_cases.sale_id → sale)
 *
 * Owner + supervisor + employee can view. Read-only.
 *
 * Rendering: one row per unit, expanded inline with buyer info + a
 * chronological list of payments. Totals per unit and a grand total at
 * the top.
 */
import React from 'react'
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ArrowRight, Users, TrendingUp, TrendingDown, Wallet } from 'lucide-react'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
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
function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(s + 'T00:00:00'))
  } catch {
    return s
  }
}

// ---------------------------------------------------------------------------
// Query shapes
// ---------------------------------------------------------------------------
type UnitRow = {
  id: string
  unit_number: string
  unit_type: string | null
  area_m2: number | null
  block_number: string | null
  zone_number: string | null
}
type SaleRow = {
  id: string
  unit_id: string
  sale_status: string | null
  contract_number: string | null
  buyer_name_ar: string | null
  buyer_phone: string | null
  buyer_id_number: string | null
  sale_date: string | null
  price_with_vat_sar: number | null
  price_before_tax_sar: number | null
  vat_sar: number | null
  total_collected_with_tax_sar: number | null
  remaining_amount_sar: number | null
  collection_percentage: number | null
  delivery_status: string | null
  delivery_date: string | null
  created_at: string
}
type PaymentRow = {
  id: string
  unit_id: string | null
  case_id: string | null
  payment_date: string
  amount_sar: number
  vat_sar: number | null
  beneficiary_name: string | null
  reference_number: string | null
  payment_method: string | null
  description: string | null
}
type ProjectLite = {
  id: string
  tenant_id: string
  code: string
  name_ar: string
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default async function BuyersRegisterReportPage({
  params,
  searchParams,
}: {
  params: { projectId: string }
  searchParams?: { delivery?: 'all' | 'delivered' | 'pending' }
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
  if (!dsbRole || !['employee', 'supervisor', 'owner', 'viewer'].includes(dsbRole)) {
    redirect('/app/disbursements')
  }

  const tenantId = profile.tenant_id as string
  const projectId = params.projectId

  // Project + tenant-scope guard.
  const { data: projectData } = await svc
    .from('dsb_projects')
    .select('id, tenant_id, code, name_ar')
    .eq('id', projectId)
    .maybeSingle()
  if (!projectData || (projectData as { tenant_id: string }).tenant_id !== tenantId) {
    notFound()
  }
  const project = projectData as ProjectLite

  // ---------- Units (rows of the report) ----------
  const { data: unitsData } = await svc
    .from('dsb_project_units')
    .select('id, unit_number, unit_type, area_m2, block_number, zone_number')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .order('unit_number', { ascending: true })
  const units = (unitsData ?? []) as UnitRow[]

  // ---------- Sales (latest per unit — active preferred) ----------
  const unitIds = units.map((u) => u.id)
  let sales: SaleRow[] = []
  if (unitIds.length > 0) {
    const { data: salesData } = await svc
      .from('dsb_unit_sales')
      .select('id, unit_id, sale_status, contract_number, buyer_name_ar, buyer_phone, buyer_id_number, sale_date, price_with_vat_sar, price_before_tax_sar, vat_sar, total_collected_with_tax_sar, remaining_amount_sar, collection_percentage, delivery_status, delivery_date, created_at')
      .eq('tenant_id', tenantId)
      .in('unit_id', unitIds)
      .order('created_at', { ascending: false })
    sales = (salesData ?? []) as SaleRow[]
  }
  // Reduce to one sale per unit: prefer sale_status='active', else newest.
  const saleByUnit = new Map<string, SaleRow>()
  for (const s of sales) {
    const prev = saleByUnit.get(s.unit_id)
    if (!prev) {
      saleByUnit.set(s.unit_id, s)
      continue
    }
    if (prev.sale_status !== 'active' && s.sale_status === 'active') {
      saleByUnit.set(s.unit_id, s)
    }
  }

  // ---------- Payments (all for this project) ----------
  // Matched two ways: dsb_payments.unit_id set directly, OR via case:
  // payment.case_id → dsb_cases.unit_id / .sale_id. We fetch all project
  // payments and let the grouping loop below pick which unit each belongs to.
  const { data: paymentsData } = await svc
    .from('dsb_payments')
    .select('id, unit_id, case_id, payment_date, amount_sar, vat_sar, beneficiary_name, reference_number, payment_method, description')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .order('payment_date', { ascending: true })
  const payments = (paymentsData ?? []) as PaymentRow[]

  // For payments with only case_id (no direct unit_id), resolve unit via case.
  const orphanCaseIds = Array.from(
    new Set(payments.filter((p) => !p.unit_id && p.case_id).map((p) => p.case_id!)),
  )
  const caseToUnitId = new Map<string, string | null>()
  if (orphanCaseIds.length > 0) {
    const { data: caseData } = await svc
      .from('dsb_cases')
      .select('id, unit_id')
      .eq('tenant_id', tenantId)
      .in('id', orphanCaseIds)
    for (const c of (caseData ?? []) as { id: string; unit_id: string | null }[]) {
      caseToUnitId.set(c.id, c.unit_id)
    }
  }

  // Group payments by resolved unit_id. Payments that can't be traced to a
  // unit fall into an "unassigned" bucket shown at the bottom.
  const paymentsByUnit = new Map<string, PaymentRow[]>()
  const unassignedPayments: PaymentRow[] = []
  for (const p of payments) {
    const uid = p.unit_id ?? (p.case_id ? caseToUnitId.get(p.case_id) ?? null : null)
    if (!uid) {
      unassignedPayments.push(p)
      continue
    }
    if (!paymentsByUnit.has(uid)) paymentsByUnit.set(uid, [])
    paymentsByUnit.get(uid)!.push(p)
  }

  // ---------- Grand totals ----------
  // Contracts often only carry price_before_tax_sar (developer files skip
  // the with-VAT column). Fall back so totals reflect what's in the file.
  const priceOf = (s: SaleRow | undefined): number | null =>
    s?.price_with_vat_sar ?? s?.price_before_tax_sar ?? null

  const grandTotals = {
    unitsCount: units.length,
    soldCount: 0,
    contractsTotal: 0,
    paymentsTotal: 0,
    remaining: 0,
  }
  for (const u of units) {
    const sale = saleByUnit.get(u.id)
    if (sale) grandTotals.soldCount += 1
    const price = priceOf(sale)
    if (price) grandTotals.contractsTotal += price
    const paid = (paymentsByUnit.get(u.id) ?? []).reduce((s, p) => s + Number(p.amount_sar || 0), 0)
    grandTotals.paymentsTotal += paid
    if (price) {
      grandTotals.remaining += Math.max(0, price - paid)
    }
  }
  const unassignedTotal = unassignedPayments.reduce((s, p) => s + Number(p.amount_sar || 0), 0)

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      {/* Breadcrumb */}
      <Link
        href={`/app/disbursements/admin/projects/${projectId}`}
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        العودة إلى المشروع
      </Link>

      {/* Header */}
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <Users className="w-4 h-4" aria-hidden="true" />
          سجل المشترين
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            {project.name_ar}
          </h1>
          <span className="font-mono text-sm text-slate-500">{project.code}</span>
        </div>
        <p className="text-sm text-slate-600">
          كل وحدة مع عقدها والمشتري وسجل التحصيل المرتبط بها.
        </p>
      </header>

      {/* Grand-total scorecards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Scorecard label="عدد الوحدات" value={String(grandTotals.unitsCount)} sub={`${grandTotals.soldCount} مباعة`} tint="slate" />
        <Scorecard label="إجمالي العقود" value={fmtSar(grandTotals.contractsTotal)} icon={<Wallet className="w-4 h-4" />} tint="indigo" />
        <Scorecard label="إجمالي المحصَّل" value={fmtSar(grandTotals.paymentsTotal)} icon={<TrendingUp className="w-4 h-4" />} tint="emerald" />
        <Scorecard label="المتبقّي" value={fmtSar(grandTotals.remaining)} icon={<TrendingDown className="w-4 h-4" />} tint="amber" />
      </section>

      {/* Delivery-status filter chips. Filters purely client-side on the
          server-rendered rows by hiding non-matching <tr>s in this JSX
          (server component, no state — we do the filter here). */}
      {(() => {
        const active = (searchParams?.delivery ?? 'all') as 'all' | 'delivered' | 'pending'
        const base = `/app/disbursements/admin/projects/${projectId}/reports/buyers-register`
        const link = (v: 'all' | 'delivered' | 'pending') =>
          v === 'all' ? base : `${base}?delivery=${v}`
        // Counts per bucket for the chip labels.
        let deliveredCount = 0
        let pendingCount = 0
        for (const u of units) {
          const s = saleByUnit.get(u.id)
          if (!s) continue
          if (s.delivery_status === 'delivered') deliveredCount += 1
          else pendingCount += 1
        }
        return (
          <section className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">تصفية بالتسليم:</span>
            {(['all', 'delivered', 'pending'] as const).map((v) => {
              const label =
                v === 'all'
                  ? `الكل (${units.length})`
                  : v === 'delivered'
                  ? `مُسلَّمة (${deliveredCount})`
                  : `غير مُسلَّمة (${units.length - deliveredCount})`
              const isActive = active === v
              return (
                <Link
                  key={v}
                  href={link(v)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                    isActive
                      ? 'bg-teal-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </Link>
              )
            })}
          </section>
        )
      })()}

      {/* Per-unit table */}
      {units.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500 shadow-sm">
          لم تُدخَل وحدات لهذا المشروع بعد. ابدأ من «قائمة الوحدات» في «الاستيرادات».
        </div>
      ) : (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-right">
                  <Th>الوحدة</Th>
                  <Th>المشتري</Th>
                  <Th>العقد</Th>
                  <Th>التسليم</Th>
                  <Th>السعر</Th>
                  <Th>المحصَّل</Th>
                  <Th>المتبقّي</Th>
                  <Th>عدد الدفعات</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {units.map((u) => {
                  const sale = saleByUnit.get(u.id)
                  // Server-side filter: skip rows that don't match the
                  // currently selected delivery chip. We do this inline
                  // instead of pre-filtering `units` so counts + totals
                  // above remain accurate across all units.
                  const active = (searchParams?.delivery ?? 'all') as 'all' | 'delivered' | 'pending'
                  if (active === 'delivered' && sale?.delivery_status !== 'delivered') return null
                  if (active === 'pending' && sale?.delivery_status === 'delivered') return null

                  const pays = paymentsByUnit.get(u.id) ?? []
                  const collected = pays.reduce((s, p) => s + Number(p.amount_sar || 0), 0)
                  // Fall back to before-tax when the file omits with-VAT
                  // (common — most developer files only have one price col).
                  const rowPrice = sale?.price_with_vat_sar ?? sale?.price_before_tax_sar ?? null
                  const remaining = rowPrice != null
                    ? Math.max(0, rowPrice - collected)
                    : null
                  return (
                    <React.Fragment key={u.id}>
                      <tr className="hover:bg-slate-50/70">
                        <Td>
                          <div className="font-mono font-semibold text-slate-900">
                            {u.unit_number}
                          </div>
                          {u.unit_type && (
                            <div className="text-[11px] text-slate-500">{unitTypeLabel(u.unit_type)}</div>
                          )}
                        </Td>
                        <Td>
                          {sale?.buyer_name_ar ? (
                            <>
                              <div className="text-slate-900">{sale.buyer_name_ar}</div>
                              {sale.buyer_phone && (
                                <div className="text-[11px] font-mono text-slate-500" dir="ltr">
                                  {sale.buyer_phone}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-400 italic text-xs">لم تُبَع</span>
                          )}
                        </Td>
                        <Td>
                          <span className="font-mono text-xs">
                            {sale?.contract_number ?? '—'}
                          </span>
                          {sale?.sale_date && (
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {fmtDate(sale.sale_date)}
                            </div>
                          )}
                        </Td>
                        <Td>
                          {!sale ? (
                            <span className="text-slate-400 text-xs">—</span>
                          ) : sale.delivery_status === 'delivered' ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200">
                              مُسلَّمة
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200">
                              غير مُسلَّمة
                            </span>
                          )}
                          {sale?.delivery_date && (
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {fmtDate(sale.delivery_date)}
                            </div>
                          )}
                        </Td>
                        <Td>
                          <span className="font-mono text-slate-900">
                            {fmtSar(rowPrice)}
                          </span>
                          {rowPrice != null && sale?.price_with_vat_sar == null && (
                            <div className="text-[10px] text-slate-500">قبل الضريبة</div>
                          )}
                        </Td>
                        <Td>
                          <span className="font-mono font-semibold text-emerald-700">
                            {fmtSar(collected)}
                          </span>
                        </Td>
                        <Td>
                          <span className="font-mono text-amber-700">
                            {fmtSar(remaining)}
                          </span>
                        </Td>
                        <Td>
                          <span className="text-slate-700 font-mono">{pays.length}</span>
                        </Td>
                      </tr>
                      {pays.length > 0 && (
                        <tr className="bg-slate-50/40">
                          <td colSpan={7} className="px-4 py-3">
                            <details>
                              <summary className="cursor-pointer text-[11px] font-semibold text-teal-700 hover:text-teal-900 inline-flex items-center gap-1">
                                عرض الدفعات ({pays.length})
                              </summary>
                              <div className="mt-3 overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead className="text-slate-500 uppercase text-[10px]">
                                    <tr className="text-right">
                                      <th className="px-2 py-1.5">التاريخ</th>
                                      <th className="px-2 py-1.5">المبلغ</th>
                                      <th className="px-2 py-1.5">المستفيد</th>
                                      <th className="px-2 py-1.5">المرجع</th>
                                      <th className="px-2 py-1.5">الطريقة</th>
                                      <th className="px-2 py-1.5">البيان</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-200/60">
                                    {pays.map((p) => (
                                      <tr key={p.id} className="text-slate-700">
                                        <td className="px-2 py-1.5">{fmtDate(p.payment_date)}</td>
                                        <td className="px-2 py-1.5 font-mono font-semibold text-emerald-700">
                                          {fmtSar(p.amount_sar)}
                                        </td>
                                        <td className="px-2 py-1.5">{p.beneficiary_name ?? '—'}</td>
                                        <td className="px-2 py-1.5 font-mono">
                                          {p.reference_number ?? '—'}
                                        </td>
                                        <td className="px-2 py-1.5">{p.payment_method ?? '—'}</td>
                                        <td className="px-2 py-1.5 max-w-xs truncate" title={p.description ?? undefined}>
                                          {p.description ?? '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </details>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Unassigned payments (couldn't be traced to a unit) */}
      {unassignedPayments.length > 0 && (
        <section className="bg-white border border-amber-200 rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h2 className="serif font-bold text-base text-slate-900">
              دفعات غير مرتبطة بوحدة
              <span className="text-slate-400 font-mono text-xs mr-2">
                ({unassignedPayments.length})
              </span>
            </h2>
            <div className="text-sm font-mono text-amber-700 font-bold">
              {fmtSar(unassignedTotal)}
            </div>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            هذه الدفعات مُسجَّلة على مستوى المشروع دون رقم وحدة أو رقم طلب مطابق. لتوصيلها بالوحدة، أضِف
            رقم الوحدة إلى ملف Excel وأعِد الاستيراد، أو اربط الطلب يدويًا من صفحة الطلب.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-500 uppercase text-[10px]">
                <tr className="text-right">
                  <th className="px-2 py-1.5">التاريخ</th>
                  <th className="px-2 py-1.5">المبلغ</th>
                  <th className="px-2 py-1.5">المستفيد</th>
                  <th className="px-2 py-1.5">المرجع</th>
                  <th className="px-2 py-1.5">البيان</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60">
                {unassignedPayments.map((p) => (
                  <tr key={p.id} className="text-slate-700">
                    <td className="px-2 py-1.5">{fmtDate(p.payment_date)}</td>
                    <td className="px-2 py-1.5 font-mono font-semibold text-slate-900">
                      {fmtSar(p.amount_sar)}
                    </td>
                    <td className="px-2 py-1.5">{p.beneficiary_name ?? '—'}</td>
                    <td className="px-2 py-1.5 font-mono">{p.reference_number ?? '—'}</td>
                    <td className="px-2 py-1.5 max-w-md truncate" title={p.description ?? undefined}>
                      {p.description ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------
/** Same helper used across the units + عقود pages. */
function unitTypeLabel(t: string | null): string {
  if (!t) return '—'
  const k = t.toLowerCase().trim()
  if (k === 'villa') return 'فيلا'
  if (k === 'apartment') return 'شقة'
  if (k === 'other') return 'أخرى'
  return t
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  )
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2.5 text-sm text-slate-700 align-top">{children}</td>
}

function Scorecard({
  label,
  value,
  sub,
  icon,
  tint,
}: {
  label: string
  value: string
  sub?: string
  icon?: React.ReactNode
  tint: 'slate' | 'indigo' | 'emerald' | 'amber'
}) {
  const cls = {
    slate: 'border-slate-200 bg-white',
    indigo: 'border-indigo-200 bg-indigo-50/40',
    emerald: 'border-emerald-200 bg-emerald-50/40',
    amber: 'border-amber-200 bg-amber-50/40',
  }[tint]
  const iconCls = {
    slate: 'text-slate-500',
    indigo: 'text-indigo-600',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
  }[tint]
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="flex items-center gap-1.5">
        {icon && <span className={iconCls}>{icon}</span>}
        <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      </div>
      <div className="text-lg font-black text-slate-900 mt-1 font-mono">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}
