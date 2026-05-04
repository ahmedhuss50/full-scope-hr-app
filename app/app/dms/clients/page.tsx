import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import { fmtDateTime } from '../_shared'

export const dynamic = 'force-dynamic'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type ClientRow = { id: string; name: string; industry: string | null; status: string | null }
type DocRow    = { client_id: string | null; uploaded_at: string }
type LogRow    = { occurred_at: string; document: { client_id: string | null } | { client_id: string | null }[] | null }

export default async function DmsClientsListPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id, locale')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) return null

  const tenantId = profile.tenant_id as string
  const locale = ((profile.locale as Locale) ?? 'ar')

  const [clientsRes, docsRes, logsRes] = await Promise.all([
    svc
      .from('clients')
      .select('id, name, industry, status')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .order('name', { ascending: true }),
    svc
      .from('dms_documents')
      .select('client_id, uploaded_at')
      .eq('tenant_id', tenantId),
    svc
      .from('dms_access_log')
      .select('occurred_at, document:dms_documents!document_id(client_id)')
      .eq('tenant_id', tenantId),
  ])

  const clients = (clientsRes.data ?? []) as ClientRow[]
  const docs    = (docsRes.data ?? []) as DocRow[]
  const logs    = (logsRes.data ?? []) as unknown as LogRow[]

  const docCount = new Map<string, number>()
  for (const d of docs) {
    if (!d.client_id) continue
    docCount.set(d.client_id, (docCount.get(d.client_id) ?? 0) + 1)
  }

  // Last activity = max(latest log on any of the client's docs, latest upload).
  const lastActivity = new Map<string, string>()
  for (const d of docs) {
    if (!d.client_id) continue
    const prev = lastActivity.get(d.client_id)
    if (!prev || d.uploaded_at > prev) lastActivity.set(d.client_id, d.uploaded_at)
  }
  for (const l of logs) {
    const doc = Array.isArray(l.document) ? l.document[0] : l.document
    if (!doc?.client_id) continue
    const prev = lastActivity.get(doc.client_id)
    if (!prev || l.occurred_at > prev) lastActivity.set(doc.client_id, l.occurred_at)
  }

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="text-xs text-slate-500 flex items-center gap-1.5">
        <Link href="/app/dms" className="hover:text-slate-700">{tServer('dms.crumb.dms', locale)}</Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700 font-semibold">{tServer('dms.crumb.clients', locale)}</span>
      </nav>

      <header className="space-y-2">
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          {tServer('dms.clients.title', locale)}
        </h1>
      </header>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {clients.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">
            {tServer('dms.clients.empty', locale)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('dms.clients.col.name',          locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('dms.clients.col.industry',      locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('dms.clients.col.docs',          locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('dms.clients.col.last_activity', locale)}</th>
                  <th className="px-4 py-3 font-semibold text-end">{tServer('dms.clients.col.actions',        locale)}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.map((c) => {
                  const n = docCount.get(c.id) ?? 0
                  const last = lastActivity.get(c.id)
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-4 py-3 font-semibold text-slate-900">{c.name}</td>
                      <td className="px-4 py-3 text-slate-700">{c.industry ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-700 font-mono">{n}</td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        {last ? fmtDateTime(last, locale) : '—'}
                      </td>
                      <td className="px-4 py-3 text-end">
                        <Link
                          href={`/app/dms/clients/${c.id}`}
                          className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-600 hover:text-teal-700"
                        >
                          {tServer('dms.clients.open', locale)}
                          <ArrowRight className="w-4 h-4" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
