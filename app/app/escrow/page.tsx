import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import { Landmark, ArrowRight, ScrollText, Building2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type ProjectRow = {
  id: string
  code: string
  name_en: string
  name_ar: string | null
  status: string
  developer: { name_en: string; name_ar: string | null } | { name_en: string; name_ar: string | null }[] | null
}

type AccountRow = {
  project_id: string
  account_type: 'construction' | 'non_construction' | 'preservation'
  current_balance_sar: number | null
}

type VoucherInboxRow = {
  id: string
  voucher_number: string
  voucher_date: string
  total_sar: number
  status: string
  project: { id: string; code: string; name_en: string } | { id: string; code: string; name_en: string }[] | null
}

function fmtSar(amount: number, locale: Locale, compact = false): string {
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      style: 'currency',
      currency: 'SAR',
      maximumFractionDigits: 0,
      notation: compact ? 'compact' : 'standard',
    }).format(amount)
  } catch {
    return `${amount.toLocaleString()} SAR`
  }
}

function fmtDate(s: string, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      day: 'numeric', month: 'short', year: 'numeric',
    }).format(new Date(s))
  } catch {
    return s
  }
}

function single<T>(maybe: T | T[] | null | undefined): T | null {
  if (!maybe) return null
  return Array.isArray(maybe) ? (maybe[0] ?? null) : maybe
}

export default async function EscrowHomePage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id, locale, full_name')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) redirect('/login')

  const tenantId = profile.tenant_id as string
  const locale = ((profile.locale as Locale) ?? 'ar')

  const [projectsRes, accountsRes, inboxRes, suppliersRes] = await Promise.all([
    svc
      .from('escrow_projects')
      .select(`id, code, name_en, name_ar, status,
               developer:escrow_developers!escrow_projects_developer_id_fkey(name_en, name_ar)`)
      .eq('tenant_id', tenantId)
      .order('code'),
    svc
      .from('escrow_accounts')
      .select('project_id, account_type, current_balance_sar')
      .eq('tenant_id', tenantId),
    svc
      .from('escrow_vouchers')
      .select(`id, voucher_number, voucher_date, total_sar, status,
               project:escrow_projects!escrow_vouchers_project_id_fkey(id, code, name_en)`)
      .eq('tenant_id', tenantId)
      .in('status', ['uploaded', 'agent_running', 'needs_review'])
      .order('voucher_date', { ascending: false })
      .limit(8),
    svc
      .from('escrow_suppliers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'approved'),
  ])

  const projects = (projectsRes.data ?? []) as ProjectRow[]
  const accounts = (accountsRes.data ?? []) as AccountRow[]
  const inbox = (inboxRes.data ?? []) as VoucherInboxRow[]
  const suppliersCount = suppliersRes.count ?? 0

  // Per-project balance lookup
  const balanceByProject = new Map<string, { c: number; n: number; p: number; total: number }>()
  for (const a of accounts) {
    const cur = balanceByProject.get(a.project_id) ?? { c: 0, n: 0, p: 0, total: 0 }
    const v = Number(a.current_balance_sar ?? 0)
    if (a.account_type === 'construction')          cur.c += v
    else if (a.account_type === 'non_construction') cur.n += v
    else if (a.account_type === 'preservation')     cur.p += v
    cur.total += v
    balanceByProject.set(a.project_id, cur)
  }

  const totalBalance = accounts.reduce((s, a) => s + Number(a.current_balance_sar ?? 0), 0)
  const activeProjects = projects.filter((p) => p.status === 'active').length
  const pendingVouchers = inbox.length

  const statusPill = (status: string) => {
    if (status === 'needs_review') {
      return { cls: 'bg-amber-50 text-amber-700 ring-amber-200', label: locale === 'ar' ? 'يحتاج مراجعة' : 'Needs review' }
    }
    if (status === 'agent_running') {
      return { cls: 'bg-blue-50 text-blue-700 ring-blue-200', label: locale === 'ar' ? 'قيد التدقيق' : 'Auditing' }
    }
    return { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: locale === 'ar' ? 'مرفوع' : 'Uploaded' }
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
            <Landmark className="w-4 h-4" aria-hidden="true" />
            {tServer('app.module.escrow.title', locale)}
          </div>
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            {tServer('escrow.home.title', locale)}
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl">
            {tServer('escrow.home.subtitle', locale)}
          </p>
        </div>
        <Link
          href="/app/escrow/projects/new"
          className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition"
        >
          {tServer('escrow.home.add_project', locale)}
        </Link>
      </header>

      {/* KPI strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label={tServer('escrow.home.stat.total_balance', locale)} value={fmtSar(totalBalance, locale, true)} />
        <KpiCard label={tServer('escrow.home.stat.pending', locale)} value={String(pendingVouchers)} tone={pendingVouchers > 0 ? 'amber' : 'default'} />
        <KpiCard label={tServer('escrow.home.stat.projects', locale)} value={String(activeProjects)} />
        <KpiCard label={tServer('escrow.home.stat.suppliers', locale)} value={String(suppliersCount)} />
      </section>

      {/* Projects grid */}
      <section className="space-y-4">
        <h2 className="serif font-bold text-xl text-slate-900">
          {tServer('escrow.home.projects_heading', locale)}
        </h2>

        {projects.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-slate-500">
            {tServer('app.module.escrow.empty', locale)}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map((p) => {
              const dev = single(p.developer)
              const bal = balanceByProject.get(p.id) ?? { c: 0, n: 0, p: 0, total: 0 }
              const devName = locale === 'ar' ? (dev?.name_ar ?? dev?.name_en ?? '—') : (dev?.name_en ?? '—')
              const projName = locale === 'ar' ? (p.name_ar ?? p.name_en) : p.name_en
              return (
                <Link
                  key={p.id}
                  href={`/app/escrow/${p.id}`}
                  className="group block bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-teal-300 transition"
                >
                  <div className="flex items-start justify-between mb-3 gap-2">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-teal-50 shrink-0">
                      <Building2 className="w-5 h-5 text-teal-600" aria-hidden="true" />
                    </div>
                    <span className="text-xs font-mono text-slate-500">{p.code}</span>
                  </div>
                  <h3 className="font-bold text-base text-slate-900 mb-1 leading-snug">
                    {projName}
                  </h3>
                  <div className="text-xs text-slate-500 mb-4 truncate">
                    {tServer('escrow.project.developer_label', locale)}: {devName}
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <BalRow label={tServer('escrow.project.balance.construction', locale)}     value={fmtSar(bal.c, locale, true)} accent="teal" />
                    <BalRow label={tServer('escrow.project.balance.non_construction', locale)} value={fmtSar(bal.n, locale, true)} accent="indigo" />
                    <BalRow label={tServer('escrow.project.balance.preservation', locale)}     value={fmtSar(bal.p, locale, true)} accent="amber" />
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">{fmtSar(bal.total, locale, true)}</span>
                    <span className="inline-flex items-center gap-1 text-teal-600 group-hover:text-teal-700 font-semibold">
                      {locale === 'ar' ? 'فتح المشروع' : 'Open project'}
                      <ArrowRight className="w-3.5 h-3.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Vouchers inbox — what needs your attention */}
      <section className="space-y-4">
        <h2 className="serif font-bold text-xl text-slate-900 inline-flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-slate-500" aria-hidden="true" />
          {tServer('escrow.home.inbox_heading', locale)}
        </h2>

        {inbox.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-xl p-6 text-center text-sm text-slate-500">
            {tServer('escrow.home.inbox_empty', locale)}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
            {inbox.map((v) => {
              const proj = single(v.project)
              const pill = statusPill(v.status)
              return (
                <Link
                  key={v.id}
                  href={`/app/escrow/${proj?.id}/vouchers/${v.id}`}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-xs text-slate-500">{v.voucher_number}</span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs text-slate-500 truncate">{proj?.code} — {proj?.name_en}</span>
                    </div>
                    <div className="text-sm font-semibold text-slate-900">
                      {fmtSar(Number(v.total_sar), locale)}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 hidden sm:block">{fmtDate(v.voucher_date, locale)}</div>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset ${pill.cls}`}>
                    {pill.label}
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function KpiCard({
  label, value, tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'amber'
}) {
  const tones = {
    default: 'bg-white border-slate-200',
    amber: 'bg-amber-50 border-amber-200',
  }
  return (
    <div className={`border rounded-xl p-4 ${tones[tone]}`}>
      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-1">{label}</div>
      <div className="text-2xl font-bold text-slate-900 truncate">{value}</div>
    </div>
  )
}

function BalRow({ label, value, accent }: { label: string; value: string; accent: 'teal' | 'indigo' | 'amber' }) {
  const dot = {
    teal:   'bg-teal-500',
    indigo: 'bg-indigo-500',
    amber:  'bg-amber-500',
  }[accent]
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 text-slate-600 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
      <span className="font-mono font-semibold text-slate-900 shrink-0">{value}</span>
    </div>
  )
}
