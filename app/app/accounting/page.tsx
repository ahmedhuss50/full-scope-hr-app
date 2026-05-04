import Link from 'next/link'
import { Calculator, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'

export const dynamic = 'force-dynamic'

/**
 * Accounting module preview — non-functional. Shows the partner what's coming.
 * Mock invoices use the same KSA client roster as the CRM preview.
 */

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type InvoiceStatus = 'paid' | 'sent' | 'overdue'

type MockInvoice = {
  code: string
  client: { en: string; ar: string }
  amountSar: number
  status: InvoiceStatus
  date: { en: string; ar: string }
}

const MOCK_INVOICES: MockInvoice[] = [
  { code: 'INV-2026-104', client: { en: 'Aramco',                       ar: 'أرامكو' },                        amountSar: 95_000, status: 'sent',    date: { en: '12 Apr 2026', ar: '12 أبريل 2026' } },
  { code: 'INV-2026-103', client: { en: 'STC',                          ar: 'شركة الاتصالات السعودية' },        amountSar: 62_000, status: 'paid',    date: { en: '8 Apr 2026',  ar: '8 أبريل 2026' } },
  { code: 'INV-2026-102', client: { en: 'Al-Faisal Holding',            ar: 'مجموعة الفيصل القابضة' },          amountSar: 48_000, status: 'overdue', date: { en: '15 Mar 2026', ar: '15 مارس 2026' } },
  { code: 'INV-2026-101', client: { en: 'Diriyah Construction',         ar: 'الدرعية للإنشاءات' },              amountSar: 36_000, status: 'paid',    date: { en: '2 Apr 2026',  ar: '2 أبريل 2026' } },
  { code: 'INV-2026-100', client: { en: 'NEOM Tech Services',           ar: 'نيوم للخدمات التقنية' },          amountSar: 27_500, status: 'sent',    date: { en: '28 Mar 2026', ar: '28 مارس 2026' } },
  { code: 'INV-2026-099', client: { en: 'Red Sea Global Hospitality',   ar: 'البحر الأحمر العالمية للضيافة' },  amountSar: 22_000, status: 'paid',    date: { en: '20 Mar 2026', ar: '20 مارس 2026' } },
]

const FEATURE_KEYS: StringKey[] = [
  'accounting.preview.feature.zatca',
  'accounting.preview.feature.multicurrency',
  'accounting.preview.feature.sync',
  'accounting.preview.feature.vat',
  'accounting.preview.feature.time2invoice',
  'accounting.preview.feature.aging',
  'accounting.preview.feature.audit_trail',
]

function fmtSar(amount: number, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      style: 'currency',
      currency: 'SAR',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${amount.toLocaleString()} SAR`
  }
}

function statusPill(status: InvoiceStatus): string {
  switch (status) {
    case 'paid':    return 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-200'
    case 'sent':    return 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
    case 'overdue': return 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200'
  }
}

function statusLabel(status: InvoiceStatus, locale: Locale): string {
  return tServer(`accounting.preview.status.${status}` as StringKey, locale)
}

export default async function AccountingPreviewPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('locale')
    .eq('email', user.email!)
    .maybeSingle()

  const locale = ((profile?.locale as Locale) ?? 'ar')

  const collected = MOCK_INVOICES
    .filter((i) => i.status === 'paid')
    .reduce((s, i) => s + i.amountSar, 0)
  const overdueCount = MOCK_INVOICES.filter((i) => i.status === 'overdue').length

  return (
    <div className="space-y-10 max-w-6xl mx-auto">
      {/* Back link */}
      <Link
        href="/app"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        {tServer('accounting.preview.back', locale)}
      </Link>

      {/* Module header */}
      <header className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-amber-50">
            <Calculator className="w-6 h-6 text-amber-600" aria-hidden="true" />
          </div>
          <div className="flex items-center gap-3">
            <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
              {tServer('accounting.preview.title', locale)}
            </h1>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200">
              {tServer('preview.preview_badge', locale)}
            </span>
          </div>
        </div>
        <p className="text-base text-slate-600 max-w-2xl">
          {tServer('accounting.preview.subtitle', locale)}
        </p>
      </header>

      {/* Mock metric cards */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label={tServer('accounting.preview.metric.invoices_month', locale)}
          value="24"
        />
        <MetricCard
          label={tServer('accounting.preview.metric.collected', locale)}
          value={fmtSar(collected, locale)}
        />
        <MetricCard
          label={tServer('accounting.preview.metric.overdue', locale)}
          value={String(overdueCount)}
          tone={overdueCount > 0 ? 'red' : undefined}
        />
      </section>

      {/* Mock invoices table */}
      <section className="space-y-3">
        <h2 className="serif font-bold text-xl text-slate-900">
          {tServer('accounting.preview.invoices_table.title', locale)}
        </h2>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('accounting.preview.col.invoice', locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('accounting.preview.col.client',  locale)}</th>
                  <th className="px-4 py-3 font-semibold text-end">{tServer('accounting.preview.col.amount',  locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('accounting.preview.col.status',  locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('accounting.preview.col.date',    locale)}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {MOCK_INVOICES.map((i) => (
                  <tr key={i.code} className="hover:bg-slate-50/50 transition">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700 whitespace-nowrap">{i.code}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{i.client[locale]}</td>
                    <td className="px-4 py-3 font-mono text-end text-slate-900 whitespace-nowrap">{fmtSar(i.amountSar, locale)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusPill(i.status)}`}>
                        {statusLabel(i.status, locale)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{i.date[locale]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Feature list */}
      <section className="space-y-4">
        <h2 className="serif font-bold text-xl text-slate-900">
          {tServer('accounting.preview.feature_list_header', locale)}
        </h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {FEATURE_KEYS.map((key) => (
            <li
              key={key}
              className="flex items-start gap-3 bg-white border border-slate-200 rounded-lg p-4"
            >
              <CheckCircle2 className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="text-sm text-slate-700 leading-relaxed">
                {tServer(key, locale)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Notify-me CTA */}
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm text-amber-900">
          {tServer('accounting.preview.subtitle', locale)}
        </div>
        <button
          type="button"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          {tServer('preview.notify_me', locale)}
        </button>
      </section>
    </div>
  )
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: 'red' }) {
  const valueCls =
    tone === 'red' ? 'text-red-700' : 'text-slate-900'
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6">
      <div className="text-xs uppercase tracking-wider text-slate-600 font-semibold">
        {label}
      </div>
      <div className={`mt-2 text-3xl font-black tracking-tight font-mono ${valueCls}`}>
        {value}
      </div>
    </div>
  )
}
