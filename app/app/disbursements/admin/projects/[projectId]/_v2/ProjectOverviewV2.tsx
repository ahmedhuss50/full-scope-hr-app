/**
 * ProjectOverviewV2 — the reorganized project overview page.
 *
 * Trimmed from the ~10-card v1 layout to:
 *   • breadcrumb + project header + primary action
 *   • project chip-nav (persistent across all project subpages)
 *   • 4 KPI tiles (units, contracts, collected, remaining)
 *   • optional alerts strip
 *   • quick-actions row (uploads, report exports)
 *
 * Everything else (vendors detail, cases, checklists, project accounts,
 * REGA reports) is one click away via the chip nav. This file is inside
 * the `_v2/` folder so the whole reorg can be reverted by removing the
 * folder and the `?layout=new` branch in page.tsx.
 */
import Link from 'next/link'
import { createSupabaseService } from '@/lib/supabase/server'
import { AlertTriangle, ArrowLeft, FileDown, Settings2, Upload } from 'lucide-react'
import { Breadcrumb } from './Breadcrumb'
import { ProjectChipNav } from './ProjectChipNav'

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

export async function ProjectOverviewV2({ projectId, tenantId, dsbRole, project }: Props) {
  const svc = createSupabaseService()

  // Counts + rollups — one query each, all cheap.
  const [{ count: unitsCount }, { count: contractsCount }, { data: paymentsRows }] = await Promise.all([
    svc.from('dsb_project_units').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('project_id', projectId),
    svc.from('dsb_unit_sales').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('project_id', projectId),
    svc.from('dsb_payments').select('amount_sar, price_reference_sar, deposit_category')
      .eq('tenant_id', tenantId).eq('project_id', projectId)
      .in('deposit_category', ['buyer_collection'])
      .limit(10000),
  ])

  let collected = 0
  for (const p of ((paymentsRows ?? []) as Array<{ amount_sar: number | null }>)) {
    collected += Number(p.amount_sar || 0)
  }
  // Remaining = sum of price_with_vat_sar across all active sales minus collected.
  const { data: activeSalesTotals } = await svc
    .from('dsb_unit_sales')
    .select('price_with_vat_sar')
    .eq('tenant_id', tenantId).eq('project_id', projectId)
    .eq('sale_status', 'active')
    .limit(10000)
  let totalPrice = 0
  for (const s of ((activeSalesTotals ?? []) as Array<{ price_with_vat_sar: number | null }>)) {
    totalPrice += Number(s.price_with_vat_sar || 0)
  }
  const remaining = Math.max(0, totalPrice - collected)

  const canWrite = ['employee', 'supervisor', 'owner'].includes(dsbRole ?? '')

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-5" dir="rtl">
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

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="الوحدات"  value={String(unitsCount ?? 0)} />
        <Kpi label="العقود"   value={String(contractsCount ?? 0)} />
        <Kpi label="المحصل"   value={fmtSarShort(collected)} suffix="ر.س" tone="emerald" />
        <Kpi label="المتبقي"  value={fmtSarShort(remaining)} suffix="ر.س" tone="amber" />
      </section>

      {remaining > 0 && collected === 0 && (
        <section className="rounded-lg bg-amber-50 ring-1 ring-inset ring-amber-200 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-amber-900">لا توجد دفعات محصلة بعد</div>
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

      <section>
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">إجراءات سريعة</div>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </section>
    </div>
  )
}

function Kpi({ label, value, suffix, tone }: { label: string; value: string; suffix?: string; tone?: 'emerald' | 'amber' }) {
  const toneCls =
    tone === 'emerald' ? 'text-emerald-700' :
    tone === 'amber'   ? 'text-amber-700'   : 'text-slate-900'
  return (
    <div className="rounded-lg bg-white border border-slate-200 px-4 py-3">
      <div className="text-[11px] text-slate-500 font-semibold">{label}</div>
      <div className={`mt-1 flex items-baseline gap-1 ${toneCls}`}>
        <span className="text-2xl font-bold font-mono">{value}</span>
        {suffix && <span className="text-[10px] text-slate-400 font-semibold">{suffix}</span>}
      </div>
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
