import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import {
  ShoppingBag, FileText, Users, ShieldCheck, Banknote, ClipboardCheck,
  ArrowRight, Plus, ScrollText, Building2,
} from 'lucide-react'
import { ShareUploadLinkButton } from './ShareUploadLinkButton'

export const dynamic = 'force-dynamic'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type ProjectRow = {
  id: string
  code: string
  name_en: string
  name_ar: string | null
  description: string | null
  location_en: string | null
  location_ar: string | null
  status: string
  total_budget_sar: number | null
  developer: { id: string; name_en: string; name_ar: string | null } | { id: string; name_en: string; name_ar: string | null }[] | null
}

type VoucherRow = {
  id: string
  voucher_number: string
  voucher_date: string
  total_sar: number
  status: string
  beneficiary: { name_en: string; name_ar: string | null } | { name_en: string; name_ar: string | null }[] | null
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

export default async function EscrowProjectPage({
  params,
}: {
  params: { projectId: string }
}) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id, locale')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) redirect('/login')

  const tenantId = profile.tenant_id as string
  const locale = ((profile.locale as Locale) ?? 'ar')

  const [projectRes, accountsRes, vouchersRes, countsRes] = await Promise.all([
    svc
      .from('escrow_projects')
      .select(`id, code, name_en, name_ar, description, location_en, location_ar, status, total_budget_sar,
               developer:escrow_developers!escrow_projects_developer_id_fkey(id, name_en, name_ar)`)
      .eq('tenant_id', tenantId)
      .eq('id', params.projectId)
      .maybeSingle(),
    svc
      .from('escrow_accounts')
      .select('id, account_type, current_balance_sar, iban, bank_name')
      .eq('tenant_id', tenantId)
      .eq('project_id', params.projectId),
    svc
      .from('escrow_vouchers')
      .select(`id, voucher_number, voucher_date, total_sar, status,
               beneficiary:escrow_suppliers!escrow_vouchers_beneficiary_supplier_id_fkey(name_en, name_ar)`)
      .eq('tenant_id', tenantId)
      .eq('project_id', params.projectId)
      .order('voucher_date', { ascending: false })
      .limit(15),
    Promise.all([
      svc.from('escrow_contracts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('project_id', params.projectId),
      svc.from('escrow_buyers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('project_id', params.projectId),
      svc.from('escrow_suppliers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      svc.from('escrow_completion_certificates').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('project_id', params.projectId),
    ]),
  ])

  const project = projectRes.data as ProjectRow | null
  if (!project) notFound()

  const accounts = accountsRes.data ?? []
  const vouchers = (vouchersRes.data ?? []) as VoucherRow[]
  const [contractsRes, buyersRes, suppliersRes, certsRes] = countsRes
  const contractsCount = contractsRes.count ?? 0
  const buyersCount    = buyersRes.count ?? 0
  const suppliersCount = suppliersRes.count ?? 0
  const certsCount     = certsRes.count ?? 0

  const dev = single(project.developer)
  const projName = locale === 'ar' ? (project.name_ar ?? project.name_en) : project.name_en
  const devName  = locale === 'ar' ? (dev?.name_ar ?? dev?.name_en ?? '—') : (dev?.name_en ?? '—')
  const projLoc  = locale === 'ar' ? (project.location_ar ?? project.location_en) : project.location_en

  const balC = Number(accounts.find((a) => a.account_type === 'construction')?.current_balance_sar ?? 0)
  const balN = Number(accounts.find((a) => a.account_type === 'non_construction')?.current_balance_sar ?? 0)
  const balP = Number(accounts.find((a) => a.account_type === 'preservation')?.current_balance_sar ?? 0)
  const balTotal = balC + balN + balP

  const statusPill = (status: string) => {
    switch (status) {
      case 'approved':     return { cls: 'bg-green-50 text-green-700 ring-green-200',   label: locale === 'ar' ? 'معتمد'         : 'Approved' }
      case 'rejected':     return { cls: 'bg-red-50 text-red-700 ring-red-200',         label: locale === 'ar' ? 'مرفوض'         : 'Rejected' }
      case 'paid':         return { cls: 'bg-slate-100 text-slate-700 ring-slate-200',  label: locale === 'ar' ? 'مدفوع'         : 'Paid' }
      case 'needs_review': return { cls: 'bg-amber-50 text-amber-700 ring-amber-200',   label: locale === 'ar' ? 'يحتاج مراجعة'  : 'Needs review' }
      case 'agent_running':return { cls: 'bg-blue-50 text-blue-700 ring-blue-200',      label: locale === 'ar' ? 'قيد التدقيق'  : 'Auditing' }
      case 'uploaded':     return { cls: 'bg-slate-100 text-slate-700 ring-slate-200',  label: locale === 'ar' ? 'مرفوع'         : 'Uploaded' }
      default:             return { cls: 'bg-slate-100 text-slate-700 ring-slate-200',  label: status }
    }
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <Link
        href="/app/escrow"
        className="inline-flex items-center text-sm text-slate-500 hover:text-slate-900 font-semibold"
      >
        {tServer('escrow.project.back_to_projects', locale)}
      </Link>

      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2 min-w-0">
          <div className="inline-flex items-center gap-2 text-xs font-mono text-slate-500">
            <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
            {tServer('escrow.project.code_label', locale)}: {project.code}
          </div>
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            {projName}
          </h1>
          <div className="text-sm text-slate-600 space-x-3">
            <span>
              <span className="text-slate-400">{tServer('escrow.project.developer_label', locale)}:</span>{' '}
              <span className="font-semibold text-slate-700">{devName}</span>
            </span>
            {projLoc && (
              <>
                <span className="text-slate-300">·</span>
                <span>{projLoc}</span>
              </>
            )}
            {project.total_budget_sar && (
              <>
                <span className="text-slate-300">·</span>
                <span>
                  <span className="text-slate-400">{locale === 'ar' ? 'الميزانية' : 'Budget'}:</span>{' '}
                  <span className="font-mono font-semibold text-slate-700">{fmtSar(Number(project.total_budget_sar), locale, true)}</span>
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ShareUploadLinkButton locale={locale} projectId={project.id} />
          <Link
            href={`/app/escrow/${project.id}/vouchers/new`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            {tServer('escrow.project.new_voucher', locale)}
          </Link>
        </div>
      </header>

      {/* Escrow balances */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">
          {tServer('escrow.project.section.balances', locale)}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <BalanceCard
            title={tServer('escrow.project.balance.construction', locale)}
            value={fmtSar(balC, locale)}
            pct={balTotal > 0 ? Math.round((balC / balTotal) * 100) : 0}
            iban={accounts.find((a) => a.account_type === 'construction')?.iban ?? null}
            accent="teal"
          />
          <BalanceCard
            title={tServer('escrow.project.balance.non_construction', locale)}
            value={fmtSar(balN, locale)}
            pct={balTotal > 0 ? Math.round((balN / balTotal) * 100) : 0}
            iban={accounts.find((a) => a.account_type === 'non_construction')?.iban ?? null}
            accent="indigo"
          />
          <BalanceCard
            title={tServer('escrow.project.balance.preservation', locale)}
            value={fmtSar(balP, locale)}
            pct={balTotal > 0 ? Math.round((balP / balTotal) * 100) : 0}
            iban={accounts.find((a) => a.account_type === 'preservation')?.iban ?? null}
            accent="amber"
          />
        </div>
      </section>

      {/* Master data tiles */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">
          {tServer('escrow.project.section.master', locale)}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <MasterTile href={`/app/escrow/${project.id}/suppliers`} icon={ShoppingBag} label={tServer('escrow.project.master.suppliers', locale)} count={suppliersCount} />
          <MasterTile href={`/app/escrow/${project.id}/contracts`} icon={FileText}    label={tServer('escrow.project.master.contracts', locale)} count={contractsCount} />
          <MasterTile href={`/app/escrow/${project.id}/buyers`}    icon={Users}       label={tServer('escrow.project.master.buyers', locale)}    count={buyersCount} />
          <MasterTile href={`/app/escrow/${project.id}/signers`}   icon={ShieldCheck} label={tServer('escrow.project.master.signers', locale)} />
          <MasterTile href={`/app/escrow/${project.id}/accounts`}  icon={Banknote}    label={tServer('escrow.project.master.accounts', locale)} count={accounts.length} />
          <MasterTile href={`/app/escrow/${project.id}/certs`}     icon={ClipboardCheck} label={tServer('escrow.project.master.certs', locale)} count={certsCount} />
        </div>
      </section>

      {/* Vouchers inbox for this project */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 inline-flex items-center gap-2">
          <ScrollText className="w-4 h-4" aria-hidden="true" />
          {tServer('escrow.project.section.vouchers', locale)}
        </h2>

        {vouchers.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-slate-500">
            {locale === 'ar'
              ? 'لا توجد سندات بعد. اضغط على «سند جديد» للبدء.'
              : 'No vouchers yet. Click "New voucher" to get started.'}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
            {vouchers.map((v) => {
              const ben = single(v.beneficiary)
              const benName = locale === 'ar' ? (ben?.name_ar ?? ben?.name_en ?? '—') : (ben?.name_en ?? '—')
              const pill = statusPill(v.status)
              return (
                <Link
                  key={v.id}
                  href={`/app/escrow/${project.id}/vouchers/${v.id}`}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-xs text-slate-500">{v.voucher_number}</span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs text-slate-500">{fmtDate(v.voucher_date, locale)}</span>
                    </div>
                    <div className="text-sm text-slate-900">
                      <span className="font-semibold">{fmtSar(Number(v.total_sar), locale)}</span>
                      <span className="text-slate-400 mx-1.5">→</span>
                      <span className="text-slate-700">{benName}</span>
                    </div>
                  </div>
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

function BalanceCard({
  title, value, pct, iban, accent,
}: {
  title: string
  value: string
  pct: number
  iban: string | null
  accent: 'teal' | 'indigo' | 'amber'
}) {
  const bar = {
    teal:   'bg-teal-500',
    indigo: 'bg-indigo-500',
    amber:  'bg-amber-500',
  }[accent]
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">{title}</div>
      <div className="text-2xl font-bold text-slate-900 mb-2">{value}</div>
      <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden mb-2">
        <div className={`h-full ${bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {iban && (
        <div className="text-[10px] font-mono text-slate-400 truncate" title={iban}>{iban}</div>
      )}
    </div>
  )
}

function MasterTile({
  href, icon: Icon, label, count,
}: {
  href: string
  icon: typeof ShoppingBag
  label: string
  count?: number
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col items-start gap-2 bg-white border border-slate-200 rounded-xl p-3 hover:border-teal-300 hover:shadow-sm transition"
    >
      <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-teal-50 group-hover:bg-teal-100 transition">
        <Icon className="w-4 h-4 text-teal-600" aria-hidden="true" />
      </div>
      <div className="text-xs font-semibold text-slate-700 leading-tight">{label}</div>
      {typeof count === 'number' && (
        <div className="text-xs font-mono text-slate-500">{count}</div>
      )}
    </Link>
  )
}
