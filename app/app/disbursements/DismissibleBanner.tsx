'use client'

/**
 * DismissibleBanner
 * ---------------------------------------------------------------------------
 * Compliance alert banner the user can dismiss for the current tab session.
 * State is intentionally in memory only — reloads bring the banner back so
 * we never hide a real breach permanently.
 *
 * Tones: 'red' (hard breach) | 'amber' (warning).
 */
import { useState } from 'react'
import { AlertCircle, AlertTriangle, X } from 'lucide-react'

export function DismissibleBanner({
  tone,
  title,
  message,
}: {
  tone: 'red' | 'amber'
  title: string
  message: string
}) {
  const [open, setOpen] = useState(true)
  if (!open) return null

  const cls =
    tone === 'red'
      ? 'bg-red-50 border-red-500 text-red-900'
      : 'bg-amber-50 border-amber-500 text-amber-900'
  const Icon = tone === 'red' ? AlertCircle : AlertTriangle

  return (
    <div className={`rounded-lg border-r-4 ${cls} px-4 py-3 flex items-start gap-3`} dir="rtl">
      <Icon className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm">{title}</div>
        <div className="text-sm mt-0.5 opacity-90">{message}</div>
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="shrink-0 opacity-70 hover:opacity-100"
        aria-label="إغلاق التنبيه"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  )
}
