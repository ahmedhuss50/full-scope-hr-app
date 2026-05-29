import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { NewClientForm } from './NewClientForm'

export const dynamic = 'force-dynamic'

export default async function NewClientPage() {
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

  return (
    <div className="max-w-3xl mx-auto space-y-6" dir="rtl">
      <header className="space-y-2">
        <Link
          href="/app/disbursements/admin"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          ← العودة إلى الإدارة
        </Link>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">عميل جديد</h1>
        <p className="text-sm text-slate-600">أضف عميلًا/مطوّرًا جديدًا، ويمكنك إنشاء حساب دخول له لاستخدام البوابة.</p>
      </header>

      <NewClientForm />
    </div>
  )
}
