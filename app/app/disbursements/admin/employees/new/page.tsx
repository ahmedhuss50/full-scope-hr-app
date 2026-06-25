import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { NewEmployeeForm, type ProjectPickerOption } from './NewEmployeeForm'

export const dynamic = 'force-dynamic'

export default async function NewEmployeePage() {
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
  // Only owners can invite employees.
  if (dsbRole !== 'owner') {
    redirect('/app/disbursements/admin')
  }

  const tenantId = profile.tenant_id as string

  // Fetch projects in this tenant for the assignment multi-select. Group
  // by developer client-side so the picker can render a tidy structure.
  const { data: projectsData } = await svc
    .from('dsb_projects')
    .select('id, code, name_ar, developer_id')
    .eq('tenant_id', tenantId)
    .order('code', { ascending: true })

  const { data: developersData } = await svc
    .from('dsb_developers')
    .select('id, company_name_ar')
    .eq('tenant_id', tenantId)
    .order('company_name_ar', { ascending: true })

  const developerNameById = new Map<string, string>()
  for (const d of ((developersData ?? []) as { id: string; company_name_ar: string }[])) {
    developerNameById.set(d.id, d.company_name_ar)
  }

  const projectOptions: ProjectPickerOption[] = ((projectsData ?? []) as Array<{
    id: string
    code: string
    name_ar: string
    developer_id: string | null
  }>).map((p) => ({
    id: p.id,
    code: p.code,
    name_ar: p.name_ar,
    developer_id: p.developer_id,
    developer_name: p.developer_id ? developerNameById.get(p.developer_id) ?? null : null,
  }))

  return (
    <div className="max-w-3xl mx-auto space-y-6" dir="rtl">
      <header className="space-y-2">
        <Link
          href="/app/disbursements/admin"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          ← العودة إلى الإدارة
        </Link>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          موظف جديد
        </h1>
        <p className="text-sm text-slate-600">
          أضف موظفًا جديدًا إلى فريق الصرفيات، ويمكنك إنشاء حساب دخول له ليبدأ
          فورًا.
        </p>
      </header>

      <NewEmployeeForm projects={projectOptions} />
    </div>
  )
}
