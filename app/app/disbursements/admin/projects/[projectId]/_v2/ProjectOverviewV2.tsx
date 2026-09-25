/**
 * ProjectOverviewV2 — enriched project overview page.
 *
 * Layout (top → bottom, RTL):
 *   1. Breadcrumb + project header + "إضافة عقد" primary action
 *   2. Chip nav
 *   3. Quick actions strip (compact icon buttons)
 *   4. 6 KPI cards
 *   5. Compliance bars strip (admin/marketing 20 % · escrow 4 % · construction 76 %)
 *   6. Two-col mid section — recent activity table  |  pending queue
 *   7. Two-col bottom section — spend breakdown by main type  |  unit lifecycle bars
 *
 * All queries fan out in a single Promise.all at the top. Everything is
 * server-rendered.
 */
import Link from 'next/link'
import { createSupabaseService } from '@/lib/supabase/server'
import {
  AlertTriangle, ArrowLeft, FileDown, Settings2, Upload,
  Activity, Clock, PieChart, Layers, ShieldCheck,
} from 'lucide-react'
import { Breadcrumb } from './Breadcrumb'
import { ProjectChipNav } from './ProjectChipNav'
import {
  resolveMainForSub,
  resolveMainDisbursementLabel,
} from '@/lib/dsb/category-labels'

type Props = {
  projectId: string
  tenantId: string
  dsbRole: string | null
  project: {
    id: string
    name_ar: string
    code: string
    developer_name: string | null
  }
}

function fmtSarShort(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return String(Math.round(n))
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      day: 'numeric', month: 'short', year: 'numeric',
    }).format(new Date(s))
  } catch { return s }
}

// Status → visible label + pill classes. Kept local so this file is
// self-contained.
function caseStatusPill(status: string): { cls: string; label: string } {
  switch (status) {
    case 'draft':                 return { cls: 'bg-slate-100 text-slate-600 ring-slate-200', label: 'مسودة' }
    case 'with_employee':         return { cls: 'bg-amber-50 text-amber-800 ring-amber-200', label: 'بانتظار الموظف' }
    case 'with_supervisor':       return { cls: 'bg-amber-50 text-amber-800 ring-amber-200', label: 'بانتظار السوبرفايزر' }
    case 'with_owner':            return { cls: 'bg-amber-50 text-amber-800 ring-amber-200', label: 'بانتظار المدير' }
    case 'signed':                return { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'موقّع' }
    case 'sent_back_to_developer':return { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'مرتجع' }
    case 'cancelled':             return { cls: 'bg-slate-100 text-slate-500 ring-slate-200', label: 'ملغى' }
    case 'rejected':              return { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'مرفوض' }
    default:                      return { cls: 'bg-slate-100 text-slate-600 ring-slate-200', label: status }
  }
}

// Which case status is the current role's inbox?
function myActionStatus(role: string | null): string | null {
  switch (role) {
    case 'employee':   return 'with_employee'
    case 'supervisor': return 'with_supervisor'
    case 'owner':      return 'with_owner'
    default:           return null
  }
}

export async function ProjectOverviewV2({ projectId, tenantId, dsbRole, project }: Props) {
  const svc = createSupabaseService()

  const [
    unitsRes,
    activeSalesRes,
    deliveredSalesRes,
    paymentsRes,
    casesRes,
    tenantRes,
  ] = await Promise.all([
    svc.from('dsb_project_units')
      .select('id, completion_status', { count: 'exact' })
      .eq('tenant_id', tenantId).eq('project_id', projectId)
      .limit(20000),
    svc.from('dsb_unit_sales')
      .select('id, price_with_vat_sar', { count: 'exact' })
      .eq('tenant_id', tenantId).eq('project_id', projectId)
      .eq('sale_status', 'active')
      .limit(20000),
    svc.from('dsb_unit_sales')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('project_id', projectId)
      .eq('delivery_status', 'delivered'),
    svc.from('dsb_payments')
      .select('id, amount_sar, deposit_category, payment_date, beneficiary_name, description')
      .eq('tenant_id', tenantId).eq('project_id', projectId)
      .order('payment_date', { ascending: false })
      .limit(500),
    svc.from('dsb_cases')
      .select('id, case_number, amount_sar, status, created_at, signed_at, extracted_fields')
      .eq('tenant_id', tenantId).eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(2000),
    svc.from('tenants')
      .select('disbursement_type_main, disbursement_main_types')
      .eq('id', tenantId)
      .maybeSingle(),
  ])

  // ----- Units -----------------------------------------------------------
  const unitsCount = unitsRes.count ?? 0
  const unitsRows = (unitsRes.data ?? []) as Array<{ id: string; completion_status: string | null }>
  const unitsCompleted = unitsRows.filter(u => u.completion_status === 'completed').length
  const unitsNotCompleted = unitsRows.filter(u => u.completion_status !== 'completed').length

  // ----- Sales / delivery -----------------------------------------------
  const activeSalesCount = activeSalesRes.count ?? 0
  const activeSalesRows = (activeSalesRes.data ?? []) as Array<{ price_with_vat_sar: number | null }>
  const totalSoldValue = activeSalesRows.reduce((s, r) => s + Number(r.price_with_vat_sar || 0), 0)
  const deliveredCount = deliveredSalesRes.count ?? 0
  const soldPct = unitsCount > 0 ? Math.round((activeSalesCount / unitsCount) * 100) : 0

  // ----- Payments (collected) -------------------------------------------
  type PayRow = {
    id: string; amount_sar: number | null; deposit_category: string | null;
    payment_date: string | null; beneficiary_name: string | null; description: string | null;
  }
  const allPayments = (paymentsRes.data ?? []) as PayRow[]
  const collected = allPayments
    .filter(p => p.deposit_category === 'buyer_collection')
    .reduce((s, p) => s + Number(p.amount_sar || 0), 0)

  // ----- Cases (spend, breakdown, pending) ------------------------------
  type CaseRow = {
    id: string; case_number: string; amount_sar: number | null; status: string;
    created_at: string; signed_at: string | null;
    extracted_fields: Record<string, unknown> | null;
  }
  const allCases = (casesRes.data ?? []) as CaseRow[]
  const spentCases = allCases.filter(c => c.status === 'signed')
  const spent = spentCases.reduce((s, c) => s + Number(c.amount_sar || 0), 0)
  const escrowBalance = collected - spent

  const spentPctOfCollected = collected > 0 ? (spent / collected) * 100 : 0

  // Per-sub-type spend for compliance bars + main-type breakdown.
  const subToMain = (tenantRes.data?.disbursement_type_main ?? null) as Record<string, string> | null
  const mainLabels = (tenantRes.data?.disbursement_main_types ?? null) as Record<string, string> | null

  let adminMarketingSpend = 0
  let constructionSpend = 0
  const spendByMain = new Map<string, number>()
  for (const c of spentCases) {
    const sub = String(
      (c.extracted_fields as { disbursement_type_code?: unknown } | null)?.disbursement_type_code ?? '',
    ).trim()
    const amt = Number(c.amount_sar || 0)
    if (sub === 'admin_marketing') adminMarketingSpend += amt
    if (sub === 'construction') constructionSpend += amt
    const main = resolveMainForSub(sub, subToMain)
    spendByMain.set(main, (spendByMain.get(main) ?? 0) + amt)
  }

  // Compliance ratios (of collected).
  const adminPct        = collected > 0 ? (adminMarketingSpend / collected) * 100 : 0
  const escrowPct       = collected > 0 ? (escrowBalance / collected) * 100 : 0
  const constructionPct = collected > 0 ? (constructionSpend / collected) * 100 : 0

  function toneAdmin(p: number)        { return p <= 20 ? 'emerald' : p <= 25 ? 'amber' : 'red' }
  function toneEscrow(p: number)       { return p >= 4  ? 'emerald' : p >= 3  ? 'amber' : 'red' }
  function toneConstruction(p: number) { return p <= 76 ? 'emerald' : p <= 85 ? 'amber' : 'red' }

  // My pending inbox count (cases the current role should action).
  const myStatus = myActionStatus(dsbRole)
  const myPending = myStatus ? allCases.filter(c => c.status === myStatus).length : 0

  // Pending queue grouped for the sidebar.
  const pendingBuckets: Array<{ status: string; label: string; count: number; href: string }> = [
    { status: 'with_employee',   label: 'بانتظار توقيع الموظف',       count: 0, href: '' },
    { status: 'with_supervisor', label: 'بانتظار توقيع السوبرفايزر',  count: 0, href: '' },
    { status: 'with_owner',      label: 'بانتظار توقيع المدير',        count: 0, href: '' },
    { status: 'sent_back_to_developer', label: 'مرتجعة إلى المطور',   count: 0, href: '' },
  ]
  for (const c of allCases) {
    const b = pendingBuckets.find(b => b.status === c.status)
    if (b) b.count += 1
  }
  for (const b of pendingBuckets) {
    b.href = `/app/disbursements/admin/projects/${projectId}?layout=new&status=${b.status}`
  }

  // ----- Recent activity (cases + payments interleaved) ------------------
  type ActivityRow = {
    kind: 'case' | 'payment'
    date: string | null
    label: string
    party: string
    amount: number | null
    status: string | null
    href: string
  }
  const activity: ActivityRow[] = []
  for (const c of allCases.slice(0, 30)) {
    activity.push({
      kind: 'case',
      date: c.signed_at ?? c.created_at,
      label: `سند صرف ${c.case_number}`,
      party: String((c.extracted_fields as { beneficiary_name?: unknown } | null)?.beneficiary_name ?? '—'),
      amount: Number(c.amount_sar || 0),
      status: c.status,
      href: `/app/disbursements/${c.id}`,
    })
  }
  for (const p of allPayments.slice(0, 30)) {
    activity.push({
      kind: 'payment',
      date: p.payment_date,
      label: p.deposit_category === 'buyer_collection' ? 'تحصيل مشتري' : (p.description ?? 'دفعة'),
      party: p.beneficiary_name ?? '—',
      amount: Number(p.amount_sar || 0),
      status: p.deposit_category,
      href: `/app/disbursements/admin/projects/${projectId}/payments`,
    })
  }
  activity.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0
    const db = b.date ? new Date(b.date).getTime() : 0
    return db - da
  })
  const recentActivity = activity.slice(0, 10)

  // ----- Spend breakdown for the donut/bars ------------------------------
  const spendBreakdown = Array.from(spendByMain.entries())
    .map(([code, amount]) => ({
      code,
      amount,
      label: resolveMainDisbursementLabel(code, mainLabels),
    }))
    .sort((a, b) => b.amount - a.amount)
  const spendTotal = spendBreakdown.reduce((s, r) => s + r.amount, 0)
  const mainPalette: Record<string, string> = {
    main_construction:    'bg-teal-500',
    main_admin_marketing: 'bg-amber-500',
    main_customer_refund: 'bg-sky-500',
    main_bank_fees:       'bg-slate-500',
    main_other:           'bg-slate-400',
  }

  const canWrite = ['employee', 'supervisor', 'owner'].includes(dsbRole ?? '')

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-5" dir="rtl">
      {/* Breadcrumb + escape hatch to legacy view */}
      <div className="flex items-center justify-between">
        <Breadcrumb
          items={[
            { label: 'الرئيسية',  href: '/app/disbursements' },
            { label: 'المشاريع',  href: '/app/disbursements/admin/projects' },
            { label: project.name_ar },
          ]}
        />
        <Link
          href={`/app/disbursements/admin/projects/${projectId}`}
          className="text-[11px] text-slate-400 hover:text-slate-700 flex items-center gap-1"
          title="عرض الشاشة الكاملة (النسخة القديمة)"
        >
          <ArrowLeft className="w-3 h-3" aria-hidden="true" />
          العرض القديم
        </Link>
      </div>

      {/* Project header */}
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">{project.name_ar}</h1>
          <p className="text-xs text-slate-500 mt-1">
            <span className="font-mono">{project.code}</span>
            {project.developer_name && (<> · {project.developer_name}</>)}
          </p>
        </div>
        {canWrite && (
          <Link
            href={`/app/disbursements/admin/projects/${projectId}/buyer-contracts`}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold shadow-sm"
          >
            إضافة عقد
          </Link>
        )}
      </header>

      <ProjectChipNav projectId={projectId} active="overview" />

      {/* Quick actions strip */}
      <section className="flex flex-wrap gap-2">
        <QuickAction
          href={`/app/disbursements/admin/projects/${projectId}/setup`}
          icon={<Settings2 className="w-3.5 h-3.5" aria-hidden="true" />}
          label="التهيئة"
        />
        {canWrite && (
          <QuickAction
            href={`/app/disbursements/admin/imports/contracts?project=${projectId}`}
            icon={<Upload className="w-3.5 h-3.5" aria-hidden="true" />}
            label="استيراد عقود"
          />
        )}
        <QuickAction
          href={`/api/dsb-buyers-register-xlsx?project=${projectId}`}
          icon={<FileDown className="w-3.5 h-3.5" aria-hidden="true" />}
          label="سجل المشترين"
        />
        <QuickAction
          href={`/api/dsb-accountant-workbook-xlsx?project=${projectId}&quarter=Q2&year=${new Date().getFullYear()}`}
          icon={<FileDown className="w-3.5 h-3.5" aria-hidden="true" />}
          label="نموذج المحاسب"
        />
        <QuickAction
          href={`/api/dsb-delivery-notice?project=${projectId}&quarter=Q2&year=${new Date().getFullYear()}`}
          icon={<FileDown className="w-3.5 h-3.5" aria-hidden="true" />}
          label="إشعار تسليم"
        />
      </section>

      {/* KPI grid — 6 cards */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi
          label="الوحدات"
          value={String(unitsCount)}
          caption={`مباعة ${activeSalesCount} · ${soldPct}%`}
        />
        <Kpi
          label="العقود"
          value={String(activeSalesCount)}
          caption={`مسلمة ${deliveredCount}`}
        />
        <Kpi
          label="المحصّل"
          value={fmtSarShort(collected)} suffix="ر.س" tone="emerald"
          caption={`من ${fmtSarShort(totalSoldValue)}`}
        />
        <Kpi
          label="المصروف"
          value={fmtSarShort(spent)} suffix="ر.س"
          tone={spentPctOfCollected > 100 ? 'red' : undefined}
          caption={collected > 0 ? `${spentPctOfCollected.toFixed(0)}% من المحصّل` : '—'}
          captionTone={spentPctOfCollected > 100 ? 'red' : undefined}
        />
        <Kpi
          label="رصيد الضمان"
          value={fmtSarShort(escrowBalance)} suffix="ر.س"
          tone={escrowBalance < 0 ? 'red' : 'emerald'}
        />
        <Kpi
          label="في انتظاري"
          value={String(myPending)}
          tone={myPending > 0 ? 'emerald' : undefined}
          caption={myStatus ? caseStatusPill(myStatus).label : 'لا يوجد صلاحية'}
        />
      </section>

      {/* Compliance bars */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <SectionTitle icon={<ShieldCheck className="w-4 h-4 text-teal-600" />} label="مؤشرات الالتزام" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
          <ComplianceBar
            label="سقف الإداري والتسويقي"
            hint="الحد الأعلى 20% من المحصّل"
            pct={adminPct}
            tone={toneAdmin(adminPct)}
            capPct={20}
          />
          <ComplianceBar
            label="حساب الحفظ"
            hint="الحد الأدنى 4% من المحصّل"
            pct={escrowPct}
            tone={toneEscrow(escrowPct)}
            capPct={100}
            markerPct={4}
          />
          <ComplianceBar
            label="التكلفة الإنشائية"
            hint="الحد الأعلى 76% من المحصّل"
            pct={constructionPct}
            tone={toneConstruction(constructionPct)}
            capPct={100}
            markerPct={76}
          />
        </div>
      </section>

      {/* No-data hint */}
      {collected === 0 && (
        <section className="rounded-lg bg-amber-50 ring-1 ring-inset ring-amber-200 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-amber-900">لا توجد دفعات محصّلة بعد</div>
            <div className="text-xs text-amber-800 opacity-80">راجع سجل الدفعات أو استورد الدفعات التاريخية.</div>
          </div>
          <Link
            href={`/app/disbursements/admin/projects/${projectId}/payments`}
            className="text-xs font-semibold text-amber-900 underline decoration-amber-500"
          >
            عرض
          </Link>
        </section>
      )}

      {/* Recent activity + pending queue */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <SectionTitle
              icon={<Activity className="w-4 h-4 text-teal-600" />}
              label={`آخر العمليات على هذا المشروع (${recentActivity.length})`}
            />
          </div>
          {recentActivity.length === 0 ? (
            <div className="text-xs text-slate-500 py-6 text-center">لا توجد عمليات بعد.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[11px] text-slate-500 font-semibold border-b border-slate-100">
                    <th className="text-right py-2 font-semibold">العملية</th>
                    <th className="text-right py-2 font-semibold">الطرف</th>
                    <th className="text-right py-2 font-semibold">التاريخ</th>
                    <th className="text-right py-2 font-semibold">المبلغ</th>
                    <th className="text-right py-2 font-semibold">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {recentActivity.map((r, i) => {
                    const pill = r.kind === 'case'
                      ? caseStatusPill(r.status ?? '')
                      : { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'مُحصّل' }
                    return (
                      <tr key={i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                        <td className="py-2">
                          <Link href={r.href} className="text-slate-800 hover:text-teal-700 font-semibold">
                            {r.label}
                          </Link>
                        </td>
                        <td className="py-2 text-slate-600">{r.party}</td>
                        <td className="py-2 text-slate-500 font-mono text-[11px]">{fmtDate(r.date)}</td>
                        <td className="py-2 text-slate-800 font-mono">{fmtSarShort(r.amount ?? 0)}</td>
                        <td className="py-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full ring-1 text-[10px] font-semibold ${pill.cls}`}>
                            {pill.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <SectionTitle icon={<Clock className="w-4 h-4 text-teal-600" />} label="في انتظار الإجراء" />
          <ul className="mt-3 space-y-2">
            {pendingBuckets.filter(b => b.count > 0).length === 0 && (
              <li className="text-xs text-slate-500 py-6 text-center">لا شيء بانتظار الإجراء.</li>
            )}
            {pendingBuckets.filter(b => b.count > 0).map(b => (
              <li key={b.status} className="flex items-center justify-between gap-2 border border-slate-100 rounded-lg px-3 py-2 hover:bg-slate-50">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex items-center justify-center min-w-[1.75rem] h-6 px-2 rounded-md bg-amber-50 text-amber-800 ring-1 ring-amber-200 text-xs font-bold font-mono">
                    {b.count}
                  </span>
                  <span className="text-xs text-slate-700 truncate">{b.label}</span>
                </div>
                <Link href={b.href} className="text-[11px] font-semibold text-teal-700 hover:text-teal-800 whitespace-nowrap">
                  فتح
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Spend breakdown + unit lifecycle */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <SectionTitle icon={<PieChart className="w-4 h-4 text-teal-600" />} label="توزيع المصروف" />
          {spendBreakdown.length === 0 ? (
            <div className="text-xs text-slate-500 py-6 text-center">لا يوجد مصروف بعد.</div>
          ) : (
            <div className="mt-3 space-y-2">
              {spendBreakdown.map(row => {
                const pct = spendTotal > 0 ? (row.amount / spendTotal) * 100 : 0
                const barCls = mainPalette[row.code] ?? 'bg-slate-400'
                return (
                  <div key={row.code}>
                    <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1">
                      <span className="font-semibold text-slate-800 truncate">{row.label}</span>
                      <span className="font-mono">{fmtSarShort(row.amount)} · {pct.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`${barCls} h-full rounded-full transition-all`}
                        style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
                      />
                    </div>
                  </div>
                )
              })}
              <div className="pt-2 mt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-semibold">الإجمالي</span>
                <span className="font-mono text-slate-800">{fmtSarShort(spendTotal)} ر.س</span>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <SectionTitle icon={<Layers className="w-4 h-4 text-teal-600" />} label="دورة حياة الوحدات" />
          <div className="mt-3 space-y-3">
            <LifecycleBar label="غير منجزة"       count={unitsNotCompleted} total={unitsCount} color="bg-slate-400" />
            <LifecycleBar label="منجزة إنشائيًا" count={unitsCompleted}    total={unitsCount} color="bg-teal-500"  />
            <LifecycleBar label="مباعة"           count={activeSalesCount}  total={unitsCount} color="bg-amber-500" />
            <LifecycleBar label="مسلمة للمشتري"  count={deliveredCount}    total={unitsCount} color="bg-emerald-500" />
          </div>
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
      {icon}
      <span>{label}</span>
    </div>
  )
}

function Kpi({
  label, value, suffix, tone, caption, captionTone,
}: {
  label: string
  value: string
  suffix?: string
  tone?: 'emerald' | 'amber' | 'red'
  caption?: string
  captionTone?: 'red' | 'emerald'
}) {
  const toneCls =
    tone === 'emerald' ? 'text-emerald-700' :
    tone === 'amber'   ? 'text-amber-700'   :
    tone === 'red'     ? 'text-red-700'     : 'text-slate-900'
  const capCls =
    captionTone === 'red'     ? 'text-red-600 font-semibold' :
    captionTone === 'emerald' ? 'text-emerald-700 font-semibold' :
    'text-slate-500'
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <div className="text-[11px] text-slate-500 font-semibold">{label}</div>
      <div className={`mt-1 flex items-baseline gap-1 ${toneCls}`}>
        <span className="text-2xl font-bold font-mono">{value}</span>
        {suffix && <span className="text-[10px] text-slate-400 font-semibold">{suffix}</span>}
      </div>
      {caption && <div className={`mt-1 text-[11px] ${capCls}`}>{caption}</div>}
    </div>
  )
}

function QuickAction({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-xs font-semibold text-slate-700 transition"
    >
      {icon}
      {label}
    </Link>
  )
}

function ComplianceBar({
  label, hint, pct, tone, capPct, markerPct,
}: {
  label: string
  hint: string
  pct: number
  tone: 'emerald' | 'amber' | 'red'
  /** Full-scale of the bar (100 by default). Admin/marketing uses 25 so the 20 % cap is visible. */
  capPct: number
  /** Optional marker line drawn as a vertical tick (e.g. 4 % floor, 76 % cap). */
  markerPct?: number
}) {
  const barCls =
    tone === 'emerald' ? 'bg-emerald-500' :
    tone === 'amber'   ? 'bg-amber-500'   : 'bg-red-500'
  const textCls =
    tone === 'emerald' ? 'text-emerald-700' :
    tone === 'amber'   ? 'text-amber-700'   : 'text-red-700'
  const clamped = Math.max(0, Math.min(capPct, pct))
  const widthPct = capPct > 0 ? (clamped / capPct) * 100 : 0
  const markerLeft = markerPct != null && capPct > 0 ? (markerPct / capPct) * 100 : null
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-xs font-semibold text-slate-800">{label}</div>
        <div className={`text-xs font-mono font-bold ${textCls}`}>{pct.toFixed(1)}%</div>
      </div>
      <div className="relative h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`${barCls} h-full rounded-full transition-all`}
          style={{ width: `${widthPct}%` }}
        />
        {markerLeft != null && (
          <span
            className="absolute top-0 bottom-0 w-px bg-slate-500/70"
            style={{ right: `${markerLeft}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="mt-1 text-[10px] text-slate-500">{hint}</div>
    </div>
  )
}

function LifecycleBar({
  label, count, total, color,
}: {
  label: string
  count: number
  total: number
  color: string
}) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1">
        <span className="font-semibold text-slate-800">{label}</span>
        <span className="font-mono">{count} / {total}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`${color} h-full rounded-full transition-all`}
          style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  )
}
