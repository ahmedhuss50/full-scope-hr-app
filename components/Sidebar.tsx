'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Inbox, ClipboardList, Users, Briefcase } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleContext'
import type { StringKey } from '@/lib/i18n/translations'
import { SignOutButton } from '@/app/app/SignOutButton'

export type SidebarCounts = {
  applications: number
  onboarding: number
  employees: number
  jobs: number
}

export type SidebarUser = {
  full_name: string | null
  email: string | null
}

type Item = {
  href: string
  labelKey: StringKey
  icon: typeof LayoutDashboard
  countKey?: keyof SidebarCounts
}

const ITEMS: Item[] = [
  { href: '/app',             labelKey: 'nav.dashboard',    icon: LayoutDashboard },
  { href: '/app/applications', labelKey: 'nav.applications', icon: Inbox,         countKey: 'applications' },
  { href: '/app/onboarding',  labelKey: 'nav.onboarding',   icon: ClipboardList,  countKey: 'onboarding' },
  { href: '/app/employees',   labelKey: 'nav.employees',    icon: Users,          countKey: 'employees' },
  { href: '/app/jobs',        labelKey: 'nav.jobs',         icon: Briefcase,      countKey: 'jobs' },
]

function isActive(pathname: string, href: string) {
  if (href === '/app') return pathname === '/app'
  return pathname === href || pathname.startsWith(href + '/')
}

export function Sidebar({ counts, user }: { counts: SidebarCounts; user: SidebarUser }) {
  const pathname = usePathname() ?? '/app'
  const { t } = useLocale()

  return (
    <aside
      className="w-64 shrink-0 min-h-screen bg-white border-e border-slate-200 flex flex-col"
      aria-label="Primary"
    >
      <div className="px-5 py-5 border-b border-slate-200">
        <Link href="/app" className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-slate-900 text-white font-black text-sm">
            F
          </span>
          <span className="font-bold text-slate-900">Full Scope HR</span>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href)
          const Icon = item.icon
          const count = item.countKey ? counts[item.countKey] : undefined
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                active
                  ? 'bg-teal-50 text-teal-600'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Icon className={`w-5 h-5 shrink-0 ${active ? 'text-teal-600' : 'text-slate-500'}`} aria-hidden="true" />
              <span className="flex-1 truncate">{t(item.labelKey)}</span>
              {typeof count === 'number' && count > 0 && (
                <span className="inline-flex items-center justify-center min-w-[1.25rem] px-2 py-0.5 rounded-full bg-gray-100 text-slate-700 text-xs font-semibold">
                  {count}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="px-4 py-4 border-t border-slate-200">
        <div className="mb-3 min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">
            {user.full_name ?? '—'}
          </div>
          <div className="text-xs text-slate-500 truncate">
            {user.email ?? ''}
          </div>
        </div>
        <SignOutButton />
      </div>
    </aside>
  )
}
