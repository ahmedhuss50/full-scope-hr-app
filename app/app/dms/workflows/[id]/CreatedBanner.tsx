'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Check, Copy, X, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleContext'

/**
 * Shown at the top of /app/dms/workflows/[id] when ?created=1 is in the URL.
 * The dismiss button is a Link back to the same page without the query param —
 * keeps the component server-renderable-friendly (no router.replace needed).
 */
export function CreatedBanner({
  runId,
  uploadUrl,
  emailStatus,
}: {
  runId: string
  uploadUrl: string | null
  emailStatus?: 'sent' | 'failed' | 'unknown' | null
}) {
  const { t } = useLocale()
  const [hidden, setHidden] = useState(false)
  const [copied, setCopied] = useState(false)

  if (hidden) return null

  async function onCopy() {
    if (!uploadUrl) return
    try {
      await navigator.clipboard.writeText(uploadUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = uploadUrl
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setCopied(true)
        setTimeout(() => setCopied(false), 2200)
      } catch {
        // Give up silently
      }
    }
  }

  return (
    <div className="rounded-xl border border-green-200 bg-green-50 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-green-700 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-green-900">
            {t('workflows.created.banner_title')}
          </div>
          <div className="mt-0.5 text-sm text-green-900/90">
            {t('workflows.created.banner_body')}
          </div>

          {uploadUrl && (
            <div className="mt-3 flex items-stretch gap-2 flex-wrap">
              <code className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white border border-green-200 text-[12px] font-mono text-slate-800 break-all">
                {uploadUrl}
              </code>
              <button
                type="button"
                onClick={onCopy}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition shadow-sm border ${
                  copied
                    ? 'bg-white text-green-700 border-green-300'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copied
                  ? t('workflows.detail.copied')
                  : t('workflows.created.copy_link')}
              </button>
            </div>
          )}

          {emailStatus === 'sent' && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-green-800">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t('workflows.created.email_sent')}
            </div>
          )}
          {emailStatus === 'failed' && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5" />
              {t('workflows.created.email_failed')}
            </div>
          )}
        </div>

        {/* Dismiss — server-friendly: navigate to same page without ?created */}
        <Link
          href={`/app/dms/workflows/${runId}`}
          aria-label={t('workflows.created.dismiss')}
          onClick={() => setHidden(true)}
          className="text-green-700/70 hover:text-green-900 p-1 rounded-md hover:bg-green-100 transition shrink-0"
        >
          <X className="w-4 h-4" />
        </Link>
      </div>
    </div>
  )
}
