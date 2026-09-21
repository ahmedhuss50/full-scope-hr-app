/**
 * ValidationCard — pre-generation checklist for the CPA quarterly report.
 * Server component; runs the same checks the accountant will notice in the
 * generated file, and surfaces them before the download so nothing empty
 * slips through.
 */
import Link from 'next/link'
import { CheckCircle2, AlertCircle, XCircle, ChevronLeft } from 'lucide-react'

export type ValidationItem = {
  ok: boolean
  severity: 'error' | 'warning'
  label: string
  hint?: string
  fixHref?: string
}

export function ValidationCard({ items }: { items: ValidationItem[] }) {
  const errors    = items.filter((i) => !i.ok && i.severity === 'error')
  const warnings  = items.filter((i) => !i.ok && i.severity === 'warning')
  const passing   = items.filter((i) => i.ok)

  const status: 'clean' | 'warn' | 'block' =
    errors.length > 0 ? 'block' :
    warnings.length > 0 ? 'warn' :
    'clean'

  const headerCls =
    status === 'block' ? 'bg-red-50 border-red-200 text-red-900' :
    status === 'warn'  ? 'bg-amber-50 border-amber-200 text-amber-900' :
                         'bg-emerald-50 border-emerald-200 text-emerald-900'

  const headerLabel =
    status === 'block' ? `${errors.length} عنصر مطلوب لإكمال التقرير` :
    status === 'warn'  ? `${warnings.length} تنبيه — التقرير قابل للتوليد، لكن قد يكون ناقصًا` :
                         'كل العناصر جاهزة — يمكنك التوليد الآن'

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className={`px-4 py-3 border-b ${headerCls}`}>
        <div className="text-sm font-bold inline-flex items-center gap-2">
          {status === 'block' ? <XCircle className="w-4 h-4" /> :
           status === 'warn'  ? <AlertCircle className="w-4 h-4" /> :
                                <CheckCircle2 className="w-4 h-4" />}
          فحص التقرير قبل التوليد
        </div>
        <div className="text-xs mt-0.5">{headerLabel}</div>
      </div>
      <div className="divide-y divide-slate-100">
        {[...errors, ...warnings, ...passing].map((it, i) => (
          <Row key={i} item={it} />
        ))}
      </div>
    </section>
  )
}

function Row({ item }: { item: ValidationItem }) {
  const icon = item.ok
    ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
    : item.severity === 'error'
      ? <XCircle className="w-4 h-4 text-red-600 shrink-0" />
      : <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
  return (
    <div className="flex items-start gap-2 px-4 py-2 text-sm">
      {icon}
      <div className="flex-1 min-w-0">
        <div className={item.ok ? 'text-slate-500' : 'text-slate-800 font-semibold'}>
          {item.label}
        </div>
        {!item.ok && item.hint && (
          <div className="text-[11px] text-slate-500 mt-0.5">{item.hint}</div>
        )}
      </div>
      {!item.ok && item.fixHref && (
        <Link href={item.fixHref} className="text-[11px] font-semibold text-teal-700 hover:underline inline-flex items-center gap-0.5 shrink-0">
          إصلاح <ChevronLeft className="w-3 h-3" />
        </Link>
      )}
    </div>
  )
}
