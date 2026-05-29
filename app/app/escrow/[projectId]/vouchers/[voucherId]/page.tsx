import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ArrowLeft, CheckCircle2, XCircle, AlertTriangle, FileText, RefreshCw, ChevronDown,
  Info, ShieldAlert,
} from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'

export const dynamic = 'force-dynamic'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

function single<T>(maybe: T | T[] | null | undefined): T | null {
  if (!maybe) return null
  return Array.isArray(maybe) ? (maybe[0] ?? null) : maybe
}

function fmtSar(amount: number, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      style: 'currency',
      currency: 'SAR',
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount.toLocaleString()} SAR`
  }
}

function fmtDate(s: string | null | undefined, locale: Locale): string {
  if (!s) return '—'
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      day: 'numeric', month: 'short', year: 'numeric',
    }).format(new Date(s))
  } catch {
    return s
  }
}

function fmtDateTime(s: string | null | undefined, locale: Locale): string {
  if (!s) return '—'
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }).format(new Date(s))
  } catch {
    return s
  }
}

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

type VoucherRow = {
  id: string
  voucher_number: string
  voucher_date: string
  total_sar: number
  currency: string
  expense_nature: 'construction' | 'non_construction' | 'preservation' | null
  status: string
  notes: string | null
  created_at: string
  project_id: string
  beneficiary: { id: string; name_en: string; name_ar: string | null } | { id: string; name_en: string; name_ar: string | null }[] | null
  account: { id: string; account_type: string; bank_name: string | null; iban: string | null } | { id: string; account_type: string; bank_name: string | null; iban: string | null }[] | null
  signer: { id: string; name: string; title: string | null } | { id: string; name: string; title: string | null }[] | null
  project: { id: string; name_en: string; name_ar: string | null; code: string } | { id: string; name_en: string; name_ar: string | null; code: string }[] | null
}

type UploadRow = {
  id: string
  filename: string
  display_name: string | null
  declared_kind: string | null
  classified_kind: string | null
  classification_confidence: number | null
  file_size_bytes: number | null
  mime_type: string | null
  uploaded_at: string
  extracted_text: string | null
  extracted_summary: string | null
}

type AgentRunRow = {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  pass_count: number
  fail_count: number
  warn_count: number
  summary: string | null
  started_at: string | null
  completed_at: string | null
  error_message: string | null
}

type AgentCheckRow = {
  id: string
  order_index: number
  rule_code: string
  rule_title_en: string
  rule_title_ar: string | null
  severity: 'blocking' | 'warning' | 'info'
  status: 'pass' | 'fail' | 'warn' | 'needs_info' | 'skipped'
  evidence_quote: string | null
  expected_value: string | null
  actual_value: string | null
  ai_confidence: number | null
  reasoning: string | null
}

function statusPill(status: string, locale: Locale): { cls: string; label: string } {
  switch (status) {
    case 'approved':     return { cls: 'bg-green-50 text-green-700 ring-green-200',   label: locale === 'ar' ? 'معتمد'         : 'Approved' }
    case 'rejected':     return { cls: 'bg-red-50 text-red-700 ring-red-200',         label: locale === 'ar' ? 'مرفوض'         : 'Rejected' }
    case 'paid':         return { cls: 'bg-slate-100 text-slate-700 ring-slate-200',  label: locale === 'ar' ? 'مدفوع'         : 'Paid' }
    case 'needs_review': return { cls: 'bg-amber-50 text-amber-700 ring-amber-200',   label: locale === 'ar' ? 'يحتاج مراجعة'  : 'Needs review' }
    case 'agent_running':return { cls: 'bg-blue-50 text-blue-700 ring-blue-200',      label: locale === 'ar' ? 'قيد التدقيق'  : 'Auditing' }
    case 'uploaded':     return { cls: 'bg-slate-100 text-slate-700 ring-slate-200',  label: locale === 'ar' ? 'مرفوع'         : 'Uploaded' }
    case 'draft':        return { cls: 'bg-slate-100 text-slate-700 ring-slate-200',  label: locale === 'ar' ? 'مسودة'         : 'Draft' }
    case 'queued':       return { cls: 'bg-blue-50 text-blue-700 ring-blue-200',      label: locale === 'ar' ? 'في الانتظار'   : 'Queued' }
    default:             return { cls: 'bg-slate-100 text-slate-700 ring-slate-200',  label: status }
  }
}

function checkStatusPill(status: AgentCheckRow['status'], locale: Locale): { cls: string; label: string } {
  switch (status) {
    case 'pass':       return { cls: 'bg-green-50 text-green-700 ring-green-200',  label: tFn('escrow.voucher.detail.check.status.pass', locale) }
    case 'fail':       return { cls: 'bg-red-50 text-red-700 ring-red-200',        label: tFn('escrow.voucher.detail.check.status.fail', locale) }
    case 'warn':       return { cls: 'bg-amber-50 text-amber-700 ring-amber-200',  label: tFn('escrow.voucher.detail.check.status.warn', locale) }
    case 'needs_info': return { cls: 'bg-blue-50 text-blue-700 ring-blue-200',     label: tFn('escrow.voucher.detail.check.status.needs_info', locale) }
    case 'skipped':    return { cls: 'bg-slate-100 text-slate-600 ring-slate-200', label: tFn('escrow.voucher.detail.check.status.skipped', locale) }
  }
}

function severityBadge(sev: AgentCheckRow['severity'], locale: Locale): { cls: string; label: string } {
  switch (sev) {
    case 'blocking': return { cls: 'bg-red-100 text-red-800 ring-red-200',       label: tFn('escrow.voucher.detail.check.severity.blocking', locale) }
    case 'warning':  return { cls: 'bg-amber-100 text-amber-800 ring-amber-200', label: tFn('escrow.voucher.detail.check.severity.warning', locale) }
    case 'info':     return { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: tFn('escrow.voucher.detail.check.severity.info', locale) }
  }
}

function expenseLabel(nature: string | null, locale: Locale): string {
  if (!nature) return '—'
  const key = `escrow.voucher.expense.${nature}` as StringKey
  return tFn(key, locale)
}

function accountTypeLabel(type: string | null, locale: Locale): string {
  if (!type) return '—'
  const key = `escrow.voucher.expense.${type}` as StringKey
  return tFn(key, locale)
}

/**
 * Try to pretty-print extracted_text if it's JSON; otherwise return the raw string.
 */
function prettyExtracted(text: string | null): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return trimmed
  }
}

export default async function VoucherDetailPage({
  params,
  searchParams,
}: {
  params: { projectId: string; voucherId: string }
  searchParams?: { just_uploaded?: string }
}) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id, locale')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) redirect('/login')

  const tenantId = profile.tenant_id as string
  const locale = ((profile.locale as Locale) ?? 'ar')

  // ----- Load voucher (with joins) ----------------------------------------
  const voucherRes = await svc
    .from('escrow_vouchers')
    .select(`
      id, voucher_number, voucher_date, total_sar, currency, expense_nature, status, notes, created_at, project_id,
      beneficiary:escrow_suppliers!escrow_vouchers_beneficiary_supplier_id_fkey(id, name_en, name_ar),
      account:escrow_accounts!escrow_vouchers_source_escrow_account_id_fkey(id, account_type, bank_name, iban),
      signer:escrow_authorized_signers!escrow_vouchers_signed_by_authorized_signer_id_fkey(id, name, title),
      project:escrow_projects!escrow_vouchers_project_id_fkey(id, name_en, name_ar, code)
    `)
    .eq('tenant_id', tenantId)
    .eq('id', params.voucherId)
    .eq('project_id', params.projectId)
    .maybeSingle()
  const voucher = (voucherRes.data ?? null) as unknown as VoucherRow | null
  if (!voucher) notFound()

  // ----- Load uploads + latest agent run ----------------------------------
  const [uploadsRes, agentRunRes] = await Promise.all([
    svc
      .from('escrow_voucher_uploads')
      .select(
        'id, filename, display_name, declared_kind, classified_kind, classification_confidence, file_size_bytes, mime_type, uploaded_at, extracted_text, extracted_summary',
      )
      .eq('tenant_id', tenantId)
      .eq('voucher_id', voucher.id)
      .order('uploaded_at', { ascending: true }),
    svc
      .from('escrow_voucher_agent_runs')
      .select('id, status, pass_count, fail_count, warn_count, summary, started_at, completed_at, error_message')
      .eq('tenant_id', tenantId)
      .eq('voucher_id', voucher.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const uploads = ((uploadsRes.data ?? []) as UploadRow[])
  const agentRun = (agentRunRes.data ?? null) as AgentRunRow | null

  // ----- Load checks for the latest run, if any ---------------------------
  let checks: AgentCheckRow[] = []
  if (agentRun) {
    const checksRes = await svc
      .from('escrow_voucher_agent_checks')
      .select(
        'id, order_index, rule_code, rule_title_en, rule_title_ar, severity, status, evidence_quote, expected_value, actual_value, ai_confidence, reasoning',
      )
      .eq('tenant_id', tenantId)
      .eq('agent_run_id', agentRun.id)
      .order('order_index', { ascending: true })
    checks = (checksRes.data ?? []) as AgentCheckRow[]
  }

  const beneficiary = single(voucher.beneficiary)
  const account = single(voucher.account)
  const signer = single(voucher.signer)
  const project = single(voucher.project)

  const projectName = project
    ? (locale === 'ar' ? (project.name_ar ?? project.name_en) : project.name_en)
    : '—'

  const beneficiaryName = beneficiary
    ? (locale === 'ar' ? (beneficiary.name_ar ?? beneficiary.name_en) : beneficiary.name_en)
    : '—'

  const pill = statusPill(voucher.status, locale)

  // ----- Derive the verdict banner ---------------------------------------
  // green = approved or all-pass; red = any blocking fail; amber = warnings / needs_info
  let verdict: 'approved' | 'rejected' | 'needs_review' | null = null
  if (agentRun && agentRun.status === 'completed') {
    const hasBlockingFail = checks.some((c) => c.severity === 'blocking' && c.status === 'fail')
    const hasWarn = checks.some((c) => c.status === 'warn' || c.status === 'needs_info')
    if (hasBlockingFail) verdict = 'rejected'
    else if (hasWarn) verdict = 'needs_review'
    else if (checks.length > 0) verdict = 'approved'
  }

  // Audit-running banner — show for queued/running run, or while voucher is in
  // those statuses (e.g., just_uploaded with no run row yet).
  const auditInProgress =
    voucher.status === 'agent_running' ||
    voucher.status === 'queued' ||
    agentRun?.status === 'queued' ||
    agentRun?.status === 'running'

  const justUploaded = searchParams?.just_uploaded === '1'
  const showNoAuditYet = !agentRun && !auditInProgress

  // Refresh URL — preserves ?just_uploaded if present so messaging stays consistent.
  const refreshHref = `/app/escrow/${voucher.project_id}/vouchers/${voucher.id}${
    justUploaded ? '?just_uploaded=1' : ''
  }`

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <Link
        href={`/app/escrow/${voucher.project_id}`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" />
        {tServer('escrow.voucher.detail.back_to_project', locale, { name: projectName })}
      </Link>

      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2 min-w-0">
          <div className="text-xs uppercase tracking-wider font-semibold text-slate-500">
            {tServer('escrow.voucher.detail.title', locale)}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="serif font-black text-2xl sm:text-3xl tracking-tight text-slate-900 font-mono">
              {voucher.voucher_number}
            </h1>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ring-inset ${pill.cls}`}>
              {pill.label}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {tServer('escrow.voucher.detail.uploaded_at', locale, { date: fmtDateTime(voucher.created_at, locale) })}
          </p>
        </div>
      </header>

      {/* Audit-in-progress banner */}
      {auditInProgress && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex items-start gap-3">
          <RefreshCw className="w-5 h-5 text-blue-700 mt-0.5 shrink-0 animate-spin" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-blue-900">
              {tServer('escrow.voucher.detail.audit_running', locale)}
            </div>
            <div className="text-xs text-blue-800/80 mt-1">
              {tServer('escrow.voucher.detail.audit_running_hint', locale)}
            </div>
          </div>
          <Link
            href={refreshHref}
            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-white border border-blue-200 text-xs font-semibold text-blue-700 hover:bg-blue-100/60"
          >
            {tServer('escrow.voucher.detail.refresh', locale)}
          </Link>
        </div>
      )}

      {/* No-audit-yet banner */}
      {showNoAuditYet && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0 text-sm text-slate-700">
            {tServer('escrow.voucher.detail.no_audit_yet', locale)}
          </div>
          <Link
            href={refreshHref}
            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            {tServer('escrow.voucher.detail.refresh', locale)}
          </Link>
        </div>
      )}

      {/* Verdict banner */}
      {verdict && (
        <VerdictBanner verdict={verdict} run={agentRun} locale={locale} />
      )}

      {/* ===== Voucher facts ============================================== */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">
          {tServer('escrow.voucher.detail.facts.heading', locale)}
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Fact
            label={tFn('escrow.voucher.field.voucher_date', locale)}
            value={fmtDate(voucher.voucher_date, locale)}
          />
          <Fact
            label={tFn('escrow.voucher.field.total_sar', locale)}
            value={
              <span className="font-mono font-semibold text-slate-900">
                {fmtSar(Number(voucher.total_sar), locale)}
              </span>
            }
          />
          <Fact
            label={tFn('escrow.voucher.field.expense_nature', locale)}
            value={expenseLabel(voucher.expense_nature, locale)}
          />
          <Fact
            label={tFn('escrow.voucher.field.beneficiary', locale)}
            value={beneficiaryName}
          />
          <Fact
            label={tFn('escrow.voucher.field.source_account', locale)}
            value={
              account ? (
                <span>
                  {accountTypeLabel(account.account_type, locale)}
                  {account.bank_name && <> · <span className="text-slate-600">{account.bank_name}</span></>}
                  {account.iban && <> · <span className="font-mono text-xs text-slate-500">{account.iban}</span></>}
                </span>
              ) : '—'
            }
          />
          <Fact
            label={tFn('escrow.voucher.field.signer', locale)}
            value={signer ? `${signer.name}${signer.title ? ` — ${signer.title}` : ''}` : '—'}
          />
          {voucher.notes && (
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">
                {tFn('escrow.voucher.field.notes', locale)}
              </dt>
              <dd className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                {voucher.notes}
              </dd>
            </div>
          )}
        </dl>
      </section>

      {/* ===== Documents ================================================= */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4 inline-flex items-center gap-2">
          <FileText className="w-4 h-4" aria-hidden="true" />
          {tServer('escrow.voucher.detail.documents.heading', locale)}
          <span className="text-xs text-slate-400 font-mono">{uploads.length}</span>
        </h2>

        {uploads.length === 0 ? (
          <p className="text-sm text-slate-500">—</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {uploads.map((u) => {
              const extracted = prettyExtracted(u.extracted_text)
              return (
                <li key={u.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <FileText className="w-4 h-4 text-slate-400 shrink-0 mt-1" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {u.display_name ?? u.filename}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono truncate">
                        {u.filename}
                      </div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px]">
                        {u.declared_kind && u.declared_kind !== 'unknown' && (
                          <KindPill label={`declared: ${u.declared_kind}`} tone="slate" />
                        )}
                        {u.classified_kind && (
                          <KindPill
                            label={`classified: ${u.classified_kind}`}
                            tone="teal"
                          />
                        )}
                        {u.classification_confidence != null && (
                          <span className="text-slate-500 font-mono">
                            {Math.round(Number(u.classification_confidence) * 100)}%
                          </span>
                        )}
                        <span className="text-slate-400 font-mono">
                          {fmtBytes(u.file_size_bytes)}
                        </span>
                      </div>
                      {u.extracted_summary && (
                        <p className="mt-2 text-sm text-slate-700 leading-relaxed">
                          {u.extracted_summary}
                        </p>
                      )}
                      {extracted && (
                        <details className="mt-2 group">
                          <summary className="cursor-pointer text-xs font-semibold text-teal-700 hover:text-teal-800 inline-flex items-center gap-1 list-none [&::-webkit-details-marker]:hidden">
                            <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
                            {locale === 'ar' ? 'عرض البيانات المستخرجة' : 'Show extracted data'}
                          </summary>
                          <pre className="mt-2 p-3 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-700 font-mono whitespace-pre-wrap break-words overflow-x-auto">
                            {extracted}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ===== Checks ==================================================== */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4 inline-flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" aria-hidden="true" />
          {tServer('escrow.voucher.detail.checks.heading', locale)}
          {checks.length > 0 && (
            <span className="text-xs text-slate-400 font-mono">{checks.length}</span>
          )}
        </h2>

        {checks.length === 0 ? (
          <p className="text-sm text-slate-500">
            {agentRun
              ? (agentRun.error_message ?? '—')
              : tServer('escrow.voucher.detail.no_audit_yet', locale)}
          </p>
        ) : (
          <ul className="space-y-3">
            {checks.map((c) => {
              const cs = checkStatusPill(c.status, locale)
              const sb = severityBadge(c.severity, locale)
              const title = locale === 'ar' && c.rule_title_ar ? c.rule_title_ar : c.rule_title_en
              return (
                <li
                  key={c.id}
                  className={`rounded-lg border p-4 ${
                    c.status === 'fail' ? 'border-red-200 bg-red-50/30' :
                    c.status === 'warn' ? 'border-amber-200 bg-amber-50/30' :
                    c.status === 'pass' ? 'border-green-200 bg-green-50/30' :
                    'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-start gap-3 flex-wrap">
                    <CheckIcon status={c.status} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-900 text-sm">{title}</h3>
                        <span className="text-[10px] font-mono text-slate-400">{c.rule_code}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${cs.cls}`}>
                          {cs.label}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ring-inset ${sb.cls}`}>
                          {sb.label}
                        </span>
                        {c.ai_confidence != null && (
                          <span className="text-[11px] font-mono text-slate-500">
                            {Math.round(Number(c.ai_confidence) * 100)}%
                          </span>
                        )}
                      </div>

                      {c.reasoning && (
                        <p className="mt-2 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                          {c.reasoning}
                        </p>
                      )}

                      {(c.expected_value || c.actual_value) && (
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          {c.expected_value && (
                            <div className="p-2 rounded-md bg-white border border-slate-200">
                              <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-0.5">
                                {tFn('escrow.voucher.detail.check.expected', locale)}
                              </div>
                              <div className="font-mono text-slate-800 break-words">
                                {c.expected_value}
                              </div>
                            </div>
                          )}
                          {c.actual_value && (
                            <div className="p-2 rounded-md bg-white border border-slate-200">
                              <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-0.5">
                                {tFn('escrow.voucher.detail.check.actual', locale)}
                              </div>
                              <div className="font-mono text-slate-800 break-words">
                                {c.actual_value}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {c.evidence_quote && (
                        <div className="mt-2">
                          <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">
                            {tFn('escrow.voucher.detail.check.evidence', locale)}
                          </div>
                          <blockquote className="border-s-2 border-slate-300 ps-3 text-sm text-slate-700 italic leading-relaxed whitespace-pre-wrap">
                            “{c.evidence_quote}”
                          </blockquote>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

/* ----------------------------------------------------------------- */
/* Presentational helpers                                             */
/* ----------------------------------------------------------------- */

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-0.5">
        {label}
      </dt>
      <dd className="text-sm text-slate-800">{value}</dd>
    </div>
  )
}

function KindPill({ label, tone }: { label: string; tone: 'slate' | 'teal' }) {
  const cls =
    tone === 'teal'
      ? 'bg-teal-50 text-teal-700 ring-teal-200'
      : 'bg-slate-100 text-slate-700 ring-slate-200'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-semibold ring-1 ring-inset ${cls}`}>
      {label}
    </span>
  )
}

function CheckIcon({ status }: { status: AgentCheckRow['status'] }) {
  if (status === 'pass') {
    return (
      <div className="w-7 h-7 rounded-full bg-green-100 text-green-700 flex items-center justify-center shrink-0">
        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
      </div>
    )
  }
  if (status === 'fail') {
    return (
      <div className="w-7 h-7 rounded-full bg-red-100 text-red-700 flex items-center justify-center shrink-0">
        <XCircle className="w-4 h-4" aria-hidden="true" />
      </div>
    )
  }
  if (status === 'warn') {
    return (
      <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
        <AlertTriangle className="w-4 h-4" aria-hidden="true" />
      </div>
    )
  }
  return (
    <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
      <Info className="w-4 h-4" aria-hidden="true" />
    </div>
  )
}

function VerdictBanner({
  verdict,
  run,
  locale,
}: {
  verdict: 'approved' | 'rejected' | 'needs_review'
  run: AgentRunRow | null
  locale: Locale
}) {
  const palette = {
    approved:     { wrap: 'border-green-200 bg-green-50',   icon: 'text-green-700',  title: 'text-green-900',  Icon: CheckCircle2 },
    rejected:     { wrap: 'border-red-200 bg-red-50',       icon: 'text-red-700',    title: 'text-red-900',    Icon: XCircle },
    needs_review: { wrap: 'border-amber-200 bg-amber-50',   icon: 'text-amber-700',  title: 'text-amber-900',  Icon: AlertTriangle },
  }[verdict]

  const titleKey: StringKey =
    verdict === 'approved'
      ? 'escrow.voucher.detail.verdict.approved'
      : verdict === 'rejected'
      ? 'escrow.voucher.detail.verdict.rejected'
      : 'escrow.voucher.detail.verdict.needs_review'

  return (
    <div className={`rounded-xl border p-4 flex items-start gap-3 ${palette.wrap}`}>
      <palette.Icon className={`w-5 h-5 mt-0.5 shrink-0 ${palette.icon}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold ${palette.title}`}>
          {tFn(titleKey, locale)}
        </div>
        {run && (
          <div className="text-xs text-slate-700/80 mt-1 flex items-center gap-3 flex-wrap">
            <span>{tFn('escrow.voucher.detail.check.status.pass', locale)}: <span className="font-mono">{run.pass_count}</span></span>
            <span>{tFn('escrow.voucher.detail.check.status.warn', locale)}: <span className="font-mono">{run.warn_count}</span></span>
            <span>{tFn('escrow.voucher.detail.check.status.fail', locale)}: <span className="font-mono">{run.fail_count}</span></span>
            {run.summary && <span className="text-slate-600">· {run.summary}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
