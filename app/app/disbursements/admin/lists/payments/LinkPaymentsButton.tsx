'use client'

/**
 * LinkPaymentsButton — triggers /api/dsb-link-payments-to-sales to retry
 * matching every unlinked payment (sale_id IS NULL, contract_number_raw
 * populated) against the current sales table. Owner-only.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Link2 } from 'lucide-react'

export function LinkPaymentsButton() {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function run() {
    setErr(null); setResult(null); setBusy(true)
    try {
      const resp = await fetch('/api/dsb-link-payments-to-sales', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const j = await resp.json().catch(() => ({ ok: false, error: 'استجابة غير صالحة' }))
      if (!resp.ok || !j.ok) {
        setErr(j.error ?? `خطأ ${resp.status}`)
      } else {
        setResult(`فحصت ${j.scanned} • ربطت ${j.linked} • بقي ${j.unmatched}`)
        startTransition(() => router.refresh())
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title="يحاول ربط كل الدفعات التي ليس لها عقد بناءً على رقم العقد المحفوظ"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal-300 bg-white text-teal-700 text-xs font-semibold shadow-sm hover:bg-teal-50 transition disabled:opacity-50"
      >
        <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
        {busy ? 'جارٍ الربط…' : 'ربط الدفعات بالعقود'}
      </button>
      {result && <span className="text-xs font-semibold text-emerald-700">{result}</span>}
      {err && <span className="text-xs font-semibold text-red-700">{err}</span>}
    </div>
  )
}
