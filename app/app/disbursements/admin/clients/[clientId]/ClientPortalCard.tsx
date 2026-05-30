'use client'

import { useState } from 'react'
import { Copy, Check, Send, KeyRound } from 'lucide-react'
import { sendClientPortalSignInLink } from './portal-link/actions'

type Status = 'idle' | 'sending' | 'sent' | 'error'

export function ClientPortalCard({
  clientId,
  recipientName: _recipientName,
  recipientEmail,
  hasLogin,
  portalUrl,
}: {
  clientId: string
  recipientName: string | null
  recipientEmail: string | null
  hasLogin: boolean
  portalUrl: string
}) {
  // recipientName is accepted for API symmetry with the server action's email
  // body but not displayed here — the server resolves the name from the DB row.
  void _recipientName
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const hasEmail = !!recipientEmail && recipientEmail.trim().length > 0

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(portalUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: silently ignore — most modern browsers support clipboard.
    }
  }

  async function onSend() {
    if (!hasEmail) return
    setStatus('sending')
    setMessage(null)
    try {
      const res = await sendClientPortalSignInLink({ developer_id: clientId })
      if (res.ok) {
        setStatus('sent')
        setMessage(res.message)
        setTimeout(() => {
          setStatus('idle')
          setMessage(null)
        }, 3000)
      } else {
        setStatus('error')
        setMessage(res.error)
      }
    } catch (e) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : 'تعذّر إرسال الرابط.')
    }
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-4" dir="rtl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
            <KeyRound className="w-4 h-4 text-slate-500" aria-hidden="true" />
            بوابة العميل
          </div>
          <p className="text-xs text-slate-500">
            رابط دخول العميل إلى بوابته الخاصة لمتابعة الصرفيات.
          </p>
        </div>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${
            hasLogin
              ? 'bg-green-50 text-green-700 ring-green-200'
              : 'bg-amber-50 text-amber-700 ring-amber-200'
          }`}
        >
          {hasLogin ? 'لديه حساب' : 'لا يوجد حساب — سيُنشأ عند الإرسال'}
        </span>
      </div>

      <div className="flex items-stretch gap-2">
        <input
          type="text"
          readOnly
          value={portalUrl}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
          dir="ltr"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              تم النسخ ✓
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              نسخ الرابط
            </>
          )}
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onSend}
          disabled={!hasEmail || status === 'sending'}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === 'sending' ? (
            <>
              <Send className="w-3.5 h-3.5 animate-pulse" aria-hidden="true" />
              جاري الإرسال…
            </>
          ) : status === 'sent' ? (
            <>
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              تم الإرسال ✓
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              إرسال رابط الدخول إيميل
            </>
          )}
        </button>
        {!hasEmail && (
          <span className="text-xs text-amber-700">لا يوجد بريد إلكتروني للعميل</span>
        )}
        {status === 'error' && message && (
          <span className="text-xs text-red-700">{message}</span>
        )}
        {status === 'sent' && message && (
          <span className="text-xs text-green-700">{message}</span>
        )}
      </div>
    </section>
  )
}
