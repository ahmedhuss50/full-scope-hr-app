import Link from 'next/link'
import { Star, Mail, Phone } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import { roleClasses, roleLabel, type CrmContactRole } from '../_shared'

export const dynamic = 'force-dynamic'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

const ROLE_OPTIONS: CrmContactRole[] = [
  'primary', 'finance', 'technical', 'executive', 'legal', 'procurement', 'assistant', 'other',
]

type ContactRow = {
  id: string
  client_id: string
  full_name: string
  job_title: string | null
  email: string | null
  mobile_phone: string | null
  role: CrmContactRole
  is_primary: boolean
  client: { id: string; name: string } | { id: string; name: string }[] | null
}

type ClientChoice = { id: string; name: string }

export default async function CrmContactsPage({
  searchParams,
}: {
  searchParams: { q?: string; client?: string; role?: string }
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

  let q = svc
    .from('crm_contacts')
    .select(`
      id, client_id, full_name, job_title, email, mobile_phone, role, is_primary,
      client:clients!client_id(id, name)
    `)
    .eq('tenant_id', tenantId)
    .order('full_name', { ascending: true })

  const search = sp.q?.trim() ?? ''
  if (search) {
    q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`)
  }
  if (sp.client && sp.client !== '__all__') {
    q = q.eq('client_id', sp.client)
  }
  if (sp.role && sp.role !== '__all__') {
    q = q.eq('role', sp.role)
  }

  const [contactsRes, clientsRes] = await Promise.all([
    q,
    svc
      .from('clients')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true }),
  ])

  const contacts = (contactsRes.data ?? []) as unknown as ContactRow[]
  const clients  = (clientsRes.data ?? []) as ClientChoice[]

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="text-xs text-slate-500 flex items-center gap-1.5">
        <Link href="/app/crm" className="hover:text-slate-700">{tServer('crm.crumb.crm', locale)}</Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700 font-semibold">{tServer('crm.crumb.contacts', locale)}</span>
      </nav>

      <header className="space-y-1">
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          {tServer('crm.contacts.title', locale)}
        </h1>
        <p className="text-sm text-slate-500">{tServer('crm.contacts.subtitle', locale)}</p>
      </header>

      {/* Filter bar — server-side via GET form */}
      <form
        method="GET"
        className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-wrap items-end gap-3"
      >
        <div className="flex-1 min-w-[12rem]">
          <label className="block text-xs uppercase tracking-wider font-semibold text-slate-600 mb-1">
            {tServer('dms.all.search', locale)}
          </label>
          <input
            type="text"
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder={tServer('crm.contacts.search', locale)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider font-semibold text-slate-600 mb-1">
            {tServer('crm.contacts.filter.client', locale)}
          </label>
          <select
            name="client"
            defaultValue={sp.client ?? '__all__'}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="__all__">{tServer('crm.contacts.filter.all', locale)}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider font-semibold text-slate-600 mb-1">
            {tServer('crm.contacts.filter.role', locale)}
          </label>
          <select
            name="role"
            defaultValue={sp.role ?? '__all__'}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="__all__">{tServer('crm.contacts.filter.all', locale)}</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>{roleLabel(r, locale)}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          {tServer('dms.all.results_n', locale, { n: contacts.length })}
        </button>
      </form>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {contacts.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">{tServer('crm.contacts.empty', locale)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('crm.contacts.col.name',      locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('crm.contacts.col.job_title', locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('crm.contacts.col.role',      locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('crm.contacts.col.client',    locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('crm.contacts.col.email',     locale)}</th>
                  <th className="px-4 py-3 font-semibold text-start">{tServer('crm.contacts.col.phone',     locale)}</th>
                  <th className="px-4 py-3 font-semibold text-end">{tServer('crm.contacts.col.primary',   locale)}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {contacts.map((c) => {
                  const cl = Array.isArray(c.client) ? c.client[0] : c.client
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-4 py-3 font-semibold text-slate-900">{c.full_name}</td>
                      <td className="px-4 py-3 text-slate-700">{c.job_title ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${roleClasses(c.role)}`}>
                          {roleLabel(c.role, locale)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {cl ? (
                          <Link
                            href={`/app/crm/clients/${cl.id}`}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-200"
                          >
                            {cl.name}
                          </Link>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {c.email ? (
                          <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 hover:text-teal-700">
                            <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                            {c.email}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-700 font-mono text-xs whitespace-nowrap">
                        {c.mobile_phone ? (
                          <a href={`tel:${c.mobile_phone}`} className="inline-flex items-center gap-1.5 hover:text-teal-700">
                            <Phone className="w-3.5 h-3.5" aria-hidden="true" />
                            {c.mobile_phone}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-end">
                        {c.is_primary ? (
                          <Star className="inline w-4 h-4 text-amber-500 fill-amber-400" aria-label={tServer('crm.contacts.col.primary', locale)} />
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
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
