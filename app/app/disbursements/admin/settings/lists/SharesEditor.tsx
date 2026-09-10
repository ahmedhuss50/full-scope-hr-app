'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Save } from 'lucide-react'
import { updateDistributionShares, type DistributionShares } from './actions'

export function SharesEditor({ initial }: { initial: DistributionShares }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [construction, setConstruction] = useState<string>(String(Math.round(initial.construction    * 100)))
  const [admin,        setAdmin]        = useState<string>(String(Math.round(initial.admin_marketing * 100)))
  const [escrow,       setEscrow]       = useState<string>(String(Math.round(initial.escrow          * 100)))
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)
  const [ok,     setOk]     = useState(false)

  const c = Number(construction) || 0
  const a = Number(admin)        || 0
  const e = Number(escrow)       || 0
  const sum = c + a + e
  const sumBad = Math.abs(sum - 100) > 0.5

  async function onSave() {
    setError(null); setOk(false)
    setSaving(true)
    const res = await updateDistributionShares({
      construction:    c / 100,
      admin_marketing: a / 100,
      escrow:          e / 100,
    })
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setOk(true)
    startTransition(() => router.refresh())
    setTimeout(() => setOk(false), 2500)
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 text-center ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50'

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <ShareInput label="حساب الانشاءات" value={construction} setValue={setConstruction} tone="indigo" disabled={saving} />
        <ShareInput label="الاداري والتسويقي" value={admin} setValue={setAdmin} tone="amber" disabled={saving} />
        <ShareInput label="حساب الحفظ" value={escrow} setValue={setEscrow} tone="emerald" disabled={saving} />
      </div>
      <div className={`text-xs font-mono ${sumBad ? 'text-red-700' : 'text-slate-500'}`}>
        المجموع: {sum.toFixed(1)}٪ {sumBad ? '— يجب أن يكون 100٪ بالضبط' : ' ✓'}
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {ok && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          تم الحفظ. ستنعكس النسب الجديدة على كل الشاشات فور إعادة تحميلها.
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || sumBad}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" aria-hidden="true" />
          {saving ? 'جارٍ الحفظ…' : 'حفظ النسب'}
        </button>
      </div>
    </div>
  )
}

function ShareInput({
  label,
  value,
  setValue,
  tone,
  disabled,
}: {
  label: string
  value: string
  setValue: (v: string) => void
  tone: 'indigo' | 'amber' | 'emerald'
  disabled: boolean
}) {
  const cls =
    tone === 'indigo'  ? 'border-t-4 border-t-indigo-500'  :
    tone === 'amber'   ? 'border-t-4 border-t-amber-500'   :
    'border-t-4 border-t-emerald-500'
  return (
    <div className={`rounded-lg bg-white border border-slate-200 ${cls} p-3 space-y-2`}>
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-lg font-mono font-bold text-slate-900 text-center focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50"
          dir="ltr"
        />
        <span className="text-lg font-bold text-slate-500">٪</span>
      </div>
    </div>
  )
}
