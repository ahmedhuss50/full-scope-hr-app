'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from './actions'

export function NewClientForm() {
  const router = useRouter()

  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [sendInvite, setSendInvite] = useState(true)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [inviteWarning, setInviteWarning] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setInviteLink(null)
    setInviteWarning(null)

    if (!companyName.trim() || !contactEmail.trim()) {
      setError('الرجاء تعبئة جميع الحقول المطلوبة.')
      return
    }

    setSubmitting(true)
    try {
      const res = await createClient({
        company_name_ar: companyName.trim(),
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim(),
        notes: notes.trim() || null,
        send_invite: sendInvite,
      })
      if (!res.ok) {
        setError(res.error)
        setSubmitting(false)
        return
      }
      // If there's an invite link to surface, show it before redirecting.
      if (res.invite_link || res.invite_warning) {
        setInviteLink(res.invite_link ?? null)
        setInviteWarning(res.invite_warning ?? null)
        setSubmitting(false)
        // Give the user a moment, then go back to admin landing.
        setTimeout(() => router.push('/app/disbursements/admin?created=client'), 600)
        return
      }
      router.push('/app/disbursements/admin?created=client')
    } catch (err) {
      console.error('[NewClientForm] submit threw', err)
      setError(err instanceof Error ? err.message : 'تعذّر إنشاء العميل.')
      setSubmitting(false)
    }
  }

  const labelCls = 'text-sm font-semibold text-slate-700 mb-1 block'
  const inputCls =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500'

  return (
    <form onSubmit={onSubmit} className="space-y-5 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {inviteWarning && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {inviteWarning}
        </div>
      )}

      {inviteLink && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900 space-y-1">
          <div className="font-semibold">رابط الدعوة (انسخه وأرسله):</div>
          <div className="font-mono text-xs break-all bg-white border border-teal-100 rounded p-2">
            {inviteLink}
          </div>
        </div>
      )}

      <div>
        <label className={labelCls} htmlFor="company_name">اسم الشركة *</label>
        <input
          id="company_name"
          required
          className={inputCls}
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          maxLength={200}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} htmlFor="contact_name">جهة الاتصال</label>
          <input
            id="contact_name"
            className={inputCls}
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            maxLength={200}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="contact_email">البريد الإلكتروني *</label>
          <input
            id="contact_email"
            type="email"
            required
            dir="ltr"
            className={inputCls + ' text-left'}
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            maxLength={320}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="notes">ملاحظات</label>
        <textarea
          id="notes"
          rows={3}
          className={inputCls}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={sendInvite}
          onChange={(e) => setSendInvite(e.target.checked)}
          className="mt-1 w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <span className="text-sm text-slate-700">إنشاء حساب دخول للعميل</span>
      </label>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          {submitting ? 'جارٍ الإنشاء…' : 'إنشاء العميل'}
        </button>
        <a
          href="/app/disbursements/admin"
          className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          إلغاء
        </a>
      </div>
    </form>
  )
}
