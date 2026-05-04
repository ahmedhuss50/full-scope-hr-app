import { Receipt } from 'lucide-react'
import { requirePortalSession } from '../../_lib/session'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'

export const dynamic = 'force-dynamic'

const SERVER_LOCALE: Locale = 'en'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type MockInvoice = {
  number: string
  issued: string
  amount: number
  status: 'paid' | 'sent' | 'draft'
}

const MOCK_INVOICES: MockInvoice[] = [
  { number: 'INV-2026-014', issued: '2026-04-15', amount: 120000, status: 'paid' },
  { number: 'INV-2026-027', issued: '2026-04-30', amount:  85000, status: 'sent' },
  { number: 'INV-2026-031', issued: '2026-05-02', amount:  45000, status: 'draft' },
]

function fmtDate(s: string, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      day: 'numeric', month: 'short', year: 'numeric',
    }).format(new Date(s))
  } catch {
    return s
  }
}

function fmtSar(amount: number, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      style: 'currency', currency: 'SAR', maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${amount.toLocaleString()} SAR`
  }
}

function statusClasses(s: MockInvoice['status']): string {
  switch (s) {
    case 'paid':  return 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
    case 'sent':  return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200'
    case 'draft': return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
  }
}

export default async function PortalInvoicesPage() {
  // Still require an authenticated portal session — keeps the page hidden
  // from non-clients even though there's no real data.
  await requirePortalSession()
  const locale = SERVER_LOCALE

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="serif font-bold text-3xl tracking-tight text-slate-900">
          {tServer('portal.invoices.title', locale)}
        </h1>
        <p className="text-slate-600 text-sm">{tServer('portal.invoices.subtitle', locale)}</p>
      </header>

      {/* Coming-soon banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 text-amber-700 shrink-0">
          <Receipt className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm text-amber-900 font-semibold mb-1">
            {tServer('portal.invoices.coming', locale)}
          </p>
          <p className="text-xs text-amber-800">{tServer('portal.invoices.demo_note', locale)}</p>
        </div>
      </div>

      {/* Mock invoice table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm relative">
        <div className="absolute top-2 end-2 z-10 text-[10px] uppercase tracking-wider font-semibold text-slate-500 bg-slate-100 rounded px-2 py-0.5">
          {tServer('portal.invoices.demo_note', locale)}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold text-start">{tServer('portal.invoices.col.number', locale)}</th>
                <th className="px-4 py-3 font-semibold text-start">{tServer('portal.invoices.col.issued', locale)}</th>
                <th className="px-4 py-3 font-semibold text-start">{tServer('portal.invoices.col.amount', locale)}</th>
                <th className="px-4 py-3 font-semibold text-start">{tServer('portal.invoices.col.status', locale)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {MOCK_INVOICES.map((inv) => (
                <tr key={inv.number} className="hover:bg-slate-50/50 transition">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{inv.number}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDate(inv.issued, locale)}</td>
                  <td className="px-4 py-3 text-slate-900 font-mono whitespace-nowrap">{fmtSar(inv.amount, locale)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusClasses(inv.status)}`}>
                      {tServer(`portal.invoices.status.${inv.status}` as StringKey, locale)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
