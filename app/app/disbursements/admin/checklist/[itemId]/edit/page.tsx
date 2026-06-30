import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { EditChecklistItemForm } from './EditChecklistItemForm'

export const dynamic = 'force-dynamic'

type ChecklistItemRow = {
  id: string
  tenant_id: string | null
  code: string
  order_index: number
  prompt_ar: string
  prompt_en: string
  active: boolean
  project_id: string | null
  developer_id: string | null
}

export default async function EditChecklistItemPage({
  params,
}: {
  params: { itemId: string }
}) {
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

  const { data: itemData } = await svc
    .from('dsb_checklist_items')
    .select('id, tenant_id, code, order_index, prompt_ar, prompt_en, active, project_id, developer_id')
    .eq('id', params.itemId)
    .maybeSingle()

  if (!itemData) notFound()
  const item = itemData as ChecklistItemRow
  // Owner can now edit defaults (tenant_id IS NULL) AND own-tenant items.
  // Block only items from OTHER tenants.
  if (item.tenant_id !== null && item.tenant_id !== tenantId) notFound()

  // Scope picker can only target tenant-owned items. Defaults (tenant_id NULL)
  // stay global and the form will hide the scope picker.
  const isDefaultItem = item.tenant_id === null
  let developers: Array<{ id: string; label: string }> = []
  let projects: Array<{ id: string; label: string }> = []
  if (!isDefaultItem) {
    const [{ data: devsRaw }, { data: projsRaw }] = await Promise.all([
      svc
        .from('dsb_developers')
        .select('id, company_name_ar, status')
        .eq('tenant_id', tenantId)
        .order('company_name_ar', { ascending: true }),
      svc
        .from('dsb_projects')
        .select('id, code, name_ar, status')
        .eq('tenant_id', tenantId)
        .order('name_ar', { ascending: true }),
    ])
    developers = ((devsRaw ?? []) as Array<{ id: string; company_name_ar: string; status: string | null }>)
      .filter((d) => d.status !== 'archived' || d.id === item.developer_id)
      .map((d) => ({ id: d.id, label: d.company_name_ar }))
    projects = ((projsRaw ?? []) as Array<{ id: string; code: string; name_ar: string; status: string | null }>)
      .filter((p) => p.status !== 'archived' || p.id === item.project_id)
      .map((p) => ({ id: p.id, label: `${p.name_ar} (${p.code})` }))
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6" dir="rtl">
      <header className="space-y-2">
        <Link
          href="/app/disbursements/admin/checklist"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          ← العودة إلى قائمة المراجعة
        </Link>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">تعديل البند</h1>
        <p className="text-sm text-slate-600 font-mono text-xs">{item.code}</p>
      </header>

      <EditChecklistItemForm
        item={{
          id: item.id,
          code: item.code,
          prompt_ar: item.prompt_ar,
          prompt_en: item.prompt_en,
          order_index: item.order_index,
          active: item.active,
          project_id: item.project_id,
          developer_id: item.developer_id,
        }}
        isDefaultItem={isDefaultItem}
        developers={developers}
        projects={projects}
      />
    </div>
  )
}
