import Link from 'next/link'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import {
  fmtBytes, fmtDateTime,
  sensitivityClasses, sensitivityLabel, statusClasses, statusLabel, kindLabel,
  type DmsSensitivity, type DmsStatus,
} from '../_shared'

export const dynamic = 'force-dynamic'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type DocumentRow = {
  id: string
  client_id: string | null
  filename: string
  display_name: string | null
  doc_kind: string | null
  sensitivity: DmsSensitivity
  status: DmsStatus
  version_number: number
  file_size_bytes: number | null
  uploaded_at: string
  uploader: { full_name: string | null } | { full_name: string | null }[] | null
  client: { name: string } | { name: string }[] | null
}

type ClientRow = { id: string; name: string }

const KIND_OPTIONS: { value: string; key: StringKey }[] = [
  { value: 'engagement_letter',   key: 'dms.kind.engagement_letter' },
  { value: 'financial_statement', key: 'dms.kind.financial_statement' },
  { value: 'tax_return',          key: 'dms.kind.tax_return' },
  { value: 'working_paper',       key: 'dms.kind.working_paper' },
  { value: 'other',               key: 'dms.kind.other' },
]

const SENSITIVITY_OPTIONS: DmsSensitivity[] = ['public', 'internal', 'confidential', 'restricted']
const STATUS_OPTIONS: DmsStatus[] = ['draft', 'final', 'signed', 'archived', 'superseded']

export default async function DmsAllPage({
  searchParams,
}: {
  searchParams: {
    q?: string
    kind?: string
    sensitivity?: string
    status?: string
    client?: string
  }
}) {
  const sp = searchParams

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

  // Build the query with applied filters.
  let q = svc
    .from('dms_documents')
    .select(`
      id, client_id, filename, display_name, doc_kind, sensitivity, status, version_number,
      file_size_bytes, uploaded_at,
      uploader:users!uploaded_by(full_name),
      client:clients!client_id(name)
    `)
    .eq('tenant_id', tenantId)
    .order('uploaded_at', { ascending: false })

  const search = sp.q?.trim() ?? ''
  if (search) {
    // ILIKE on filename or display_name.
    q = q.or(`filename.ilike.%${search}%,display_name.ilike.%${search}%`)
  }
  if (sp.kind && sp.kind !== '__all__') {
    q = q.eq('doc_kind', sp.kind)
  }
  if (sp.sensitivity && sp.sensitivity !== '__all__') {
    q = q.eq('sensitivity', sp.sensitivity)
  }
  if (sp.status && sp.status !== '__all__') {
    q = q.eq('status', sp.status)
  }
  if (sp.client && sp.client !== '__all__') {
    if (sp.client === '__firm__') {
      q = q.is('client_id', null)
    } else {
      q = q.eq('client_id', sp.client)
    }
  }

  const [docsRes, clientsRes] = await Promise.all([
    q,
    svc
      .from('clients')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true }),
  ])

  const docs    = (docsRes.data ?? []) as unknown as DocumentRow[]
  const clients = (clientsRes.data ?? []) as ClientRow[]

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="text-xs text-slate-500 flex items-center gap-1.5">
        <Link href="/app/dms" className="hover:text-slate-700">{tServer('dms.crumb.dms', locale)}</Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700 font-semibold">{tServer('dms.all.title', locale)}</span>
      </nav>

      <header className="space-y-2">
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          {tServer('dms.all.title', locale)}
        </h1>
        <p className="text-sm text-slate-500 max-w-2xl">
          {tServer('dms.all.subtitle', locale)}
        </p>
      </header>

      {/* Filters */}
      <form
        method="GET"
        className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm grid grid-cols-1 md:grid-cols-5 gap-3"
      >
        <input
          type="text"
          name="q"
          defaultValue={search}
          placeholder={tServer('dms.all.search', locale)}
          className="md:col-span-2 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        />
        <select
          name="kind"
          defaultValue={sp.kind ?? '__all__'}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        >
          <option value="__all__">{tServer('dms.all.filter.kind', locale)} — {tServer('dms.all.filter.all', locale)}</option>
          {KIND_OPTIONS.map((k) => (
            <option key={k.value} value={k.value}>{tServer(k.key, locale)}</option>
          ))}
        </select>
        <select
          name="sensitivity"
          defaultValue={sp.sensitivity ?? '__all__'}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        >
          <option value="__all__">{tServer('dms.all.filter.sensitivity', locale)} — {tServer('dms.all.filter.all', locale)}</option>
          {SENSITIVITY_OPTIONS.map((s) => (
            <option key={s} value={s}>{sensitivityLabel(s, locale)}</option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={sp.status ?? '__all__'}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        >
          <option value="__all__">{tServer('dms.all.filter.status', locale)} — {tServer('dms.all.filter.all', locale)}</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{statusLabel(s, locale)}</option>
          ))}
        </select>
        <select
          name="client"
          defaultValue={sp.client ?? '__all__'}
          className="md:col-span-2 px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        >
          <option value="__all__">{tServer('dms.all.filter.client', locale)} — {tServer('dms.all.filter.all', locale)}</option>
          <option value="__firm__">{tServer('dms.all.firm_internal', locale)}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <div className="md:col-span-3 flex items-center gap-3">
          <button
            type="submit"
            className="inline-flex items-center px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition"
          >
            {locale === 'ar' ? 'تطبيق' : 'Apply'}
          </button>
          <Link
            href="/app/dms/all"
            className="text-xs text-slate-500 hover:text-slate-900 font-semibold"
          >
            {locale === 'ar' ? 'مسح' : 'Clear'}
          </Link>
          <span className="ms-auto text-xs text-slate-500 font-mono">
            {tServer('dms.all.results_n', locale, { n: docs.length })}
          </span>
        </div>
      </form>

      {/* Results table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {docs.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">
            {tServer('dms.all.empty', locale)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('dms.col.display_name', locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('dms.clients.col.name', locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('dms.col.doc_kind',     locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('dms.col.sensitivity', locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('dms.col.status',      locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('dms.col.version',     locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('dms.col.size',        locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('dms.col.uploaded_by', locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('dms.col.uploaded_at', locale)}</th>
                  <th className="px-4 py-3 font-semibold text-end">&nbsp;</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {docs.map((d) => {
                  const uploader = Array.isArray(d.uploader) ? d.uploader[0] : d.uploader
                  const client   = Array.isArray(d.client)   ? d.client[0]   : d.client
                  return (
                    <tr key={d.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{d.display_name ?? d.filename}</div>
                        <div className="text-xs text-slate-500 truncate font-mono">{d.filename}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        {client?.name ?? (
                          <span className="text-slate-400 italic">{tServer('dms.all.firm_internal', locale)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{kindLabel(d.doc_kind, locale)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${sensitivityClasses(d.sensitivity)}`}>
                          {sensitivityLabel(d.sensitivity, locale)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusClasses(d.status)}`}>
                          {statusLabel(d.status, locale)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700 text-xs">v{d.version_number}</td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap font-mono text-xs">{fmtBytes(d.file_size_bytes, locale)}</td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{uploader?.full_name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDateTime(d.uploaded_at, locale)}</td>
                      <td className="px-4 py-3 text-end whitespace-nowrap">
                        <a
                          href="#"
                          title={tServer('dms.actions.preview_not_available', locale)}
                          className="text-xs font-semibold text-teal-600 hover:text-teal-700 cursor-not-allowed opacity-80"
                        >
                          {tServer('dms.actions.view', locale)}
                        </a>
                        <span className="text-slate-300 mx-1.5">·</span>
                        <a
                          href="#"
                          title={tServer('dms.actions.preview_not_available', locale)}
                          className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-not-allowed opacity-80"
                        >
                          {tServer('dms.actions.download', locale)}
                        </a>
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
