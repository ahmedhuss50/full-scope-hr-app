/**
 * CreditTracker — buyer deposits as a project-level credit pool.
 *
 *   المستلم من المشترين  = sum of dsb_payments (buyer_collection) for this project
 *   المصروف لموردين     = sum of dsb_cases (status ∈ signed/delivered) for this project
 *   المتبقي              = in − out
 *
 * Renders as a compact 3-metric card + a usage bar. Server component — pulls
 * from the DB directly and hands finished numbers to the caller.
 */
import { createSupabaseService } from '@/lib/supabase/server'
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react'

function fmtSar(n: number): string {
  try {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency', currency: 'SAR', maximumFractionDigits: 0,
    }).format(n)
  } catch { return `${Math.round(n)} ر.س` }
}

// PostgREST caps at 1000 — chunk large sums.
async function sumPagedNumeric<T extends { amount_sar: number | null }>(
  build: (from: number, to: number) => Promise<{ data: T[] | null }>,
): Promise<number> {
  let total = 0
  const CHUNK = 1000
  for (let page = 0; page < 100; page++) {
    const { data } = await build(page * CHUNK, page * CHUNK + CHUNK - 1)
    const rows = (data ?? [])
    for (const r of rows) total += Number(r.amount_sar || 0)
    if (rows.length < CHUNK) break
  }
  return total
}

export async function CreditTracker({
  projectId,
  tenantId,
}: {
  projectId: string
  tenantId: string
}) {
  const svc = createSupabaseService()

  // Wrapped in try/catch — if a required column/table hasn't been migrated
  // yet on this env, we render a zeroed card instead of crashing the whole
  // page. Never let the tracker take the vendors page down.
  let receivedIn = 0
  let spentOut  = 0
  try {
    ;[receivedIn, spentOut] = await Promise.all([
      sumPagedNumeric(async (from, to) => {
        const res = await svc
          .from('dsb_payments')
          .select('amount_sar')
          .eq('tenant_id', tenantId)
          .eq('project_id', projectId)
          .eq('deposit_category', 'buyer_collection')
          .range(from, to)
        return { data: res.data as { amount_sar: number | null }[] | null }
      }),
      sumPagedNumeric(async (from, to) => {
        const res = await svc
          .from('dsb_cases')
          .select('amount_sar')
          .eq('tenant_id', tenantId)
          .eq('project_id', projectId)
          .in('status', ['signed', 'delivered'])
          .range(from, to)
        return { data: res.data as { amount_sar: number | null }[] | null }
      }),
    ])
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[CreditTracker] query failed — rendering zeros', err)
  }

  const remaining = receivedIn - spentOut
  const usagePct  = receivedIn > 0 ? Math.min(100, (spentOut / receivedIn) * 100) : 0
  const usageBad  = usagePct >= 100 || remaining < 0

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-3" dir="rtl">
      <div className="flex items-center justify-between">
        <h3 className="serif font-bold text-base text-slate-900 inline-flex items-center gap-2">
          <Wallet className="w-4 h-4 text-teal-700" aria-hidden="true" />
          رصيد المشروع (تحصيل المشترين)
        </h3>
        <span className={`text-[11px] font-bold font-mono ${usageBad ? 'text-red-700' : 'text-slate-500'}`}>
          استُخدم {usagePct.toFixed(1)}٪
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Metric
          icon={<TrendingUp className="w-3 h-3" aria-hidden="true" />}
          label="المستلم من المشترين"
          value={fmtSar(receivedIn)}
          tone="emerald"
        />
        <Metric
          icon={<TrendingDown className="w-3 h-3" aria-hidden="true" />}
          label="المصروف لموردين ومقاولين"
          value={fmtSar(spentOut)}
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
          className={`h-full ${usageBad ? 'bg-red-500' : 'bg-teal-600'}`}
          style={{ width: `${Math.min(100, usagePct)}%` }}
        />
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        الرصيد يُحسب من إيداعات «تحصيل المشتري» ناقصًا سندات الصرف المعتمدة (موقّعة أو مُسلَّمة).
      </p>
    </section>
  )
}

function Metric({
  icon, label, value, tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'emerald' | 'amber' | 'teal' | 'red'
}) {
  const toneCls =
    tone === 'emerald' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' :
    tone === 'amber'   ? 'bg-amber-50 text-amber-800 ring-amber-200'    :
    tone === 'red'     ? 'bg-red-50 text-red-800 ring-red-200'          :
                         'bg-teal-50 text-teal-800 ring-teal-200'
  return (
    <div className={`rounded-lg ring-1 ring-inset ${toneCls} px-3 py-2`}>
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-80 inline-flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-base font-black font-mono">{value}</div>
    </div>
  )
}
