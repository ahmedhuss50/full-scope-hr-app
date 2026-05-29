import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { NewCaseForm, type DeveloperOption, type ProjectOption } from './NewCaseForm'

export const dynamic = 'force-dynamic'

export default async function StaffNewCasePage() {
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
  if (!dsbRole || !['employee', 'supervisor', 'owner'].includes(dsbRole)) {
    redirect('/app/disbursements')
  }

  const tenantId = profile.tenant_id as string

  const { data: devsRaw } = await svc
    .from('dsb_developers')
    .select('id, company_name_ar')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('company_name_ar', { ascending: true })
  const developers: DeveloperOption[] = ((devsRaw ?? []) as { id: string; company_name_ar: string }[])
    .map((d) => ({ id: d.id, company_name_ar: d.company_name_ar }))

  const { data: projectsRaw } = await svc
    .from('dsb_projects')
    .select('id, code, name_ar')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('code', { ascending: true })
  const projects: ProjectOption[] = ((projectsRaw ?? []) as { id: string; code: string; name_ar: string }[])
    .map((p) => ({ id: p.id, code: p.code, name_ar: p.name_ar }))

  const noClients = developers.length === 0
  const noProjects = projects.length === 0

  return (
    <div className="max-w-3xl mx-auto space-y-6" dir="rtl">
      <header className="space-y-2">
        <Link
          href="/app/disbursements"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          ← العودة إلى صندوق الصرفيات
        </Link>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">سند صرف جديد</h1>
        <p className="text-sm text-slate-600">رفع نيابة عن المطور.</p>
      </header>

      {(noClients || noProjects) ? (
        <div className="bg-white border border-amber-200 rounded-xl p-6 text-sm text-amber-900 space-y-3">
          {noClients && (
            <div>
              لا يوجد عملاء بعد. <Link href="/app/disbursements/admin/clients/new" className="font-semibold text-teal-700 hover:underline">أضِف عميلًا أولًا</Link>.
            </div>
          )}
          {noProjects && (
            <div>
              لا توجد مشاريع نشطة. <Link href="/app/disbursements/admin/projects/new" className="font-semibold text-teal-700 hover:underline">أنشئ مشروعًا أولًا</Link>.
            </div>
          )}
        </div>
      ) : (
        <NewCaseForm developers={developers} projects={projects} />
      )}
    </div>
  )
}
