'use client'

/**
 * BulkDeleteBar — a top-of-list action bar that deletes every row currently
 * visible on the page (respecting the user's filters). The server page passes
 * the full list of ids the current query returned, and this component wraps
 * them in a 2-step confirm → delete flow.
 *
 * Usage (server component):
 *   <BulkDeleteBar
 *     count={rows.length}
 *     entity="payments"
 *     ids={rows.map((r) => r.id)}
 *   />
 *
 * The entity string picks the right server action internally. Keeping the
 * action list in one place lets us expand (sales, units, cases…) without
 * changing every caller.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, AlertTriangle } from 'lucide-react'
import { bulkDeletePayments } from '../lists/payments/actions'
import { bulkDeleteSales, bulkDeleteUnits } from '../units/actions'

export type BulkDeleteEntity = 'payments' | 'sales' | 'units'

const ENTITY_LABELS: Record<BulkDeleteEntity, { noun: string; many: string }> = {
  payments: { noun: 'دفعة',  many: 'دفعات' },
  sales:    { noun: 'عقد',   many: 'عقود'   },
  units:    { noun: 'وحدة',  many: 'وحدات' },
}

async function runDelete(
  entity: BulkDeleteEntity,
  ids: string[],
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  switch (entity) {
    case 'payments': return bulkDeletePayments({ payment_ids: ids })
    case 'sales':    return bulkDeleteSales({ ids })
    case 'units':    return bulkDeleteUnits({ ids })
  }
}

export function BulkDeleteBar({
  entity,
  ids,
  count,
}: {
  entity: BulkDeleteEntity
  ids: string[]
  count: number
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const labels = ENTITY_LABELS[entity]

  async function onBulkDelete() {
    if (count === 0) return
    setErr(null); setDone(null)
    const typed = window.prompt(
      `سيتم حذف ${count} ${count === 1 ? labels.noun : labels.many} الظاهرة الآن.\n` +
      `هذا يحترم الفلاتر الحالية — السجلات المخفية لن تُمَس.\n\n` +
      `اكتب DELETE للتأكيد:`,
    )
    if (typed !== 'DELETE') return
    setBusy(true)
    const res = await runDelete(entity, ids)
    setBusy(false)
    if (!res.ok) { setErr(res.error); return }
    setDone(`تم حذف ${res.deleted} ${res.deleted === 1 ? labels.noun : labels.many}.`)
    startTransition(() => router.refresh())
  }

  if (count === 0) return null

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50">
      <div className="flex items-center gap-2 text-xs text-amber-900">
        <AlertTriangle className="w-4 h-4" aria-hidden="true" />
        <span className="font-semibold">
          {count} {count === 1 ? labels.noun : labels.many} ظاهرة حسب الفلاتر الحالية
        </span>
      </div>
      <div className="flex items-center gap-2">
        {done && (
          <span className="text-xs font-semibold text-emerald-700">{done}</span>
        )}
        {err && (
          <span className="text-xs font-semibold text-red-700">{err}</span>
        )}
        <button
          type="button"
          onClick={onBulkDelete}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 bg-white text-red-700 text-xs font-semibold shadow-sm hover:bg-red-50 transition disabled:opacity-50"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          {busy ? 'جارٍ الحذف…' : `حذف الكل (${count})`}
        </button>
      </div>
    </div>
  )
}
