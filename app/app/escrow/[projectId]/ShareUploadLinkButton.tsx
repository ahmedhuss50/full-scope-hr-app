'use client'

import { useState } from 'react'
import { Send, Copy, Check, ExternalLink, X, RotateCcw } from 'lucide-react'
import { strings, type Locale } from '@/lib/i18n/translations'
import { createUploadToken } from './share-upload-link/actions'

type Status = 'idle' | 'submitting' | 'success' | 'error'

export function ShareUploadLinkButton({
  locale,
  projectId,
}: {
  locale: Locale
  projectId: string
}) {
  const t = (key: keyof typeof strings, vars?: Record<string, string | number>): string => {
    const raw: string = strings[key]?.[locale] ?? strings[key]?.en ?? String(key)
    if (!vars) return raw
    return Object.entries(vars).reduce<string>(
      (acc, [k, val]) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(val)),
      raw,
    )
  }

  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState<boolean | null>(null)
  const [copied, setCopied] = useState(false)

  // Form state
  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [expiresDays, setExpiresDays] = useState<number>(7)
  const [notes, setNotes] = useState('')
  const [sendEmail, setSendEmail] = useState(true)

  function resetForm() {
    setRecipientName('')
    setRecipientEmail('')
    setExpiresDays(7)
    setNotes('')
    setSendEmail(true)
    setUrl(null)
    setExpiresAt(null)
    setEmailSent(null)
    setCopied(false)
    setError(null)
    setStatus('idle')
  }

  function closeModal() {
    setOpen(false)
    // Defer reset so the closing animation doesn't flash empty state.
    setTimeout(resetForm, 200)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!recipientName.trim() || !recipientEmail.trim()) {
      setError(t('escrow.share.modal.error.required'))
      return
    }

    setStatus('submitting')
    try {
      const res = await createUploadToken({
        project_id: projectId,
        recipient_name: recipientName.trim(),
        recipient_email: recipientEmail.trim(),
        expires_days: expiresDays,
        notes: notes.trim() || undefined,
        send_email: sendEmail,
      })
      if (!res.ok) {
        setError(res.error || t('escrow.share.modal.error.failed'))
        setStatus('error')
        return
      }
      setUrl(res.url)
      setExpiresAt(res.expires_at)
      setEmailSent(res.email_sent)
      setStatus('success')
    } catch (err) {
      console.error('[ShareUploadLinkButton] submit threw', err)
      setError(err instanceof Error ? err.message : t('escrow.share.modal.error.failed'))
      setStatus('error')
    }
  }

  async function copyUrl() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error('[ShareUploadLinkButton] copy failed', err)
    }
  }

  const labelCls = 'text-sm font-semibold text-slate-700 mb-1 block'
  const inputCls =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-semibold shadow-sm hover:bg-slate-50 transition"
      >
        <Send className="w-4 h-4" aria-hidden="true" />
        {t('escrow.share.button')}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={closeModal}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4 border-b border-slate-100">
              <div className="min-w-0">
                <h2 className="serif font-black text-xl text-slate-900 tracking-tight">
                  {status === 'success'
                    ? t('escrow.share.modal.success.title')
                    : t('escrow.share.modal.title')}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {status === 'success'
                    ? t('escrow.share.modal.success.subtitle')
                    : t('escrow.share.modal.subtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-700 shrink-0"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            {status !== 'success' ? (
              <form onSubmit={onSubmit} className="p-6 space-y-4">
                {error && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                  >
                    {error}
                  </div>
                )}

                <div>
                  <label className={labelCls} htmlFor="share_recipient_name">
                    {t('escrow.share.modal.field.recipient_name')} *
                  </label>
                  <input
                    id="share_recipient_name"
                    type="text"
                    required
                    maxLength={120}
                    className={inputCls}
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                  />
                </div>

                <div>
                  <label className={labelCls} htmlFor="share_recipient_email">
                    {t('escrow.share.modal.field.recipient_email')} *
                  </label>
                  <input
                    id="share_recipient_email"
                    type="email"
                    required
                    maxLength={180}
                    className={inputCls}
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                  />
                </div>

                <div>
                  <label className={labelCls} htmlFor="share_expires_days">
                    {t('escrow.share.modal.field.expiry_days')}
                  </label>
                  <input
                    id="share_expires_days"
                    type="number"
                    min={1}
                    max={90}
                    className={inputCls}
                    value={expiresDays}
                    onChange={(e) => setExpiresDays(Number(e.target.value) || 7)}
                  />
                </div>

                <div>
                  <label className={labelCls} htmlFor="share_notes">
                    {t('escrow.share.modal.field.notes')}
                  </label>
                  <textarea
                    id="share_notes"
                    rows={2}
                    className={inputCls}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={sendEmail}
                    onChange={(e) => setSendEmail(e.target.checked)}
                    className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  {t('escrow.share.modal.field.send_email')}
                </label>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={status === 'submitting'}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    {t('escrow.share.modal.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={status === 'submitting'}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" aria-hidden="true" />
                    {status === 'submitting'
                      ? t('escrow.share.modal.generating')
                      : t('escrow.share.modal.generate')}
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-6 space-y-4">
                {/* The URL */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">
                    URL
                  </div>
                  <div
                    className="text-xs font-mono text-slate-800 break-all"
                    dir="ltr"
                  >
                    {url}
                  </div>
                </div>

                {expiresAt && (
                  <div className="text-xs text-slate-500">
                    {locale === 'ar' ? 'ينتهي في: ' : 'Expires: '}
                    <span className="font-mono text-slate-700">
                      {new Date(expiresAt).toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US')}
                    </span>
                  </div>
                )}

                {emailSent !== null && (
                  <div
                    className={`text-xs px-3 py-2 rounded-lg ${
                      emailSent
                        ? 'bg-green-50 text-green-700 border border-green-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}
                  >
                    {emailSent
                      ? locale === 'ar'
                        ? 'تم إرسال البريد الإلكتروني للمستلم.'
                        : 'Email sent to the recipient.'
                      : locale === 'ar'
                        ? 'لم يُرسَل البريد الإلكتروني. انسخ الرابط وأرسله يدوياً.'
                        : 'Email was not sent. Copy the URL and send it manually.'}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={copyUrl}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied
                      ? t('escrow.share.modal.success.copied')
                      : t('escrow.share.modal.success.copy')}
                  </button>
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <ExternalLink className="w-4 h-4" />
                      {t('escrow.share.modal.success.open')}
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={resetForm}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <RotateCcw className="w-4 h-4" />
                    {t('escrow.share.modal.success.generate_another')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
