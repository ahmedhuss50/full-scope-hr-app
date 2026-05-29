import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { NewDisbursementForm, type ProjectOption } from './NewDisbursementForm'

export const dynamic = 'force-dynamic'

export default async function NewDisbursementPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile || profile.dsb_role !== 'developer') redirect('/login')

  const tenantId = profile.tenant_id as string
  const userId = profile.id as string

  const { data: dev } = await svc
    .from('dsb_developers')
    .select('id, company_name_ar')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!dev) {
    return (
      <div className="max-w-xl mx-auto" dir="rtl">
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <h1 className="serif font-bold text-2xl mb-2">حسابك غير مرتبط بمطوّر</h1>
          <p className="text-sm text-slate-600">يرجى التواصل مع فُل سكوب لربط حسابك بالملف.</p>
        </div>
      </div>
    )
  }

  // Show all active projects in this tenant — developer can pick.
  const { data: projects } = await svc
    .from('dsb_projects')
    .select('id, code, name_ar')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('code')

  const projectOptions: ProjectOption[] = ((projects ?? []) as { id: string; code: string; name_ar: string }[])
    .map((p) => ({ id: p.id, code: p.code, name_ar: p.name_ar }))

  return (
    <div className="max-w-3xl mx-auto space-y-6" dir="rtl">
      <header className="space-y-2">
        <Link href="/developer" className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700">
          ← العودة إلى صرفياتي
        </Link>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">طلب صرف جديد</h1>
        <p className="text-sm text-slate-600">ارفع ملف PDF واحد يتضمّن (سند الصرف + الفواتير + الإثباتات).</p>
      </header>

      <NewDisbursementForm
        developerId={dev.id}
        developerName={dev.company_name_ar as string}
        projects={projectOptions}
      />
    </div>
  )
}
