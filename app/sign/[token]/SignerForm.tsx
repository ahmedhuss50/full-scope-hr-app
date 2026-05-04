'use client'
import { useState, useTransition } from 'react'
import { useLocale } from '@/lib/i18n/LocaleContext'
import { submitSignFormAction } from './actions'

export function SignerForm({ token }: { token: string }) {
  const { t } = useLocale()
  const [showReject, setShowReject] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()

  function approve() {
    const fd = new FormData()
    fd.set('token', token)
    fd.set('decision', 'approve')
    startTransition(() => submitSignFormAction(fd))
  }

  function submitReject(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    fd.set('token', token)
    fd.set('decision', 'reject')
    fd.set('reason', reason)
    startTransition(() => submitSignFormAction(fd))
  }

  return (
    <div className="space-y-4">
      {!showReject ? (
        <div className="flex flex-col sm:flex-row items-stretch gap-3">
          <button
            type="button"
            onClick={approve}
            disabled={pending}
            className="flex-1 inline-flex items-center justify-center px-6 py-3 rounded-lg bg-teal-600 text-white text-base font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pending ? '…' : t('sign.approve')}
          </button>
          <button
            type="button"
            onClick={() => setShowReject(true)}
            disabled={pending}
            className="flex-1 inline-flex items-center justify-center px-6 py-3 rounded-lg bg-white text-slate-700 text-base font-semibold border border-slate-300 hover:bg-slate-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {t('sign.reject')}
          </button>
        </div>
      ) : (
        <form onSubmit={submitReject} className="space-y-3 p-4 rounded-lg border border-slate-200 bg-slate-50">
          <label className="block">
            <span className="block text-sm font-semibold text-slate-700 mb-1">
              {t('sign.reject_reason_label')}
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              minLength={3}
              rows={4}
              placeholder={t('sign.reject_reason_placeholder')}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-white"
            />
          </label>
          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => { setShowReject(false); setReason('') }}
              disabled={pending}
              className="px-4 py-2 rounded-lg bg-white text-slate-700 text-sm font-semibold border border-slate-300 hover:bg-slate-100 transition"
            >
              {t('sign.cancel')}
            </button>
            <button
              type="submit"
              disabled={pending || reason.trim().length < 3}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold shadow-sm hover:bg-red-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {pending ? '…' : t('sign.reject_confirm')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
