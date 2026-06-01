import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { NewChecklistItemForm } from './NewChecklistItemForm'

export const dynamic = 'force-dynamic'

export default async function NewChecklistItemPage() {
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
  if (dsbRole !== 'owner') {
    redirect('/app/disbursements/admin/checklist')
  }
  const tenantId = profile.tenant_id as string

  // Compute highest existing order_index (global + tenant) for default.
  const { data: maxRow } = await svc
    .from('dsb_checklist_items')
    .select('order_index')
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = ((maxRow?.order_index as number | null) ?? 0) + 1

  return (
    <div className="max-w-3xl mx-auto space-y-6" dir="rtl">
      <header className="space-y-2">
        <Link
          href="/app/disbursements/admin/checklist"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          ← العودة إلى قائمة المراجعة
        </Link>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">بند جديد</h1>
        <p className="text-sm text-slate-600">
          أضف بندًا مخصصًا لمكتبك ليظهر في قائمة مراجعة كل قضية.
        </p>
      </header>

      <NewChecklistItemForm defaultOrderIndex={nextOrder} />
    </div>
  )
}
