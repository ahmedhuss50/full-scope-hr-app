'use client'

import { useState } from 'react'
import { FileCheck2, Download } from 'lucide-react'
import { getSignedDocumentUrl } from './actions'

/**
 * Renders a card showing the owner-uploaded signed PDF for a case.
 * The Storage path is private — we ask the server for a short-lived
 * signed URL on click, then open it in a new tab.
 */
export function SignedDocumentCard({
  caseId,
  filename,
}: {
  caseId: string
  filename: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onDownload() {
    setError(null)
    setBusy(true)
    const res = await getSignedDocumentUrl({ case_id: caseId })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    // Open in new tab so the owner doesn't lose the case page they're on.
    window.open(res.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <section className="bg-white border border-emerald-200 rounded-xl p-6 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-50 shrink-0">
            <FileCheck2 className="w-5 h-5 text-emerald-600" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="serif font-bold text-base text-slate-900">المستند الموقّع</h2>
            <div className="text-xs text-slate-500 mt-0.5 truncate" title={filename}>
              {filename}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onDownload}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold shadow-sm hover:bg-emerald-700 transition disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          {busy ? 'جاري الفتح…' : 'تنزيل / فتح'}
        </button>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
    </section>
  )
}
