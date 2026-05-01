import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { strings, type Locale } from '@/lib/i18n/translations'

export const dynamic = 'force-dynamic'

type JobRow = {
  id: string
  title: string
  status: string
  opened_at: string | null
  departments: { name: string | null } | { name: string | null }[] | null
}

function tServer(key: keyof typeof strings, locale: Locale) {
  return strings[key]?.[locale] ?? strings[key]?.en ?? key
}

export default async function JobsPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const svc = createSupabaseService()
  const { data: profile } = await svc.from('users').select('tenant_id, locale').eq('email', user.email!).maybeSingle()
  if (!profile) return null

  const locale = ((profile.locale as Locale) ?? 'ar')
  const tenantId = profile.tenant_id as string

  const { data, error } = await svc
    .from('job_requisitions')
    .select('id, title, status, opened_at, departments(name)')
    .eq('tenant_id', tenantId)
    .order('opened_at', { ascending: false })

  if (error) console.error('[jobs] query', error)
  const rows = (data ?? []) as JobRow[]

  // Per-job application counts (one parallel head:true call per job, fine for 3 seed rows).
  const counts: Record<string, number> = {}
  await Promise.all(
    rows.map(async (j) => {
      const { count } = await svc
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('job_requisition_id', j.id)
      counts[j.id] = count ?? 0
    })
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          {tServer('jobs.title', locale)}
        </h1>
        <a
          href="/app/jobs/new"
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
        >
          + {tServer('jobs.create_button', locale)}
        </a>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">
            {tServer('jobs.empty', locale)}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
              <tr>
                <th className="p-3 font-semibold text-start">{tServer('jobs.col.title',       locale)}</th>
                <th className="p-3 font-semibold text-start">{tServer('jobs.col.department',  locale)}</th>
                <th className="p-3 font-semibold text-start">{tServer('jobs.col.status',      locale)}</th>
                <th className="p-3 font-semibold text-start">{tServer('jobs.applications_count', locale)}</th>
                <th className="p-3 font-semibold text-start">{tServer('jobs.col.opened_at',   locale)}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-200">
                  <td className="p-3 font-semibold text-slate-900">{r.title}</td>
                  <td className="p-3 text-slate-700">{(Array.isArray(r.departments) ? r.departments[0]?.name : r.departments?.name) ?? '—'}</td>
                  <td className="p-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-slate-700 text-xs font-semibold uppercase tracking-wider">
                      {r.status}
                    </span>
                  </td>
                  <td className="p-3 text-slate-700">{counts[r.id] ?? 0}</td>
                  <td className="p-3 text-slate-700">{r.opened_at ? new Date(r.opened_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
