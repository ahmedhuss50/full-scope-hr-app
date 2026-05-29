'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Inbox, ClipboardList, Users, Briefcase, ShieldCheck, BarChart3, ArrowLeft, FolderLock, Folders, Files, Home, Contact, TrendingUp, Workflow, Landmark, ScrollText, ShoppingBag, Wallet, Settings, FileText } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleContext'
import type { StringKey } from '@/lib/i18n/translations'
import { SignOutButton } from '@/app/app/SignOutButton'

export type SidebarCounts = {
  applications: number
  onboarding: number
  employees: number
  certs: number
  jobs: number
  costs: number
  /** DMS: confidential + restricted document count (badge on Home) */
  dmsSensitive: number
  /** DMS: in-flight workflow runs (badge on Workflows nav item) */
  dmsActiveWorkflows: number
  /** CRM: open tasks (kind='task' AND completed=false) badge on Home */
  crmOpenTasks: number
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

// Nav items are module-scoped now that the suite shell sits at /app.
// Each module gets its own ITEMS list and the sidebar picks one based on
// the current pathname.
const HR_ITEMS: Item[] = [
  { href: '/app/hr',              labelKey: 'nav.dashboard',    icon: LayoutDashboard },
  { href: '/app/hr/applications', labelKey: 'nav.applications', icon: Inbox,         countKey: 'applications' },
  { href: '/app/hr/onboarding',   labelKey: 'nav.onboarding',   icon: ClipboardList,  countKey: 'onboarding' },
  { href: '/app/hr/employees',    labelKey: 'nav.employees',    icon: Users,          countKey: 'employees' },
  { href: '/app/hr/certs',        labelKey: 'nav.certs',        icon: ShieldCheck,    countKey: 'certs' },
  { href: '/app/hr/jobs',         labelKey: 'nav.jobs',         icon: Briefcase,      countKey: 'jobs' },
  { href: '/app/hr/costs',        labelKey: 'nav.costs',        icon: BarChart3,      countKey: 'costs' },
]

const DMS_ITEMS: Item[] = [
  { href: '/app/dms',           labelKey: 'dms.nav.home',      icon: FolderLock, countKey: 'dmsSensitive' },
  { href: '/app/dms/clients',   labelKey: 'dms.nav.clients',   icon: Folders },
  { href: '/app/dms/all',       labelKey: 'dms.nav.all',       icon: Files },
  { href: '/app/dms/workflows', labelKey: 'dms.nav.workflows', icon: Workflow,   countKey: 'dmsActiveWorkflows' },
]

const CRM_ITEMS: Item[] = [
  { href: '/app/crm',          labelKey: 'crm.nav.home',     icon: Home,       countKey: 'crmOpenTasks' },
  { href: '/app/crm/clients',  labelKey: 'crm.nav.clients',  icon: Folders },
  { href: '/app/crm/deals',    labelKey: 'crm.nav.deals',    icon: TrendingUp },
  { href: '/app/crm/contacts', labelKey: 'crm.nav.contacts', icon: Contact },
]

// Escrow Control nav — temporarily hidden after the disbursement pivot.
// Keep the definitions around in case we revive the module; the sidebar simply
// never routes here.
const ESCROW_ITEMS: Item[] = [
  // { href: '/app/escrow',           labelKey: 'escrow.nav.home',      icon: Landmark },        // hidden
  // { href: '/app/escrow/vouchers',  labelKey: 'escrow.nav.vouchers',  icon: ScrollText },      // hidden
  // { href: '/app/escrow/suppliers', labelKey: 'escrow.nav.suppliers', icon: ShoppingBag },     // hidden
  // { href: '/app/escrow/deposits',  labelKey: 'escrow.nav.deposits',  icon: Wallet },          // hidden
  // { href: '/app/escrow/settings',  labelKey: 'escrow.nav.settings',  icon: Settings },        // hidden
]

// Disbursements (الصرف) — the active workflow module after the pivot.
const DSB_ITEMS: Item[] = [
  { href: '/app/disbursements?tab=mine',      labelKey: 'dsb.nav.inbox',  icon: Inbox },
  { href: '/app/disbursements?tab=active',    labelKey: 'dsb.nav.active', icon: ScrollText },
  { href: '/app/disbursements?tab=signed',    labelKey: 'dsb.nav.signed', icon: FileText },
  { href: '/app/disbursements/admin',         labelKey: 'dsb.nav.admin',  icon: Settings },
]

function isActive(pathname: string, href: string) {
  // Strip query strings — nav items may include ?tab=… for tabbed sub-pages.
  const hrefPath = href.split('?')[0] ?? href
  if (hrefPath === '/app/hr')             return pathname === '/app/hr'
  if (hrefPath === '/app/dms')            return pathname === '/app/dms'
  if (hrefPath === '/app/crm')            return pathname === '/app/crm'
  if (hrefPath === '/app/escrow')         return pathname === '/app/escrow' || /^\/app\/escrow\/[^/]+$/.test(pathname)
  if (hrefPath === '/app/disbursements')  return pathname === '/app/disbursements'
  return pathname === hrefPath || pathname.startsWith(hrefPath + '/')
}

/** Resolve which module the user is currently inside. */
function moduleFor(pathname: string): 'hr' | 'crm' | 'accounting' | 'dms' | 'escrow' | 'dsb' | 'picker' {
  if (pathname.startsWith('/app/hr'))             return 'hr'
  if (pathname.startsWith('/app/dms'))            return 'dms'
  if (pathname.startsWith('/app/crm'))            return 'crm'
  if (pathname.startsWith('/app/escrow'))         return 'escrow'
  if (pathname.startsWith('/app/disbursements'))  return 'dsb'
  if (pathname.startsWith('/app/accounting'))     return 'accounting'
  return 'picker'
}

export function Sidebar({ counts, user }: { counts: SidebarCounts; user: SidebarUser }) {
  const pathname = usePathname() ?? '/app'
  const { t } = useLocale()
  const currentModule = moduleFor(pathname)

  // The picker page (/app) gets a slimmer sidebar — no module nav, just the
  // brand header + sign-out. The user is choosing a module, not navigating
  // inside one.
  const showModuleNav = currentModule === 'hr' || currentModule === 'dms' || currentModule === 'crm' || currentModule === 'dsb'
  const items =
    currentModule === 'dms'    ? DMS_ITEMS :
    currentModule === 'crm'    ? CRM_ITEMS :
    currentModule === 'dsb'    ? DSB_ITEMS :
    currentModule === 'escrow' ? ESCROW_ITEMS :
    HR_ITEMS

  // Silence unused-vars TS warnings for icons still referenced by hidden
  // ESCROW_ITEMS placeholders (kept for future revival).
  void Landmark; void ShoppingBag; void Wallet

  const moduleLabel: Record<typeof currentModule, StringKey> = {
    hr:         'app.module.hr.title',
    dms:        'app.module.dms.title',
    crm:        'app.module.crm.title',
    escrow:     'app.module.escrow.title',
    dsb:        'app.module.dsb.title',
    accounting: 'app.module.accounting.title',
    picker:     'app.module.switcher.firm',
  }

  return (
    <aside
      className="w-64 shrink-0 min-h-screen bg-white border-e border-slate-200 flex flex-col"
      aria-label="Primary"
    >
      {/* Brand + module switcher */}
      <div className="px-5 py-5 border-b border-slate-200 space-y-3">
        <Link href="/app" className="flex items-center gap-2 group" aria-label={t('app.module.switcher.back')}>
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-slate-900 text-white font-black text-sm">
            F
          </span>
          <span className="font-bold text-slate-900 group-hover:text-slate-700">
            {t('app.module.switcher.firm')}
          </span>
        </Link>
        {currentModule !== 'picker' && (
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200">
              {t(moduleLabel[currentModule])}
            </span>
            <Link
              href="/app"
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"
              title={t('app.module.switcher.back')}
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="sr-only">{t('app.module.switcher.back')}</span>
            </Link>
          </div>
        )}
      </div>

      {showModuleNav ? (
        <nav className="flex-1 px-3 py-4 space-y-1">
          {items.map((item) => {
            const active = isActive(pathname, item.href)
            const Icon = item.icon
            const count = item.countKey ? counts[item.countKey] : undefined
            const urgentCount = item.countKey === 'certs' || item.countKey === 'costs'
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
                  <span
                    className={`inline-flex items-center justify-center min-w-[1.25rem] px-2 py-0.5 rounded-full text-xs font-semibold ${
                      urgentCount
                        ? 'bg-red-50 text-red-700'
                        : 'bg-gray-100 text-slate-700'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>
      ) : (
        <div className="flex-1 px-5 py-6 text-xs text-slate-500 leading-relaxed">
          {/* Sidebar nav is module-scoped. On the picker page (/app) and on
              preview module pages we keep the rail clean. */}
        </div>
      )}

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
