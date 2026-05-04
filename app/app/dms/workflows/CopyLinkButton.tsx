'use client'
import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleContext'

export function CopyLinkButton({ url }: { url: string }) {
  const { t } = useLocale()
  const [copied, setCopied] = useState(false)

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      // Fallback: select-and-copy via execCommand on legacy browsers
      try {
        const ta = document.createElement('textarea')
        ta.value = url
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
    <button
      type="button"
      onClick={onCopy}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm border ${
        copied
          ? 'bg-green-50 text-green-700 border-green-200'
          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
      }`}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? t('workflows.detail.copied') : t('workflows.detail.copy_link')}
    </button>
  )
}
