'use client'
/**
 * Client Portal — no-access page.
 *
 * Shown when a signed-in user's email is not in `portal_invitations`. Could be
 * a firm staff member who clicked a portal link by mistake, or a former client
 * whose access was revoked. Friendly, bilingual.
 */
import Link from 'next/link'
import { LocaleProvider, useLocale } from '@/lib/i18n/LocaleContext'
import { LanguageToggle } from '@/components/LanguageToggle'

function NoAccessInner() {
  const { t } = useLocale()
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-white to-slate-50">
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-between mb-8">
          <Link href="/portal" className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-ink text-white font-black text-sm">F</span>
            <span className="serif text-lg font-bold">Full Scope</span>
          </Link>
          <LanguageToggle />
        </div>

        <div className="card p-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 mb-4 mx-auto">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="serif font-bold text-2xl mb-3 text-slate-900">{t('portal.no_access.title')}</h1>
          <p className="text-sm text-slate-600 leading-relaxed mb-6">{t('portal.no_access.body')}</p>
          <Link href="/portal" className="btn-ghost inline-flex items-center">
            {t('portal.no_access.back')}
          </Link>
        </div>
      </div>
    </main>
  )
}

export default function PortalNoAccessPage() {
  return (
    <LocaleProvider>
      <NoAccessInner />
    </LocaleProvider>
  )
}
