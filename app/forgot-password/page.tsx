'use client'
import Link from 'next/link'
import { useState } from 'react'
import { createSupabaseBrowser } from '@/lib/supabase/client'
import { LocaleProvider } from '@/lib/i18n/LocaleContext'
import { LanguageToggle } from '@/components/LanguageToggle'

/**
 * Forgot password — triggers Supabase to send a reset email. The link in
 * the email lands at /reset-password where the user enters their new
 * password. We always show the same "if the email exists you'll get a link"
 * message even if the email isn't on file, so we don't leak user existence.
 */
function ForgotInner() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const supabase = createSupabaseBrowser()
      const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: `${siteUrl}/reset-password` },
      )
      if (resetErr) {
        console.error(resetErr)
        // Don't reveal whether the email exists.
      }
      setSent(true)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'حدث خطأ.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-ink text-white font-black text-sm">F</span>
            <span className="serif text-lg font-bold">Full Scope</span>
          </div>
          <LanguageToggle />
        </div>

        <div className="card p-8">
          {sent ? (
            <>
              <h1 className="serif font-bold text-2xl mb-2">تحقّق من بريدك</h1>
              <p className="text-ink/70 text-sm">
                إذا كان البريد <strong dir="ltr">{email}</strong> موجودًا لدينا، فسنرسل لك رابطًا لإعداد كلمة المرور.
                افتح الرابط من بريدك وأدخل كلمة المرور الجديدة.
              </p>
              <div className="mt-6 text-center">
                <Link href="/login" className="text-sm font-semibold text-teal-700 hover:underline">
                  العودة إلى تسجيل الدخول
                </Link>
              </div>
            </>
          ) : (
            <>
              <h1 className="serif font-bold text-2xl mb-1">إعادة تعيين كلمة المرور</h1>
              <p className="text-ink/70 text-sm mb-6">
                أدخل بريدك الإلكتروني وسنرسل لك رابطًا لإعداد كلمة مرور جديدة.
              </p>
              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <label className="label">البريد الإلكتروني</label>
                  <input
                    className="input"
                    type="email"
                    autoFocus
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    dir="ltr"
                  />
                </div>
                {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
                <button type="submit" disabled={loading} className="btn-primary w-full">
                  {loading ? 'جارٍ الإرسال…' : 'إرسال رابط الإعداد'}
                </button>
              </form>
              <div className="mt-5 text-center">
                <Link href="/login" className="text-sm font-semibold text-teal-700 hover:underline">
                  العودة إلى تسجيل الدخول
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

export default function ForgotPasswordPage() {
  return <LocaleProvider><ForgotInner /></LocaleProvider>
}
