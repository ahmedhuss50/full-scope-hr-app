'use client'

/**
 * CompletionPctEditor — inline نسبة الإنجاز editor for a unit row.
 *
 * Save on blur or Enter. Reaching 100 auto-flips completion_status to
 * منجزة (server-side), so the parent should refresh to pick up the change.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check } from 'lucide-react'
import { updateUnitCompletionPct } from '../../../units/actions'

export function CompletionPctEditor({
  unitId,
  initialPct,
  canEdit,
}: {
  unitId: string
  initialPct: number
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [value, setValue] = useState<string>(String(initialPct ?? 0))
  const [busy, setBusy] = useState(false)
  const [savedTick, setSavedTick] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  async function commit() {
    if (!canEdit) return
    const next = Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
    if (next === Number(initialPct ?? 0) && !err) return
    setErr(null); setBusy(true)
    const res = await updateUnitCompletionPct({ unit_id: unitId, completion_pct: next })
    setBusy(false)
    if (!res.ok) {
      setErr(res.error)
      setValue(String(initialPct ?? 0))
      return
    }
    setValue(String(next))
    setSavedTick((n) => n + 1)
    startTransition(() => router.refresh())
  }

  const pctNum = Math.max(0, Math.min(100, Number(value) || 0))

  return (
    <div className="flex flex-col gap-1 min-w-[6rem]">
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void commit() }
          }}
          disabled={!canEdit || busy}
          className="w-14 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-mono text-slate-800 text-center focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50"
          aria-label="نسبة الإنجاز"
        />
        <span className="text-[10px] text-slate-500">٪</span>
        {busy && <Loader2 className="w-3 h-3 animate-spin text-teal-600" aria-hidden="true" />}
        {!busy && savedTick > 0 && <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />}
      </div>
      <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full ${pctNum === 100 ? 'bg-emerald-500' : pctNum >= 50 ? 'bg-teal-500' : 'bg-amber-400'}`}
          style={{ width: `${pctNum}%` }}
        />
      </div>
      {err && <div className="text-[10px] text-red-700">{err}</div>}
    </div>
  )
}
