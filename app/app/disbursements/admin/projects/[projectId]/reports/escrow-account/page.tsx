/**
 * حساب الضمان — Escrow Account Report (per project)
 *
 * Two-column ledger view of the project's escrow account(s):
 *   IN  = dsb_payments (collections)
 *   OUT = dsb_cases    (disbursements: signed / delivered / historical)
 *
 * The two streams are merged chronologically into a single ledger with a
 * running balance column so you can eyeball the account state at any date.
 *
 * Scoping:
 *   - Account dropdown at the top (query param ?account=). If a specific
 *     dsb_project_accounts row is picked, IN filters to
 *     dsb_payments.account_id and OUT filters to dsb_cases.paid_from_account_id.
 *   - Default "كل الحسابات" aggregates everything in the project regardless
 *     of account_id.
 *
 * Cases only count as OUT once they're in a paid state — we treat
 * status ∈ {'signed', 'delivered'} OR is_historical=true as OUT. A case
 * still sitting with_employee/supervisor/owner hasn't left the account.
 */
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ArrowRight, Wallet, TrendingUp, TrendingDown, Scale } from 'lucide-react'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtSar(v: number | null | undefined): string {
  if (v == null) return '—'
  try {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR',
      maximumFractionDigits: 0,
    }).format(v)
  } catch {
    return `${v} ر.س`
  }
}
function fmtSignedSar(v: number, sign: 'in' | 'out'): string {
  const abs = Math.abs(v)
  const s = fmtSar(abs)
  return sign === 'in' ? `+${s}` : `-${s}`
}
function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(s + 'T00:00:00'))
  } catch {
    return s
  }
}

// ---------------------------------------------------------------------------
// Ledger row (merged type)
// ---------------------------------------------------------------------------
type LedgerRow = {
  kind: 'in' | 'out'
  date: string           // YYYY-MM-DD, for sort + display
  amount: number
  reference: string | null
  counterparty: string | null
  note: string | null
  linkHref: string | null
  accountLabel: string | null
}

type AccountLite = {
  id: string
  label: string
  bank_name: string | null
  account_number: string | null
  // Migration 063: role tag drives the buyer-deposit 76/20/4 derivation.
  //   'general'         → holds non-buyer categories (wrong_transfer, self_financing, …)
  //   'construction'    → derived 76% share of buyer_collection
  //   'admin_marketing' → derived 20% share
  //   'escrow'          → derived  4% share
  account_role: 'general' | 'construction' | 'admin_marketing' | 'escrow' | null
}

// Share each derived sub-account gets of the buyer_collection total. Mirrors
// the KPI strip on سجل الدفعات (see admin/lists/payments/page.tsx).
const ROLE_SHARE: Record<'construction' | 'admin_marketing' | 'escrow', number> = {
  construction:    0.76,
  admin_marketing: 0.20,
  escrow:          0.04,
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default async function EscrowAccountReportPage({
  params,
  searchParams,
}: {
  params: { projectId: string }
  searchParams?: { account?: string; from?: string; to?: string }
}) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) redirect('/login')

  const dsbRole = (profile.dsb_role as string | null) ?? null
  if (!dsbRole || !['employee', 'supervisor', 'owner', 'viewer'].includes(dsbRole)) {
    redirect('/app/disbursements')
  }

  const tenantId = profile.tenant_id as string
  const projectId = params.projectId

  // Project guard.
  const { data: projectData } = await svc
    .from('dsb_projects')
    .select('id, tenant_id, code, name_ar')
    .eq('id', projectId)
    .maybeSingle()
  if (!projectData || (projectData as { tenant_id: string }).tenant_id !== tenantId) {
    notFound()
  }
  const project = projectData as { id: string; code: string; name_ar: string }

  // ---------- Account picker options ----------
  const { data: acctData } = await svc
    .from('dsb_project_accounts')
    .select('id, label, bank_name, account_number, account_role')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .order('label', { ascending: true })
  const accounts = (acctData ?? []) as AccountLite[]

  // Filters from URL.
  const selectedAccountId = (searchParams?.account ?? '').trim() || null
  const fFrom = (searchParams?.from ?? '').trim() || null
  const fTo = (searchParams?.to ?? '').trim() || null
  const selectedAccount = selectedAccountId
    ? accounts.find((a) => a.id === selectedAccountId) ?? null
    : null

  // ---------- IN: payments ----------
  // Chunk-loop the fetch — Supabase-hosted PostgREST enforces max_rows=1000
  // per request, and a project easily has >1k payments (the escrow report
  // used to silently truncate to 1000 → totals off by ~950 rows).
  //
  // We DON'T filter by account_id at fetch time anymore. The 76/20/4
  // derivation (below) needs the full buyer_collection set for the whole
  // project regardless of which account the user picked — because buyer
  // deposits physically all land on الحساب العام, and the sub-account
  // views are computed shares of that pool.
  const CHUNK = 1000
  const CHUNK_HARD_LIMIT = 100
  type PayRow = {
    id: string
    account_id: string | null
    // Migration 064: sale_id is the preferred link (contract). We fetch it so
    // we can resolve الطرف الآخر (counterparty name) via sale.buyer_name_ar
    // when the payment's beneficiary_name is null — same fallback the payments
    // list uses, so what shows in one place shows here too.
    sale_id: string | null
    payment_date: string
    amount_sar: number
    beneficiary_name: string | null
    reference_number: string | null
    description: string | null
    deposit_category: string | null
  }
  const allPayments: PayRow[] = []
  for (let page = 0; page < CHUNK_HARD_LIMIT; page++) {
    let payQuery = svc
      .from('dsb_payments')
      .select('id, account_id, sale_id, payment_date, amount_sar, beneficiary_name, reference_number, description, deposit_category')
      .eq('tenant_id', tenantId)
      .eq('project_id', projectId)
    if (fFrom) payQuery = payQuery.gte('payment_date', fFrom)
    if (fTo) payQuery = payQuery.lte('payment_date', fTo)
    payQuery = payQuery.range(page * CHUNK, page * CHUNK + CHUNK - 1)
    const { data: pageData } = await payQuery
    const rows = (pageData ?? []) as PayRow[]
    allPayments.push(...rows)
    if (rows.length < CHUNK) break
  }

  // Resolve buyer names from linked sales in bulk (only for payments where
  // beneficiary_name is blank) so we can fall back gracefully.
  const orphanSaleIds = Array.from(
    new Set(
      allPayments
        .filter((p) => !p.beneficiary_name && p.sale_id)
        .map((p) => p.sale_id!),
    ),
  )
  const buyerNameBySaleId = new Map<string, string | null>()
  if (orphanSaleIds.length > 0) {
    const SALE_CHUNK = 300
    for (let i = 0; i < orphanSaleIds.length; i += SALE_CHUNK) {
      const slice = orphanSaleIds.slice(i, i + SALE_CHUNK)
      const { data: saleRows } = await svc
        .from('dsb_unit_sales')
        .select('id, buyer_name_ar')
        .eq('tenant_id', tenantId)
        .in('id', slice)
      for (const s of ((saleRows ?? []) as Array<{ id: string; buyer_name_ar: string | null }>)) {
        buyerNameBySaleId.set(s.id, s.buyer_name_ar)
      }
    }
  }

  // Apply the derivation model based on the selected account's role:
  //   - null (all accounts): every payment shows raw, sums to the project total
  //   - construction / admin_marketing / escrow: only buyer_collection rows,
  //     each with amount × its role's percentage share
  //   - general: only non-buyer categories (buyer deposits are treated as
  //     "already flowed out" to the three sub-accounts via the derivation)
  //   - any account that isn't role-tagged: same behavior as before (filter
  //     literally by account_id) — a safety valve for tenants that haven't
  //     tagged their accounts yet.
  const selectedRole = selectedAccount?.account_role ?? null
  let payments: Array<PayRow & { display_amount: number }>
  if (!selectedAccountId) {
    payments = allPayments.map((p) => ({ ...p, display_amount: Number(p.amount_sar || 0) }))
  } else if (selectedRole === 'construction' || selectedRole === 'admin_marketing' || selectedRole === 'escrow') {
    const pct = ROLE_SHARE[selectedRole]
    payments = allPayments
      .filter((p) => p.deposit_category === 'buyer_collection')
      .map((p) => ({ ...p, display_amount: Number(p.amount_sar || 0) * pct }))
  } else if (selectedRole === 'general') {
    payments = allPayments
      .filter((p) => p.deposit_category !== 'buyer_collection')
      .map((p) => ({ ...p, display_amount: Number(p.amount_sar || 0) }))
  } else {
    // Untagged account: fall back to the literal account_id match.
    payments = allPayments
      .filter((p) => p.account_id === selectedAccountId)
      .map((p) => ({ ...p, display_amount: Number(p.amount_sar || 0) }))
  }

  // ---------- OUT: cases (signed/delivered OR historical) ----------
  // The "spent" moment is:
  //   * paid_at if set (owner explicitly recorded the payment date on the case)
  //   * else signed_at (when the case became payable)
  //   * else voucher_date (historical rows may only have this)
  //   * else submitted_at as a last resort
  //
  // A case only appears if it's in a state where money has actually left the
  // escrow. Cases sitting in review/rejection stages don't count.
  let caseQuery = svc
    .from('dsb_cases')
    .select('id, case_number, voucher_number_text, amount_sar, status, is_historical, paid_from_account_id, paid_at, signed_at, voucher_date, submitted_at, extracted_fields')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .or('status.in.(signed,delivered),is_historical.eq.true')
  if (selectedAccountId) caseQuery = caseQuery.eq('paid_from_account_id', selectedAccountId)
  const { data: casesData } = await caseQuery
  const cases = (casesData ?? []) as Array<{
    id: string
    case_number: string
    voucher_number_text: string | null
    amount_sar: number | null
    status: string
    is_historical: boolean | null
    paid_from_account_id: string | null
    paid_at: string | null
    signed_at: string | null
    voucher_date: string | null
    submitted_at: string | null
    extracted_fields: Record<string, unknown> | null
  }>

  // Account labels for the ledger's "counterparty/account" column.
  const acctLabelById = new Map<string, string>()
  for (const a of accounts) acctLabelById.set(a.id, a.label)

  // ---------- Merge streams into a single ledger ----------
  const ledger: LedgerRow[] = []
  for (const p of payments) {
    // Counterparty falls back to the linked sale's buyer_name_ar — matches
    // the payments-list display, since importers usually leave
    // beneficiary_name blank when the contract link already carries the name.
    const buyerFallback = p.sale_id ? (buyerNameBySaleId.get(p.sale_id) ?? null) : null
    ledger.push({
      kind: 'in',
      date: p.payment_date,
      // display_amount already has the role's derivation applied (raw amount
      // for «كل الحسابات» / general, × pct for the three sub-accounts).
      amount: p.display_amount,
      reference: p.reference_number,
      counterparty: p.beneficiary_name ?? buyerFallback,
      note: p.description,
      linkHref: null,
      accountLabel: p.account_id ? acctLabelById.get(p.account_id) ?? null : null,
    })
  }
  for (const c of cases) {
    // Pick the best available date for the OUT event.
    const eventDate =
      (c.paid_at as string | null) ||
      (c.signed_at ? c.signed_at.slice(0, 10) : null) ||
      c.voucher_date ||
      (c.submitted_at ? c.submitted_at.slice(0, 10) : null)
    if (!eventDate) continue
    // Apply date-range filter after resolution (payments already filtered
    // above, but cases use derived dates).
    if (fFrom && eventDate < fFrom) continue
    if (fTo && eventDate > fTo) continue
    const beneficiary =
      (c.extracted_fields as { beneficiary_name_ar?: string } | null)?.beneficiary_name_ar ?? null
    ledger.push({
      kind: 'out',
      date: eventDate,
      amount: Number(c.amount_sar || 0),
      reference: c.voucher_number_text || c.case_number,
      counterparty: beneficiary,
      note: c.is_historical ? 'صرف تاريخي' : null,
      linkHref: `/app/disbursements/${c.id}`,
      accountLabel: c.paid_from_account_id
        ? acctLabelById.get(c.paid_from_account_id) ?? null
        : null,
    })
  }

  // Sort chronologically, then compute running balance.
  ledger.sort((a, b) => a.date.localeCompare(b.date))
  let running = 0
  const rowsWithBalance = ledger.map((r) => {
    running += r.kind === 'in' ? r.amount : -r.amount
    return { ...r, balance: running }
  })

  // Totals.
  const totalIn = ledger.filter((r) => r.kind === 'in').reduce((s, r) => s + r.amount, 0)
  const totalOut = ledger.filter((r) => r.kind === 'out').reduce((s, r) => s + r.amount, 0)
  const netBalance = totalIn - totalOut

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      {/* Breadcrumb */}
      <Link
        href={`/app/disbursements/admin/projects/${projectId}`}
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        العودة إلى المشروع
      </Link>

      {/* Header */}
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <Scale className="w-4 h-4" aria-hidden="true" />
          حساب الضمان
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            {project.name_ar}
          </h1>
          <span className="font-mono text-sm text-slate-500">{project.code}</span>
        </div>
        <p className="text-sm text-slate-600">
          سجل حركة حساب الضمان: التحصيل داخل والصرف خارج مرتَّبة زمنيًا مع الرصيد الجاري.
        </p>
      </header>

      {/* Filters bar */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <form className="flex flex-wrap items-end gap-3" method="GET">
          <div className="flex-1 min-w-[180px]">
            <label className="text-[11px] font-semibold text-slate-500 mb-1 block">الحساب</label>
            <select
              name="account"
              defaultValue={selectedAccountId ?? ''}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="">— كل الحسابات —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                  {a.bank_name ? ` (${a.bank_name})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 mb-1 block">من تاريخ</label>
            <input
              type="date"
              name="from"
              defaultValue={fFrom ?? ''}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              dir="ltr"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 mb-1 block">إلى تاريخ</label>
            <input
              type="date"
              name="to"
              defaultValue={fTo ?? ''}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              dir="ltr"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 text-sm font-semibold"
          >
            تطبيق
          </button>
          {(selectedAccountId || fFrom || fTo) && (
            <Link
              href={`/app/disbursements/admin/projects/${projectId}/reports/escrow-account`}
              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-2"
            >
              مسح المرشِّحات
            </Link>
          )}
        </form>
        {selectedAccount && (
          <div className="mt-3 text-xs text-slate-600 border-t border-slate-100 pt-3">
            <span className="text-slate-500">تفاصيل الحساب: </span>
            <span className="font-semibold text-slate-800">{selectedAccount.label}</span>
            {selectedAccount.bank_name && (
              <span className="text-slate-500 mx-2">·</span>
            )}
            {selectedAccount.bank_name && <span>{selectedAccount.bank_name}</span>}
            {selectedAccount.account_number && (
              <>
                <span className="text-slate-500 mx-2">·</span>
                <span className="font-mono" dir="ltr">{selectedAccount.account_number}</span>
              </>
            )}
          </div>
        )}
      </section>

      {/* Scorecards */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Scorecard
          label="إجمالي التحصيل (داخل)"
          value={fmtSar(totalIn)}
          icon={<TrendingUp className="w-4 h-4" />}
          tint="emerald"
        />
        <Scorecard
          label="إجمالي الصرف (خارج)"
          value={fmtSar(totalOut)}
          icon={<TrendingDown className="w-4 h-4" />}
          tint="amber"
        />
        <Scorecard
          label="الرصيد الصافي"
          value={fmtSar(netBalance)}
          icon={<Wallet className="w-4 h-4" />}
          tint={netBalance >= 0 ? 'emerald' : 'red'}
        />
      </section>

      {/* Ledger table */}
      {rowsWithBalance.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500 shadow-sm">
          لا توجد حركات مطابقة للمرشِّحات الحالية.
        </div>
      ) : (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-right">
                  <Th>التاريخ</Th>
                  <Th>النوع</Th>
                  <Th>المرجع</Th>
                  <Th>الطرف الآخر</Th>
                  <Th>الحساب</Th>
                  <Th className="text-left">داخل</Th>
                  <Th className="text-left">خارج</Th>
                  <Th className="text-left">الرصيد</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rowsWithBalance.map((r, i) => (
                  <tr key={i} className={r.kind === 'in' ? 'hover:bg-emerald-50/30' : 'hover:bg-amber-50/30'}>
                    <Td>{fmtDate(r.date)}</Td>
                    <Td>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ring-1 ring-inset ${
                          r.kind === 'in'
                            ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                            : 'bg-amber-50 text-amber-800 ring-amber-200'
                        }`}
                      >
                        {r.kind === 'in' ? 'تحصيل' : 'صرف'}
                      </span>
                    </Td>
                    <Td>
                      {r.linkHref ? (
                        <Link
                          href={r.linkHref}
                          className="font-mono text-xs font-semibold text-teal-700 hover:text-teal-900"
                        >
                          {r.reference ?? '—'}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs">{r.reference ?? '—'}</span>
                      )}
                      {r.note && (
                        <div className="text-[10px] text-slate-500 mt-0.5">{r.note}</div>
                      )}
                    </Td>
                    <Td>{r.counterparty ?? '—'}</Td>
                    <Td>
                      <span className="text-[11px] text-slate-600">
                        {r.accountLabel ?? '—'}
                      </span>
                    </Td>
                    <Td>
                      {r.kind === 'in' ? (
                        <span className="font-mono font-semibold text-emerald-700 text-left block" dir="ltr">
                          {fmtSignedSar(r.amount, 'in')}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-left block">—</span>
                      )}
                    </Td>
                    <Td>
                      {r.kind === 'out' ? (
                        <span className="font-mono font-semibold text-amber-700 text-left block" dir="ltr">
                          {fmtSignedSar(r.amount, 'out')}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-left block">—</span>
                      )}
                    </Td>
                    <Td>
                      <span
                        className={`font-mono font-bold text-left block ${
                          r.balance < 0 ? 'text-red-700' : 'text-slate-900'
                        }`}
                        dir="ltr"
                      >
                        {fmtSar(r.balance)}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------
function Th({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <th
      className={`px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  )
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2.5 text-sm text-slate-700 align-top">{children}</td>
}

function Scorecard({
  label,
  value,
  icon,
  tint,
}: {
  label: string
  value: string
  icon: React.ReactNode
  tint: 'emerald' | 'amber' | 'red'
}) {
  const cls = {
    emerald: 'border-emerald-200 bg-emerald-50/40',
    amber: 'border-amber-200 bg-amber-50/40',
    red: 'border-red-200 bg-red-50/40',
  }[tint]
  const iconCls = {
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
  }[tint]
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="flex items-center gap-1.5">
        <span className={iconCls}>{icon}</span>
        <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      </div>
      <div className="text-xl font-black text-slate-900 mt-1 font-mono" dir="ltr">
        {value}
      </div>
    </div>
  )
}
