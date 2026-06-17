'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@/lib/supabase/client'
import { LocaleProvider } from '@/lib/i18n/LocaleContext'
import { LanguageToggle } from '@/components/LanguageToggle'

/**
 * Reset / set password.
 *
 * Two ways someone lands here:
 *   1. Clicked a reset link from /forgot-password — Supabase puts a recovery
 *      token in the URL fragment. The Supabase client picks it up via
 *      onAuthStateChange("PASSWORD_RECOVERY") and gives us a temporary
 *      session sufficient to call updateUser({ password }).
 *   2. Clicked the welcome email link as a new user — same flow.
 *
 * The recovery session does not let them access protected routes; they must
 * complete the password update first.
 */
function ResetInner() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const supabase = createSupabaseBrowser()
    let cancelled = false

    // If an older reset email link landed us here directly with a `?code=`
    // in the URL (i.e. it skipped /auth/callback), exchange it ourselves so
    // updateUser({password}) below has a real session to write against.
    async function tryExchangeFromUrl() {
      if (typeof window === 'undefined') return
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      if (!code) return
      try {
        await supabase.auth.exchangeCodeForSession(code)
      } catch {
        /* fall through; getSession below will catch the missing-session case */
      } finally {
        // Tidy the URL so a refresh doesn't try to re-exchange a used code.
        if (!cancelled) {
          const cleaned = window.location.pathname + window.location.hash
          window.history.replaceState(null, '', cleaned)
        }
      }
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        setReady(true)
      }
    })

    tryExchangeFromUrl().then(() => {
      if (cancelled) return
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) setReady(true)
      })
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.')
      return
    }
    if (password !== confirm) {
      setError('كلمتا المرور غير متطابقتين.')
      return
    }
    setLoading(true)
    try {
      const supabase = createSupabaseBrowser()
      const { error: updErr } = await supabase.auth.updateUser({ password })
      if (updErr) {
        setError(updErr.message || 'تعذّر تحديث كلمة المرور.')
        setLoading(false)
        return
      }
      setDone(true)
      setTimeout(() => router.push('/app'), 1500)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'تعذّر تحديث كلمة المرور.')
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
          <h1 className="serif font-bold text-2xl mb-1">إعداد كلمة المرور</h1>
          <p className="text-ink/70 text-sm mb-6">
            اختر كلمة مرور آمنة (8 أحرف على الأقل) لتتمكن من تسجيل الدخول إلى Full Scope.
          </p>

          {!ready && !done && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 mb-4">
              جارٍ التحقق من رابط الإعداد… إذا فُتحت هذه الصفحة دون الرابط، عد إلى{' '}
              <Link href="/forgot-password" className="font-semibold underline">صفحة إعادة التعيين</Link>.
            </div>
          )}

          {done ? (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              تم حفظ كلمة المرور بنجاح. جارٍ تحويلك…
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="label">كلمة المرور الجديدة</label>
                <input
                  className="input"
                  type="password"
                  required
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  dir="ltr"
                  disabled={!ready || loading}
                />
              </div>
              <div>
                <label className="label">تأكيد كلمة المرور</label>
                <input
                  className="input"
                  type="password"
                  required
                  autoComplete="new-password"
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  dir="ltr"
                  disabled={!ready || loading}
                />
              </div>
              {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
              <button type="submit" disabled={!ready || loading} className="btn-primary w-full">
                {loading ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'}
              </button>
            </form>
          )}

          <div className="mt-5 text-center">
            <Link href="/login" className="text-sm font-semibold text-teal-700 hover:underline">
              العودة إلى تسجيل الدخول
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}

export default function ResetPasswordPage() {
  return <LocaleProvider><ResetInner /></LocaleProvider>
}
