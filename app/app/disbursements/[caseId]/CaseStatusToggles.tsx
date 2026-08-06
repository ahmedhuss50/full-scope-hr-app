'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, AlertCircle, DollarSign, PackageCheck } from 'lucide-react'
import { updateCaseStatusFlags } from './actions'

/**
 * Manual paid + delivered flags for a case.
 *
 * The workflow-side status column tracks the review pipeline; these two
 * flags are the operational reality (money moved / documents handed off).
 * Historical imports and some workflow-completed cases may need these
 * flags flipped manually — this widget is the surface for that.
 *
 * Setting a date IS the flag. Unchecking clears the date. When a flag is
 * checked with no date value we default to today so the operator doesn't
 * have to fill it in for the common case.
 */
export function CaseStatusToggles({
  caseId,
  initialPaidAt,       // 'YYYY-MM-DD' or null
  initialDeliveredAt,  // ISO timestamp or null
  canEdit,
}: {
  caseId: string
  initialPaidAt: string | null
  initialDeliveredAt: string | null
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [paidAt, setPaidAt] = useState<string>(initialPaidAt ?? '')
  const [deliveredAtIso, setDeliveredAtIso] = useState<string | null>(initialDeliveredAt)
  // Local checkbox states — derived from the date values but held
  // separately so unchecking clears the date state.
  const [isPaid, setIsPaid] = useState<boolean>(!!initialPaidAt)
  const [isDelivered, setIsDelivered] = useState<boolean>(!!initialDeliveredAt)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const todayYmd = (): string => {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  function onTogglePaid(next: boolean) {
    setIsPaid(next)
    if (next) {
      if (!paidAt) setPaidAt(todayYmd())
    } else {
      setPaidAt('')
    }
  }

  function onToggleDelivered(next: boolean) {
    setIsDelivered(next)
    if (next) {
      if (!deliveredAtIso) setDeliveredAtIso(new Date().toISOString())
    } else {
      setDeliveredAtIso(null)
    }
  }

  // Convert the deliveredAtIso to the <input type="datetime-local"> format
  // (local time). Same helper the archive row uses.
  function toLocalDateTimeInput(iso: string | null): string {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    )
  }

  async function save() {
    setError(null)
    setSaving(true)
    // Convert deliveredAt local input value to ISO — the datetime-local
    // input gives us "YYYY-MM-DDTHH:mm" (browser-local).
    const deliveredIso =
      isDelivered && deliveredAtIso ? new Date(deliveredAtIso).toISOString() : null
    const paidYmd = isPaid && paidAt ? paidAt : null
    const res = await updateCaseStatusFlags({
      case_id: caseId,
      paid_at: paidYmd,
      delivered_at: deliveredIso,
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSavedAt(Date.now())
    startTransition(() => router.refresh())
  }

  const dirty =
    !!initialPaidAt !== isPaid ||
    (paidAt || '') !== (initialPaidAt || '') ||
    !!initialDeliveredAt !== isDelivered ||
    (deliveredAtIso || '') !== (initialDeliveredAt || '')

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="serif font-bold text-lg text-slate-900">حالة الدفع والتسليم</h2>
        {savedAt && !dirty && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            حُفظ
          </span>
        )}
      </div>

      {!canEdit ? (
        <div className="text-xs text-slate-500">
          هذا القسم للعرض فقط. صلاحية التعديل متاحة للموظفين والمدير.
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Paid */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 accent-emerald-600"
              checked={isPaid}
              onChange={(e) => onTogglePaid(e.target.checked)}
              disabled={!canEdit || saving}
            />
            <span className="text-sm font-bold text-slate-900 inline-flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              مدفوعة
            </span>
          </label>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 mb-1 block">
              تاريخ الدفع
            </label>
            <input
              type="date"
              value={paidAt}
              onChange={(e) => {
                setPaidAt(e.target.value)
                if (e.target.value) setIsPaid(true)
              }}
              disabled={!canEdit || !isPaid || saving}
              dir="ltr"
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
          </div>
        </div>

        {/* Delivered */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 accent-blue-600"
              checked={isDelivered}
              onChange={(e) => onToggleDelivered(e.target.checked)}
              disabled={!canEdit || saving}
            />
            <span className="text-sm font-bold text-slate-900 inline-flex items-center gap-1.5">
              <PackageCheck className="w-4 h-4 text-blue-600" aria-hidden="true" />
              مسلَّمة
            </span>
          </label>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 mb-1 block">
              وقت التسليم
            </label>
            <input
              type="datetime-local"
              value={toLocalDateTimeInput(deliveredAtIso)}
              onChange={(e) => {
                const v = e.target.value
                if (v) {
                  setDeliveredAtIso(new Date(v).toISOString())
                  setIsDelivered(true)
                } else {
                  setDeliveredAtIso(null)
                }
              }}
              disabled={!canEdit || !isDelivered || saving}
              dir="ltr"
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {canEdit && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-4 py-2 text-sm font-bold transition"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                جارٍ الحفظ…
              </>
            ) : (
              'حفظ'
            )}
          </button>
        </div>
      )}
    </section>
  )
}
