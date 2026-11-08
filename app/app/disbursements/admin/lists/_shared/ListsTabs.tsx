'use client'

/**
 * ListsTabs — horizontal chip-nav shown at the top of each tenant-wide list
 * page (buyers / contracts / units / payments / documents). Lets the owner
 * switch between the 5 list surfaces without bouncing back to the hub.
 *
 * Mirrors the ProjectChipNav pattern — longest pathname match wins so
 * paginated / filtered URLs still highlight the right tab.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Users, FileSignature, Building2, Coins, FileText } from 'lucide-react'

type TabKey = 'buyers' | 'contracts' | 'units' | 'payments' | 'documents'

const TABS: Array<{
  key: TabKey
  label: string
  href: string
  match: string
  Icon: typeof Users
}> = [
  { key: 'documents', label: 'سجل الوثائق', href: '/app/disbursements/documents',             match: '/app/disbursements/documents',             Icon: FileText },
  { key: 'payments',  label: 'الدفعات',     href: '/app/disbursements/admin/lists/payments',  match: '/app/disbursements/admin/lists/payments',  Icon: Coins },
  { key: 'buyers',    label: 'المشترون',    href: '/app/disbursements/admin/lists/buyers',    match: '/app/disbursements/admin/lists/buyers',    Icon: Users },
  { key: 'contracts', label: 'العقود',       href: '/app/disbursements/admin/lists/contracts', match: '/app/disbursements/admin/lists/contracts', Icon: FileSignature },
  { key: 'units',     label: 'الوحدات',      href: '/app/disbursements/admin/lists/units',     match: '/app/disbursements/admin/lists/units',     Icon: Building2 },
]

export function ListsTabs() {
  const pathname = usePathname() ?? ''
  const active = TABS
    .filter((t) => pathname === t.match || pathname.startsWith(`${t.match}/`) || pathname.startsWith(`${t.match}?`))
    .sort((a, b) => b.match.length - a.match.length)[0]?.key ?? null

  return (
    <nav className="flex gap-1 border-b border-slate-200 overflow-x-auto -mx-1 px-1" dir="rtl">
      {TABS.map((t) => {
        const isActive = t.key === active
        return (
          <Link
            key={t.key}
            href={t.href}
            className={
              'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold whitespace-nowrap transition ' +
              (isActive
                ? 'text-teal-700 border-b-2 border-teal-600 -mb-px'
                : 'text-slate-500 hover:text-slate-900 border-b-2 border-transparent -mb-px')
            }
          >
            <t.Icon className="w-3.5 h-3.5" aria-hidden="true" />
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
