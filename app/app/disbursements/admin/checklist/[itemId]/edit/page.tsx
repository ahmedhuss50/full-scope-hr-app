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
  template_id: string | null
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
    redirect('/app/disbursements/admin/checklist-templates')
  }
  const tenantId = profile.tenant_id as string

  const { data: itemData } = await svc
    .from('dsb_checklist_items')
    .select('id, tenant_id, code, order_index, prompt_ar, prompt_en, active, template_id')
    .eq('id', params.itemId)
    .maybeSingle()

  if (!itemData) notFound()
  const item = itemData as ChecklistItemRow
  // Allow editing of legacy default items (tenant_id IS NULL) and own-tenant
  // items. Block items from another tenant.
  if (item.tenant_id !== null && item.tenant_id !== tenantId) notFound()

  // Templates for the picker (tenant-scoped).
  const { data: tplsRaw } = await svc
    .from('dsb_checklist_templates')
    .select('id, name, is_default')
    .eq('tenant_id', tenantId)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })
  const templates = ((tplsRaw ?? []) as Array<{ id: string; name: string; is_default: boolean }>)
    .map((t) => ({ id: t.id, label: t.is_default ? `${t.name} (افتراضية)` : t.name }))

  // Look up the current template's display name for the read-only header
  // shown above the form.
  let currentTemplateLabel: string | null = null
  if (item.template_id) {
    const match = templates.find((t) => t.id === item.template_id)
    currentTemplateLabel = match?.label ?? null
  }

  const backHref = item.template_id
    ? `/app/disbursements/admin/checklist-templates/${item.template_id}`
    : '/app/disbursements/admin/checklist-templates'

  return (
    <div className="max-w-3xl mx-auto space-y-6" dir="rtl">
      <header className="space-y-2">
        <Link
          href={backHref}
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          ← العودة إلى القائمة
        </Link>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">تعديل البند</h1>
        <p className="text-sm text-slate-600 font-mono text-xs">{item.code}</p>
        {currentTemplateLabel && (
          <p className="text-xs text-slate-500">
            القائمة الحالية: <span className="font-semibold text-slate-700">{currentTemplateLabel}</span>
          </p>
        )}
      </header>

      <EditChecklistItemForm
        item={{
          id: item.id,
          code: item.code,
          prompt_ar: item.prompt_ar,
          prompt_en: item.prompt_en,
          order_index: item.order_index,
          active: item.active,
          template_id: item.template_id,
        }}
        templates={templates}
      />
    </div>
  )
}
