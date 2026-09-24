'use client'

/**
 * DashboardDateRange
 * ---------------------------------------------------------------------------
 * Pill-style date-range selector for the owner dashboard.
 *
 * Writes to URL search params (?range=quarter|month|year|custom&from=…&to=…)
 * so the server component can read them and scope its queries. Client-side
 * only for the toggling / date-picker interaction.
 */
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useState, useTransition } from 'react'

type RangeKey = 'month' | 'quarter' | 'year' | 'custom'

const OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'month',   label: 'هذا الشهر' },
  { key: 'quarter', label: 'هذا الربع' },
  { key: 'year',    label: 'السنة' },
  { key: 'custom',  label: 'مخصّص' },
]

export function DashboardDateRange({
  active,
  from,
  to,
}: {
  active: RangeKey
  from: string | null
  to: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [pending, start] = useTransition()
  const [showCustom, setShowCustom] = useState(active === 'custom')
  const [fromLocal, setFromLocal] = useState(from ?? '')
  const [toLocal, setToLocal] = useState(to ?? '')

  function push(next: URLSearchParams) {
    start(() => router.push(`${pathname}?${next.toString()}`))
  }

  function pick(k: RangeKey) {
    const next = new URLSearchParams(sp?.toString() ?? '')
    next.set('range', k)
    if (k !== 'custom') {
      next.delete('from')
      next.delete('to')
      setShowCustom(false)
      push(next)
    } else {
      setShowCustom(true)
    }
  }

  function applyCustom() {
    const next = new URLSearchParams(sp?.toString() ?? '')
    next.set('range', 'custom')
    if (fromLocal) next.set('from', fromLocal); else next.delete('from')
    if (toLocal)   next.set('to',   toLocal);   else next.delete('to')
    push(next)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap justify-end" dir="rtl">
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
        {OPTIONS.map((o) => {
          const on = active === o.key
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => pick(o.key)}
              disabled={pending}
              className={
                'px-3 py-1.5 text-xs font-semibold rounded-md transition ' +
                (on
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50')
              }
            >
              {o.label}
            </button>
          )
        })}
      </div>

      {showCustom && (
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 shadow-sm">
          <input
            type="date"
            value={fromLocal}
            onChange={(e) => setFromLocal(e.target.value)}
            className="text-xs border-0 focus:ring-0 p-0.5"
          />
          <span className="text-slate-400 text-xs">→</span>
          <input
            type="date"
            value={toLocal}
            onChange={(e) => setToLocal(e.target.value)}
            className="text-xs border-0 focus:ring-0 p-0.5"
          />
          <button
            type="button"
            onClick={applyCustom}
            disabled={pending}
            className="text-xs font-semibold text-teal-700 hover:text-teal-900 px-1.5"
          >
            تطبيق
          </button>
        </div>
      )}
    </div>
  )
}
