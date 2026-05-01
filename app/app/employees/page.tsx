import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { strings, type Locale } from '@/lib/i18n/translations'

export const dynamic = 'force-dynamic'

type EmployeeRow = {
  id: string
  legal_first_name: string | null
  legal_last_name: string | null
  preferred_name: string | null
  primary_email: string | null
  job_title: string | null
  departments: { name: string | null } | null
}

function tServer(key: keyof typeof strings, locale: Locale) {
  return strings[key]?.[locale] ?? strings[key]?.en ?? key
}

export default async function EmployeesPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const svc = createSupabaseService()
  const { data: profile } = await svc.from('users').select('tenant_id, locale').eq('email', user.email!).maybeSingle()
  if (!profile) return null

  const locale = ((profile.locale as Locale) ?? 'ar')
  const tenantId = profile.tenant_id as string

  const { data, error } = await svc
    .from('employees')
    .select('id, legal_first_name, legal_last_name, preferred_name, primary_email, job_title, departments(name)')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('legal_last_name', { ascending: true })

  if (error) console.error('[employees] query', error)
  const rows = (data ?? []) as EmployeeRow[]

  return (
    <div className="space-y-6">
      <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
        {tServer('employees.title', locale)}
      </h1>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">
            {tServer('employees.empty', locale)}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
              <tr>
                <th className="p-3 font-semibold text-start">{tServer('employees.col.name',       locale)}</th>
                <th className="p-3 font-semibold text-start">{tServer('employees.col.email',      locale)}</th>
                <th className="p-3 font-semibold text-start">{tServer('employees.col.department', locale)}</th>
                <th className="p-3 font-semibold text-start">{tServer('employees.col.role',       locale)}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const fullName = r.preferred_name
                  ?? [r.legal_first_name, r.legal_last_name].filter(Boolean).join(' ')
                  ?? '—'
                return (
                  <tr key={r.id} className="border-t border-slate-200">
                    <td className="p-3 font-semibold text-slate-900">{fullName || '—'}</td>
                    <td className="p-3 text-slate-700">{r.primary_email ?? '—'}</td>
                    <td className="p-3 text-slate-700">{r.departments?.name ?? '—'}</td>
                    <td className="p-3 text-slate-700">{r.job_title ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
