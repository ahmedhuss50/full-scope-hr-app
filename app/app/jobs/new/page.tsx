import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { strings, type Locale } from '@/lib/i18n/translations'
import { JobForm } from './JobForm'

export const dynamic = 'force-dynamic'

function tServer(key: keyof typeof strings, locale: Locale) {
  return strings[key]?.[locale] ?? strings[key]?.en ?? key
}

export default async function NewJobPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id, locale')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) redirect('/login')

  const locale = ((profile.locale as Locale) ?? 'ar')
  const tenantId = profile.tenant_id as string

  // Reference dropdowns (departments, practice areas, work locations) from the tenant.
  const [{ data: departments }, { data: practiceAreas }, { data: workLocations }] = await Promise.all([
    svc.from('departments').select('id, name').eq('tenant_id', tenantId).eq('active', true).order('name'),
    svc.from('practice_areas').select('id, name, code').eq('tenant_id', tenantId).eq('active', true).order('name'),
    svc.from('work_locations').select('id, name').eq('tenant_id', tenantId).eq('active', true).order('name'),
  ])

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <a href="/app/jobs" className="text-sm text-teal-600 hover:underline">
          ← {tServer('jobs.title', locale)}
        </a>
      </div>
      <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
        {tServer('jobs.new.title', locale)}
      </h1>
      <JobForm
        locale={locale}
        departments={departments ?? []}
        practiceAreas={practiceAreas ?? []}
        workLocations={workLocations ?? []}
      />
    </div>
  )
}
