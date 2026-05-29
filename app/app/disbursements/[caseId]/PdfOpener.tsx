'use client'

import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { getSignedPdfUrl } from './actions'

/**
 * Tiny client button that calls the server action to mint a short-lived signed
 * URL for the uploaded PDF, then opens it in a new tab.
 */
export function PdfOpener({ caseId, uploadId }: { caseId: string; uploadId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    setError(null)
    setBusy(true)
    const res = await getSignedPdfUrl({ case_id: caseId, upload_id: uploadId })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    window.open(res.url, '_blank', 'noopener')
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition disabled:opacity-50"
      >
        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        {busy ? 'جاري الفتح…' : 'فتح الملف'}
      </button>
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  )
}
