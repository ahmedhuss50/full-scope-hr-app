'use client'

import { useState } from 'react'
import { Mail, Send } from 'lucide-react'
import {
  sendWelcomeEmailToUser,
  sendWelcomeEmailToAllStaff,
} from './welcome-actions'

/**
 * Inline "send welcome email" button for a single staff row. Two-step:
 * click once to show the button label, click again to fire. We keep it
 * simple (no modal confirmation) — the email is non-destructive.
 */
export function SendWelcomeToUserButton({
  userId,
  fullName,
}: {
  userId: string
  fullName: string
}) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    setError(null)
    setBusy(true)
    const res = await sendWelcomeEmailToUser({ user_id: userId })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setDone(true)
    setTimeout(() => setDone(false), 2500)
  }

  return (
    <div className="inline-flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        title={`إرسال بريد ترحيب إلى ${fullName}`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
      >
        <Mail className="w-3.5 h-3.5" aria-hidden="true" />
        {busy ? 'جاري الإرسال…' : done ? '✓ تم الإرسال' : 'بريد ترحيب'}
      </button>
      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          {error}
        </div>
      )}
    </div>
  )
}

/**
 * Section-header button: send welcome to every staff member (except the
 * caller). Shows a confirmation prompt because it's a fan-out and the user
 * should know what they're triggering.
 */
export function SendWelcomeToAllStaffButton() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<{ sent: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onConfirm() {
    setError(null)
    setSummary(null)
    setBusy(true)
    const res = await sendWelcomeEmailToAllStaff()
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSummary({ sent: res.sent, skipped: res.skipped })
    setOpen(false)
  }

  if (!open) {
    return (
      <div className="inline-flex flex-col items-stretch gap-1">
        <button
          type="button"
          onClick={() => { setOpen(true); setSummary(null); setError(null) }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
        >
          <Send className="w-3.5 h-3.5" aria-hidden="true" />
          إرسال ترحيب للجميع
        </button>
        {summary && (
          <div className="rounded-md border border-green-200 bg-green-50 px-2 py-1 text-[11px] text-green-700">
            تم الإرسال إلى {summary.sent}{summary.skipped > 0 ? `، تجاوز ${summary.skipped}` : ''}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="inline-flex flex-col items-stretch gap-1.5 max-w-sm">
      <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 text-xs">
        سيتم إرسال بريد ترحيب يحتوي على رابط الدخول إلى جميع الموظفين والمشرفين والمديرين في النظام (باستثناءك). هل تريد المتابعة؟
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex items-center px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition disabled:opacity-50"
        >
          {busy ? 'جاري الإرسال…' : 'نعم، أرسل'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
        >
          إلغاء
        </button>
      </div>
      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          {error}
        </div>
      )}
    </div>
  )
}
