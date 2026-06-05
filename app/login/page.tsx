'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@/lib/supabase/client'
import { LocaleProvider } from '@/lib/i18n/LocaleContext'
import { LanguageToggle } from '@/components/LanguageToggle'

/**
 * Email + password sign-in. Replaces the magic-link flow.
 *
 * First-time users (or anyone who's forgotten their password) click the
 * "نسيت كلمة المرور؟" link below the form which routes to /forgot-password.
 * That triggers Supabase to email a reset link, which lands at
 * /reset-password and lets them set a new password.
 */
function LoginInner() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const supabase = createSupabaseBrowser()
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (signInErr) {
        // Most common: bad credentials.
        if (signInErr.message?.toLowerCase().includes('invalid')) {
          setError('البريد الإلكتروني أو كلمة المرور غير صحيحة.')
        } else if (signInErr.message?.toLowerCase().includes('email not confirmed')) {
          setError('لم يتم تأكيد البريد الإلكتروني بعد.')
        } else {
          setError(signInErr.message || 'تعذّر تسجيل الدخول.')
        }
        return
      }
      // Server will route by role from /app (developer → /developer, staff → /app/disbursements).
      router.push('/app')
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'تعذّر تسجيل الدخول.')
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
          <h1 className="serif font-bold text-2xl mb-1">تسجيل الدخول</h1>
          <p className="text-ink/70 text-sm mb-6">أدخل بريدك الإلكتروني وكلمة المرور.</p>
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
            <div>
              <label className="label">كلمة المرور</label>
              <input
                className="input"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                dir="ltr"
              />
            </div>
            {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'جارٍ تسجيل الدخول…' : 'تسجيل الدخول'}
            </button>
          </form>
          <div className="mt-5 text-center">
            <Link
              href="/forgot-password"
              className="text-sm font-semibold text-teal-700 hover:text-teal-800 hover:underline"
            >
              نسيت كلمة المرور؟
            </Link>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-ink/50">
          المستخدمون الجدد: استخدم زر «نسيت كلمة المرور؟» لإعداد كلمة المرور لأول مرة.
        </p>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return <LocaleProvider><LoginInner /></LocaleProvider>
}
