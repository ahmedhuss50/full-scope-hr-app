'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { upsertBreakdownItem, deleteBreakdownItem } from './actions'

export type BreakdownItem = {
  id: string
  kind: string
  page_from: number | null
  page_to: number | null
  summary_ar: string | null
  order_index: number
}

const KIND_LABELS: Record<string, string> = {
  voucher:                'سند صرف',
  invoice:                'فاتورة',
  proof_of_payment:       'إثبات دفع',
  completion_certificate: 'شهادة إنجاز',
  contract:               'عقد',
  receipt:                'إيصال',
  other:                  'أخرى',
}
const KINDS = Object.keys(KIND_LABELS)

type DraftRow = {
  id: string | null
  kind: string
  page_from: string
  page_to: string
  summary_ar: string
  dirty: boolean
  saving: boolean
}

function rowFromItem(it: BreakdownItem): DraftRow {
  return {
    id: it.id,
    kind: it.kind,
    page_from: it.page_from?.toString() ?? '',
    page_to: it.page_to?.toString() ?? '',
    summary_ar: it.summary_ar ?? '',
    dirty: false,
    saving: false,
  }
}

export function BreakdownEditor({
  caseId,
  items,
  readOnly,
}: {
  caseId: string
  items: BreakdownItem[]
  readOnly: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [rows, setRows] = useState<DraftRow[]>(() => items.map(rowFromItem))
  const [error, setError] = useState<string | null>(null)

  function update(idx: number, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch, dirty: true } : r)))
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { id: null, kind: 'invoice', page_from: '', page_to: '', summary_ar: '', dirty: true, saving: false },
    ])
  }

  async function saveRow(idx: number) {
    const r = rows[idx]
    if (!r) return
    setError(null)
    setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, saving: true } : x)))
    const res = await upsertBreakdownItem({
      case_id: caseId,
      id: r.id,
      kind: r.kind,
      page_from: r.page_from ? Number(r.page_from) : null,
      page_to: r.page_to ? Number(r.page_to) : null,
      summary_ar: r.summary_ar.trim() || null,
      order_index: idx,
    })
    if (!res.ok) {
      setError(res.error)
      setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, saving: false } : x)))
      return
    }
    setRows((prev) =>
      prev.map((x, i) =>
        i === idx ? { ...x, id: res.id, dirty: false, saving: false } : x,
      ),
    )
    startTransition(() => router.refresh())
  }

  async function removeRow(idx: number) {
    const r = rows[idx]
    if (!r) return
    if (!r.id) {
      // Unsaved — just drop it.
      setRows((prev) => prev.filter((_, i) => i !== idx))
      return
    }
    setError(null)
    const res = await deleteBreakdownItem({ case_id: caseId, id: r.id })
    if (!res.ok) {
      setError(res.error)
      return
    }
    setRows((prev) => prev.filter((_, i) => i !== idx))
    startTransition(() => router.refresh())
  }

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500'

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-sm text-slate-500">لا توجد بنود تصنيف بعد.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-slate-500 border-b border-slate-200">
                <th className="text-start py-2 px-2 w-40">النوع</th>
                <th className="text-start py-2 px-2 w-32">الصفحات</th>
                <th className="text-start py-2 px-2">الملخّص</th>
                <th className="text-start py-2 px-2 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.id ?? `new-${idx}`} className="border-b border-slate-100 align-top">
                  <td className="py-2 px-2">
                    <select
                      disabled={readOnly}
                      className={inputCls}
                      value={r.kind}
                      onChange={(e) => update(idx, { kind: e.target.value })}
                    >
                      {KINDS.map((k) => (
                        <option key={k} value={k}>{KIND_LABELS[k]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        disabled={readOnly}
                        className={inputCls}
                        placeholder="من"
                        value={r.page_from}
                        onChange={(e) => update(idx, { page_from: e.target.value })}
                      />
                      <span className="text-slate-400">—</span>
                      <input
                        type="number"
                        min={1}
                        disabled={readOnly}
                        className={inputCls}
                        placeholder="إلى"
                        value={r.page_to}
                        onChange={(e) => update(idx, { page_to: e.target.value })}
                      />
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    <input
                      disabled={readOnly}
                      className={inputCls}
                      placeholder="وصف قصير"
                      value={r.summary_ar}
                      onChange={(e) => update(idx, { summary_ar: e.target.value })}
                    />
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1">
                      {!readOnly && (
                        <button
                          type="button"
                          disabled={r.saving || (!r.dirty && !!r.id)}
                          onClick={() => saveRow(idx)}
                          className="inline-flex items-center px-2 py-1 rounded-md bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition disabled:opacity-40"
                        >
                          {r.saving ? '...' : 'حفظ'}
                        </button>
                      )}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                          aria-label="حذف"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!readOnly && (
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-dashed border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          إضافة بند
        </button>
      )}
    </div>
  )
}
