/**
 * DownpaymentPlanSection — vendors-page section for the developer's
 * downpayment: total, milestone-based spending plan, and progress.
 *
 * Server-side: pulls the project (downpayment + plan) and totals
 * spent-so-far from signed/delivered vendor cases. Hands data to the
 * client editor.
 */
import { createSupabaseService } from '@/lib/supabase/server'
import { Wallet } from 'lucide-react'
import { DownpaymentPlanEditor } from './DownpaymentPlanEditor'
import type { DownpaymentMilestone } from './actions-downpayment'

function fmtSar(n: number): string {
  try {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency', currency: 'SAR', maximumFractionDigits: 0,
    }).format(n)
  } catch { return `${Math.round(n)} ر.س` }
}

async function sumSignedVendorSpend(
  svc: ReturnType<typeof createSupabaseService>,
  tenantId: string,
  projectId: string,
): Promise<number> {
  let total = 0
  const CHUNK = 1000
  for (let page = 0; page < 100; page++) {
    const { data } = await svc
      .from('dsb_cases')
      .select('amount_sar')
      .eq('tenant_id', tenantId)
      .eq('project_id', projectId)
      .in('status', ['signed', 'delivered'])
      .range(page * CHUNK, page * CHUNK + CHUNK - 1)
    const rows = (data ?? []) as { amount_sar: number | null }[]
    for (const r of rows) total += Number(r.amount_sar || 0)
    if (rows.length < CHUNK) break
  }
  return total
}

export async function DownpaymentPlanSection({
  projectId,
  tenantId,
  canEdit,
}: {
  projectId: string
  tenantId: string
  canEdit: boolean
}) {
  const svc = createSupabaseService()

  let downpayment = 0
  let plan: DownpaymentMilestone[] = []
  let spent = 0
  try {
    const [projRes, spentSum] = await Promise.all([
      svc
        .from('dsb_projects')
        .select('developer_downpayment_sar, developer_downpayment_plan')
        .eq('id', projectId)
        .maybeSingle(),
      sumSignedVendorSpend(svc, tenantId, projectId),
    ])
    if (!projRes.error && projRes.data) {
      const p = projRes.data as {
        developer_downpayment_sar: number | null
        developer_downpayment_plan: DownpaymentMilestone[] | null
      }
      downpayment = Number(p.developer_downpayment_sar ?? 0)
      plan = Array.isArray(p.developer_downpayment_plan) ? p.developer_downpayment_plan : []
    }
    spent = spentSum
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[DownpaymentPlanSection] query failed', err)
  }

  const released = plan
    .filter((m) => m.released_at)
    .reduce((n, m) => n + Number(m.amount_sar || 0), 0)
  const planTotal = plan.reduce((n, m) => n + Number(m.amount_sar || 0), 0)

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-4" dir="rtl">
      <div className="flex items-center gap-2">
        <Wallet className="w-4 h-4 text-indigo-700" aria-hidden="true" />
        <h3 className="serif font-bold text-base text-slate-900">
          دفعة المطوّر المقدّمة وخطة استخدامها
        </h3>
      </div>

      {/* Rollup */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-right">
        <RollupCell label="إجمالي الدفعة المقدّمة" value={fmtSar(downpayment)} tone="indigo" />
        <RollupCell label="مجموع الخطة" value={fmtSar(planTotal)} tone={planTotal === downpayment ? 'slate' : 'amber'} />
        <RollupCell label="المفرج عنه" value={fmtSar(released)} tone="emerald" />
        <RollupCell label="المصروف فعليًا" value={fmtSar(spent)} tone={spent > released ? 'red' : 'teal'} />
      </div>

      {planTotal !== downpayment && downpayment > 0 && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          مجموع مبالغ الخطة {fmtSar(planTotal)} لا يساوي إجمالي الدفعة {fmtSar(downpayment)} — راجع الجدول.
        </p>
      )}

      <DownpaymentPlanEditor
        projectId={projectId}
        initialDownpayment={downpayment}
        initialPlan={plan}
        canEdit={canEdit}
      />

      <p className="text-[11px] text-slate-500 leading-relaxed">
        الخطة عبارة عن دفعات مربوطة بنسبة إنجاز المشروع. اضغط على «مفرج عنه»
        لتحديث الحالة عند بلوغ الميلستون. المصروف الفعلي = مجموع سندات الصرف
        الموقّعة أو المسلّمة للمشروع.
      </p>
    </section>
  )
}

function RollupCell({
  label, value, tone,
}: {
  label: string
  value: string
  tone: 'indigo' | 'emerald' | 'teal' | 'amber' | 'red' | 'slate'
}) {
  const toneCls =
    tone === 'indigo'  ? 'bg-indigo-50 text-indigo-800 ring-indigo-200' :
    tone === 'emerald' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' :
    tone === 'amber'   ? 'bg-amber-50 text-amber-800 ring-amber-200' :
    tone === 'red'     ? 'bg-red-50 text-red-800 ring-red-200' :
    tone === 'slate'   ? 'bg-slate-50 text-slate-800 ring-slate-200' :
                         'bg-teal-50 text-teal-800 ring-teal-200'
  return (
    <div className={`rounded-lg ring-1 ring-inset ${toneCls} px-3 py-2`}>
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">
        {label}
      </div>
      <div className="mt-1 text-base font-black font-mono">{value}</div>
    </div>
  )
}
