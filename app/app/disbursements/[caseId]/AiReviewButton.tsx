'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'

/**
 * One-click AI compliance review for a case.
 *
 * Calls POST /api/dsb-ai-review which:
 *   - Sends the PDF + the active checklist items to Claude
 *   - Writes one verdict per item (status + notes pre-filled with AI suggestion)
 *   - Refreshes the page so the checklist renders fully populated
 *
 * Cost is shown after success so the reviewer sees what each click costs
 * (typically ~$0.02 per case on Haiku).
 */
export function AiReviewButton({ caseId }: { caseId: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [running, setRunning] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [result, setResult] = useState<
    | { ok: true; verdicts: number; total_items: number; missed_codes: string[]; cost_usd: number; model: string }
    | { ok: false; error: string }
    | null
  >(null)

  async function run() {
    setRunning(true)
    setResult(null)
    try {
      const resp = await fetch('/api/dsb-ai-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: caseId }),
      })
      const json = (await resp.json().catch(() => null)) as
        | { ok: true; verdicts: number; total_items: number; missed_codes: string[]; cost_usd: number; model: string }
        | { ok: false; error: string }
        | null
      if (!json) {
        setResult({ ok: false, error: `HTTP ${resp.status}` })
        return
      }
      setResult(json)
      if (json.ok) {
        startTransition(() => router.refresh())
      }
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'فشل الاتصال' })
    } finally {
      setRunning(false)
      setConfirmOpen(false)
    }
  }

  // Idle state — small purple "magic" button next to the checklist header.
  if (!confirmOpen) {
    return (
      <div className="inline-flex flex-col items-stretch gap-1.5">
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={running}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold shadow-sm hover:bg-violet-700 transition disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          {running ? 'جارٍ المراجعة…' : 'مراجعة آلية بالذكاء الاصطناعي'}
        </button>
        {result?.ok && (
          <div className={`rounded-md border px-2 py-1 text-[11px] ${
            result.verdicts === result.total_items
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}>
            {result.verdicts === result.total_items
              ? `✓ تم تقييم ${result.verdicts} من ${result.total_items} بند — التكلفة $${result.cost_usd.toFixed(4)}`
              : `⚠ تم تقييم ${result.verdicts} من ${result.total_items} بند فقط (تخطّى ${result.missed_codes.length}) — التكلفة $${result.cost_usd.toFixed(4)}. شغّل المراجعة مرة أخرى لإكمالها.`}
          </div>
        )}
        {result && !result.ok && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
            {result.error}
          </div>
        )}
      </div>
    )
  }

  // Confirm state — explain that this will run AI on the PDF and may overwrite
  // any verdicts that already exist on the case.
  return (
    <div className="inline-flex flex-col items-stretch gap-1.5 max-w-sm">
      <div className="rounded-lg border border-violet-200 bg-violet-50 text-violet-900 px-3 py-2 text-xs leading-relaxed">
        سيقوم الذكاء الاصطناعي بمراجعة الوثيقة وتقييم بنود قائمة المراجعة تلقائيًا. ستُستبدل أي قيم سابقة في القائمة. هل تريد المتابعة؟
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 transition disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          {running ? 'جارٍ المراجعة…' : 'نعم، شغّل المراجعة'}
        </button>
        <button
          type="button"
          onClick={() => setConfirmOpen(false)}
          disabled={running}
          className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition disabled:opacity-50"
        >
          إلغاء
        </button>
      </div>
    </div>
  )
}
