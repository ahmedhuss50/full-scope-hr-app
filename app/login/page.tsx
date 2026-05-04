'use client'
import { useState } from 'react'
import { createSupabaseBrowser } from '@/lib/supabase/client'
import { LocaleProvider, useLocale } from '@/lib/i18n/LocaleContext'
import { LanguageToggle } from '@/components/LanguageToggle'

function LoginInner() {
  const { t } = useLocale()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setLoading(true)
    try {
      const supabase = createSupabaseBrowser()
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${siteUrl}/auth/callback` }
      })
      if (error) throw error
      setSent(true)
    } catch (err) {
      console.error(err)
      setError(t('login.error'))
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
              <h1 className="serif font-bold text-2xl mb-2">{t('login.sent_title')}</h1>
              <p className="text-ink/70 text-sm">{t('login.sent_body', { email })}</p>
            </>
          ) : (
            <>
              <h1 className="serif font-bold text-2xl mb-1">{t('login.title')}</h1>
              <p className="text-ink/70 text-sm mb-6">{t('login.subtitle')}</p>
              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <label className="label">{t('login.email')}</label>
                  <input
                    className="input" type="email" autoFocus required
                    value={email} onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
                <button type="submit" disabled={loading} className="btn-primary w-full">
                  {loading ? '…' : t('login.send')}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return <LocaleProvider><LoginInner /></LocaleProvider>
}
