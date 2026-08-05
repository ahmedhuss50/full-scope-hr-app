'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Link2, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

/**
 * Owner-only trigger for /api/dsb-link-sales-to-units. Shows a running
 * summary of the last attempt so the operator can see what happened
 * without opening dev tools. Refreshes the page on success so the tabs +
 * scorecards reflect the new linked / unlinked counts.
 */
export function AutoLinkButton({
  projectId,
  unlinkedCount,
}: {
  projectId: string
  unlinkedCount: number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    linked_count: number
    remaining: number
    ai_used: boolean
  } | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const resp = await fetch('/api/dsb-link-sales-to-units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, use_ai: true }),
      })
      const json = (await resp.json()) as
        | { ok: true; linked_count: number; remaining: number; ai_used: boolean }
        | { ok: false; error: string }
      if (!resp.ok || !('ok' in json) || !json.ok) {
        setError(('error' in json && json.error) || `HTTP ${resp.status}`)
        return
      }
      setResult({
        linked_count: json.linked_count,
        remaining: json.remaining,
        ai_used: json.ai_used,
      })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-teal-200 bg-teal-50/40 p-4 space-y-3">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-sm font-bold text-teal-900 inline-flex items-center gap-1.5">
            <Link2 className="w-4 h-4" aria-hidden="true" />
            ربط تلقائي بالوحدات
          </div>
          <div className="text-xs text-teal-800 mt-0.5">
            يحاول النظام مطابقة العقود غير المربوطة (<span className="font-mono font-bold">{unlinkedCount}</span>) بالوحدات
            الموجودة في المشروع بمطابقة نصية، ثم بالذكاء الاصطناعي للحالات الغامضة.
          </div>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy || unlinkedCount === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-4 py-2 text-sm font-bold transition"
        >
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              جارٍ الربط…
            </>
          ) : (
            <>
              <Link2 className="w-4 h-4" aria-hidden="true" />
              تشغيل الربط
            </>
          )}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-800 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
          <div>
            رُبِط <span className="font-mono font-bold">{result.linked_count}</span> عقد بالوحدات.
            المتبقّي: <span className="font-mono font-bold">{result.remaining}</span>.
            {result.ai_used && <span className="text-emerald-700"> (استُخدم الذكاء الاصطناعي للحالات الغامضة)</span>}
          </div>
        </div>
      )}
    </section>
  )
}
