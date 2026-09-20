/**
 * DeveloperDownpaymentTracker — per-project pool of money the developer
 * has deposited to pay vendors / contractors. Distinct from buyer
 * collections (see CreditTracker).
 *
 *   المُودَع من المطوّر  = dsb_projects.developer_downpayment_sar
 *   المصروف لموردين     = sum of dsb_cases (status ∈ signed/delivered) for project
 *   المتبقي              = deposited − spent
 *
 * Owner can edit the deposited amount inline (button opens client editor).
 * Server component — wraps its queries in try/catch so a schema mismatch
 * never takes the vendors page down.
 */
import { createSupabaseService } from '@/lib/supabase/server'
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react'
import { DeveloperDownpaymentEditor } from './DeveloperDownpaymentEditor'

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

export async function DeveloperDownpaymentTracker({
  projectId,
  tenantId,
  canEdit,
}: {
  projectId: string
  tenantId: string
  canEdit: boolean
}) {
  const svc = createSupabaseService()

  let deposited = 0
  let spent     = 0
  try {
    const [projRes, spentSum] = await Promise.all([
      svc
        .from('dsb_projects')
        .select('developer_downpayment_sar')
        .eq('id', projectId)
        .maybeSingle(),
      sumSignedVendorSpend(svc, tenantId, projectId),
    ])
    if (!projRes.error) {
      deposited = Number(
        (projRes.data as { developer_downpayment_sar: number | null } | null)
          ?.developer_downpayment_sar ?? 0,
      )
    }
    spent = spentSum
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[DeveloperDownpaymentTracker] query failed', err)
  }

  const remaining = deposited - spent
  const usagePct  = deposited > 0 ? Math.min(100, (spent / deposited) * 100) : 0
  const usageBad  = usagePct >= 100 || remaining < 0

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-3" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <h3 className="serif font-bold text-base text-slate-900 inline-flex items-center gap-2">
          <Wallet className="w-4 h-4 text-indigo-700" aria-hidden="true" />
          دفعة المطوّر المقدّمة (لتمويل الموردين والمقاولين)
        </h3>
        <span className={`text-[11px] font-bold font-mono ${usageBad ? 'text-red-700' : 'text-slate-500'}`}>
          استُخدم {usagePct.toFixed(1)}٪
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Metric
          icon={<TrendingUp className="w-3 h-3" aria-hidden="true" />}
          label="المُودَع من المطوّر"
          value={fmtSar(deposited)}
          tone="emerald"
          editor={canEdit ? <DeveloperDownpaymentEditor projectId={projectId} initialValue={deposited} /> : null}
        />
        <Metric
          icon={<TrendingDown className="w-3 h-3" aria-hidden="true" />}
          label="المصروف لموردين ومقاولين"
          value={fmtSar(spent)}
          tone="amber"
        />
        <Metric
          icon={<Wallet className="w-3 h-3" aria-hidden="true" />}
          label="الرصيد المتبقي"
          value={fmtSar(remaining)}
          tone={remaining < 0 ? 'red' : 'teal'}
        />
      </div>

      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full ${usageBad ? 'bg-red-500' : 'bg-indigo-600'}`}
          style={{ width: `${Math.min(100, usagePct)}%` }}
        />
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        هذه دفعة المطوّر المخصصة لسداد الموردين والمقاولين — منفصلة تمامًا عن
        تحصيل المشترين. الرصيد يُحسب من المبلغ المُودَع ناقصًا سندات الصرف
        المعتمدة (موقّعة أو مُسلَّمة).
      </p>
    </section>
  )
}

function Metric({
  icon, label, value, tone, editor,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'emerald' | 'amber' | 'teal' | 'red'
  editor?: React.ReactNode
}) {
  const toneCls =
    tone === 'emerald' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' :
    tone === 'amber'   ? 'bg-amber-50 text-amber-800 ring-amber-200'    :
    tone === 'red'     ? 'bg-red-50 text-red-800 ring-red-200'          :
                         'bg-teal-50 text-teal-800 ring-teal-200'
  return (
    <div className={`rounded-lg ring-1 ring-inset ${toneCls} px-3 py-2`}>
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-80 inline-flex items-center gap-1 justify-between">
        <span className="inline-flex items-center gap-1">
          {icon}
          {label}
        </span>
        {editor}
      </div>
      <div className="mt-1 text-base font-black font-mono">{value}</div>
    </div>
  )
}
