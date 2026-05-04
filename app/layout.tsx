import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Full Scope',
  description: 'Bilingual AR/EN operating suite (HR, CRM, Accounting) for accounting and business-development firms in the GCC.',
}

/**
 * Full Scope HR defaults to Arabic. We respect a `full-scope-hr.locale` cookie if the user
 * has explicitly toggled the LanguageToggle (which writes to localStorage on
 * the client and synchronizes via the LocaleContext on hydration). Server-
 * rendered initial HTML uses the cookie value if present; otherwise AR.
 */
function readInitialLocale(): { locale: 'ar' | 'en'; dir: 'rtl' | 'ltr' } {
  try {
    const c = cookies().get('full-scope-hr.locale')?.value
    if (c === 'en') return { locale: 'en', dir: 'ltr' }
  } catch {}
  return { locale: 'ar', dir: 'rtl' }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, dir } = readInitialLocale()
  return (
    <html lang={locale} dir={dir}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800;900&family=Source+Serif+Pro:wght@600;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
