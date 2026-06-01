'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createEmployee } from './actions'

export function NewEmployeeForm() {
  const router = useRouter()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [sendInvite, setSendInvite] = useState(true)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fallbackLink, setFallbackLink] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setFallbackLink(null)
    setWarning(null)

    if (!fullName.trim() || !email.trim()) {
      setError('الرجاء تعبئة جميع الحقول المطلوبة.')
      return
    }

    setSubmitting(true)
    try {
      const res = await createEmployee({
        full_name: fullName.trim(),
        email: email.trim(),
        job_title: jobTitle.trim() || null,
        notes: notes.trim() || null,
        send_invite: sendInvite,
      })
      if (!res.ok) {
        setError(res.error)
        setSubmitting(false)
        return
      }
      if (res.fallback_link || res.warning) {
        setFallbackLink(res.fallback_link ?? null)
        setWarning(res.warning ?? null)
        setSubmitting(false)
        setTimeout(
          () => router.push('/app/disbursements/admin?created=employee'),
          900,
        )
        return
      }
      router.push('/app/disbursements/admin?created=employee')
    } catch (err) {
      console.error('[NewEmployeeForm] submit threw', err)
      setError(err instanceof Error ? err.message : 'تعذّر إنشاء الموظف.')
      setSubmitting(false)
    }
  }

  const labelCls = 'text-sm font-semibold text-slate-700 mb-1 block'
  const inputCls =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500'

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 bg-white border border-slate-200 rounded-xl p-6 shadow-sm"
    >
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {warning && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {warning}
        </div>
      )}

      {fallbackLink && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900 space-y-1">
          <div className="font-semibold">رابط الدعوة (انسخه وأرسله):</div>
          <div className="font-mono text-xs break-all bg-white border border-teal-100 rounded p-2">
            {fallbackLink}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} htmlFor="full_name">
            الاسم الكامل *
          </label>
          <input
            id="full_name"
            required
            className={inputCls}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={200}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="email">
            البريد الإلكتروني *
          </label>
          <input
            id="email"
            type="email"
            required
            dir="ltr"
            className={inputCls + ' text-left'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={320}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="job_title">
          المسمى الوظيفي
        </label>
        <input
          id="job_title"
          className={inputCls}
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          maxLength={200}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="notes">
          ملاحظات
        </label>
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
        <span className="text-sm text-slate-700">إنشاء حساب دخول للموظف</span>
      </label>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition disabled:opacity-50"
        >
          {submitting ? 'جارٍ الإنشاء…' : 'إنشاء الموظف'}
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
