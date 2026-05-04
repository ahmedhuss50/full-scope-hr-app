'use client'
/**
 * Top navigation bar for /portal/* routes. Active item is derived from the
 * current pathname. Bilingual.
 *
 * Distinct from the firm Sidebar — flat horizontal nav, narrower visual rhythm,
 * lots of whitespace. The portal must FEEL different from the firm app to a
 * client signing in.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale } from '@/lib/i18n/LocaleContext'

const ITEMS = [
  { href: '/portal/dashboard',   key: 'portal.nav.dashboard' as const },
  { href: '/portal/engagements', key: 'portal.nav.engagements' as const },
  { href: '/portal/documents',   key: 'portal.nav.documents' as const },
  { href: '/portal/invoices',    key: 'portal.nav.invoices' as const },
]

export function PortalNav() {
  const pathname = usePathname() ?? ''
  const { t } = useLocale()

  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="max-w-5xl mx-auto px-6">
        <ul className="flex items-center gap-1 overflow-x-auto -mb-px">
          {ITEMS.map((item) => {
            // Match exact dashboard, prefix-match deeper sections.
            const active = pathname === item.href || (item.href !== '/portal/dashboard' && pathname.startsWith(item.href))
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={[
                    'inline-block px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition',
                    active
                      ? 'text-teal-700 border-teal-600'
                      : 'text-slate-600 border-transparent hover:text-slate-900',
                  ].join(' ')}
                >
                  {t(item.key)}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
