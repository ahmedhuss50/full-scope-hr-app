import Link from 'next/link'
import { createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import { requirePortalSession } from '../../_lib/session'

export const dynamic = 'force-dynamic'

const SERVER_LOCALE: Locale = 'en'

const KIND_OPTIONS = [
  'engagement_letter',
  'financial_statement',
  'tax_return',
  'working_paper',
  'other',
] as const

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type DocRow = {
  id: string
  display_name: string | null
  filename: string
  description: string | null
  doc_kind: string | null
  status: string | null
  uploaded_at: string
  uploader: { full_name: string | null } | { full_name: string | null }[] | null
}

function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
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

function kindLabel(kind: string | null, locale: Locale): string {
  if (!kind) return '—'
  return tFn(`dms.kind.${kind}` as StringKey, locale) || kind
}

function statusLabel(status: string | null, locale: Locale): string {
  if (!status) return '—'
  return tFn(`dms.status.${status}` as StringKey, locale) || status
}

function statusClasses(status: string | null): string {
  switch (status) {
    case 'final':      return 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
    case 'signed':     return 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200'
    case 'draft':      return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200'
    case 'archived':   return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
    case 'superseded': return 'bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200'
    default:           return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
  }
}

export default async function PortalDocumentsPage({
  searchParams,
}: {
  searchParams?: { q?: string; kind?: string }
}) {
  const session = await requirePortalSession()
  const locale = SERVER_LOCALE
  const svc = createSupabaseService()

  const q    = (searchParams?.q ?? '').trim()
  const kind = (searchParams?.kind ?? '').trim()

  let query = svc
    .from('dms_documents')
    .select(`
      id, display_name, filename, description, doc_kind, status, uploaded_at,
      uploader:users!uploaded_by(full_name)
    `)
    .eq('tenant_id', session.tenantId)
    .eq('client_id', session.clientId)
    .order('uploaded_at', { ascending: false })

  if (kind) query = query.eq('doc_kind', kind)
  if (q) {
    // Match either display_name or filename — Supabase OR filter syntax.
    query = query.or(`display_name.ilike.%${q}%,filename.ilike.%${q}%`)
  }

  const { data } = await query
  const docs = (data ?? []) as DocRow[]

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="serif font-bold text-3xl tracking-tight text-slate-900">
          {tServer('portal.documents.title', locale)}
        </h1>
        <p className="text-slate-600 text-sm">{tServer('portal.documents.subtitle', locale)}</p>
      </header>

      {/* Filter form */}
      <form className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[16rem]">
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">
            {tServer('portal.documents.search', locale)}
          </label>
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder={tServer('portal.documents.search', locale)}
            className="input w-full"
          />
        </div>
        <div className="min-w-[10rem]">
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">
            {tServer('portal.documents.filter.kind', locale)}
          </label>
          <select name="kind" defaultValue={kind} className="input w-full">
            <option value="">{tServer('portal.documents.filter.all', locale)}</option>
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>{kindLabel(k, locale)}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button type="submit" className="btn-primary text-sm">
            {locale === 'ar' ? 'تصفية' : 'Filter'}
          </button>
          <Link href="/portal/documents" className="btn-ghost text-sm">
            {locale === 'ar' ? 'مسح' : 'Clear'}
          </Link>
        </div>
        <div className="ms-auto text-xs text-slate-500 font-mono">
          {tServer('portal.documents.results_n', locale, { n: docs.length })}
        </div>
      </form>

      {/* Results table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {docs.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">
            {tServer('portal.documents.empty', locale)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('portal.documents.col.title',       locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('portal.documents.col.description', locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('portal.documents.col.kind',        locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('portal.documents.col.status',      locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('portal.documents.col.uploaded_by', locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('portal.documents.col.uploaded_at', locale)}</th>
                  <th className="px-4 py-3 font-semibold text-end">&nbsp;</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {docs.map((d) => {
                  const uploader = pickOne<{ full_name: string | null }>(d.uploader)
                  return (
                    <tr key={d.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{d.display_name ?? d.filename}</div>
                        <div className="text-xs text-slate-500 truncate font-mono">{d.filename}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 max-w-[18rem]">
                        <div className="line-clamp-2 text-xs text-slate-600">{d.description ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="chip bg-slate-100 text-slate-700">
                          {kindLabel(d.doc_kind, locale)}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusClasses(d.status)}`}>
                          {statusLabel(d.status, locale)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        {uploader?.full_name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        {fmtDate(d.uploaded_at, locale)}
                      </td>
                      <td className="px-4 py-3 text-end whitespace-nowrap">
                        <a
                          href="#"
                          title={tServer('portal.documents.preview_unavailable', locale)}
                          className="text-xs font-semibold text-teal-600 hover:text-teal-700 cursor-not-allowed opacity-80"
                        >
                          {tServer('portal.documents.view', locale)}
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
