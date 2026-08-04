'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Play, Loader2, CheckCircle2, AlertCircle, RotateCw } from 'lucide-react'

type BatchDetail = {
  case_number: string
  linked: string[]
  error?: string
}

type BatchResult = {
  ok: true
  processed: number
  linked_unit: number
  linked_sale: number
  linked_contract: number
  failed: number
  remaining_unlinked: number
  details: BatchDetail[]
}

/**
 * Client runner for /api/dsb-relink-batch.
 *
 * State machine: idle → running → done (with result) → back to idle.
 * User can pick a batch size (default 10, cap 30) and optionally narrow
 * to one project. After a run completes, the "Process next batch" button
 * remains active so the operator can drain the queue with repeated clicks.
 */
export function RelinkRunner({
  initialUnlinked,
  projects,
}: {
  initialUnlinked: number
  projects: Array<{ id: string; label: string }>
}) {
  const router = useRouter()
  const [limit, setLimit] = useState(10)
  const [projectId, setProjectId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runsCompleted, setRunsCompleted] = useState(0)

  async function runBatch() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const resp = await fetch('/api/dsb-relink-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit,
          project_id: projectId || undefined,
        }),
      })
      const json = (await resp.json()) as BatchResult | { ok: false; error: string }
      if (!resp.ok || !('ok' in json) || !json.ok) {
        setError(('error' in json && json.error) || `HTTP ${resp.status}`)
        return
      }
      setResult(json)
      setRunsCompleted((n) => n + 1)
      // Refresh server-rendered scorecards so the page-level count updates.
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remaining = result?.remaining_unlinked ?? initialUnlinked
  const noWork = remaining === 0

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-4">
      <div>
        <h2 className="serif font-bold text-lg text-slate-900 mb-3">تشغيل دُفعة</h2>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[11px] font-semibold text-slate-500 mb-1 block">حجم الدُفعة</label>
            <input
              type="number"
              min={1}
              max={30}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(30, parseInt(e.target.value) || 1)))}
              disabled={busy}
              className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
              dir="ltr"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-[11px] font-semibold text-slate-500 mb-1 block">
              مشروع محدَّد (اختياري)
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="">— كل المشاريع —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={runBatch}
            disabled={busy || noWork}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-4 py-2 text-sm font-bold transition"
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                جارٍ التشغيل…
              </>
            ) : runsCompleted > 0 && !noWork ? (
              <>
                <RotateCw className="w-4 h-4" aria-hidden="true" />
                الدُفعة التالية
              </>
            ) : noWork ? (
              <>
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                لا توجد طلبات معلَّقة
              </>
            ) : (
              <>
                <Play className="w-4 h-4" aria-hidden="true" />
                تشغيل
              </>
            )}
          </button>
        </div>

        <div className="mt-2 text-xs text-slate-500">
          سيتم معالجة أول <span className="font-mono font-bold">{Math.min(limit, remaining)}</span> طلب من
          أصل <span className="font-mono font-bold">{remaining}</span> طلب معلَّق.
          {busy && ' قد يستغرق حتى ٥ دقائق — لا تُغلق الصفحة.'}
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <div className="text-sm font-bold text-emerald-900">
                اكتملت الدُفعة — عولج <span className="font-mono">{result.processed}</span> طلب.
              </div>
              <div className="text-xs text-emerald-800 mt-1">
                رُبِط بوحدة: <span className="font-mono font-bold">{result.linked_unit}</span>
                {' · '}
                بمشتري: <span className="font-mono font-bold">{result.linked_sale}</span>
                {' · '}
                بعقد PDF: <span className="font-mono font-bold">{result.linked_contract}</span>
                {result.failed > 0 && (
                  <>
                    {' · '}
                    <span className="text-red-700">فشل: <span className="font-mono font-bold">{result.failed}</span></span>
                  </>
                )}
              </div>
              <div className="text-xs text-emerald-700 mt-0.5">
                المتبقّي في الطابور: <span className="font-mono font-bold">{result.remaining_unlinked}</span>
              </div>
            </div>
          </div>

          {result.details.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer font-semibold text-emerald-800 hover:text-emerald-900">
                تفاصيل الدُفعة ({result.details.length})
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-slate-500 uppercase text-[10px]">
                    <tr className="text-right">
                      <th className="px-2 py-1">رقم الطلب</th>
                      <th className="px-2 py-1">النتيجة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-100">
                    {result.details.map((d, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1 font-mono">{d.case_number}</td>
                        <td className="px-2 py-1">
                          {d.error ? (
                            <span className="text-red-700">فشل: {d.error}</span>
                          ) : d.linked.length === 0 ? (
                            <span className="text-slate-500">لم يُطابَق شيء</span>
                          ) : (
                            <span className="text-emerald-700 font-semibold">
                              {d.linked.map((k) => translateLink(k)).join('، ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  )
}

function translateLink(k: string): string {
  switch (k) {
    case 'unit': return 'وحدة'
    case 'sale': return 'مشتري'
    case 'contract': return 'عقد PDF'
    default: return k
  }
}
