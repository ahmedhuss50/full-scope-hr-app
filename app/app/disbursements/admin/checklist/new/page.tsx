import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { NewChecklistItemForm } from './NewChecklistItemForm'

export const dynamic = 'force-dynamic'

// Items now belong to a template (migration 053). The new-item form is
// always entered via a specific template — either through the template
// detail page's "بند جديد" button (?template=<id>), or by picking from
// the dropdown if the link came in without one.
export default async function NewChecklistItemPage({
  searchParams,
}: {
  searchParams?: { template?: string }
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

  // Load all templates for the dropdown. If the link came with ?template=<id>,
  // validate it belongs to this tenant and pre-select it.
  const { data: tplsRaw } = await svc
    .from('dsb_checklist_templates')
    .select('id, name, is_default')
    .eq('tenant_id', tenantId)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })
  const templates = ((tplsRaw ?? []) as Array<{ id: string; name: string; is_default: boolean }>)
    .map((t) => ({ id: t.id, label: t.is_default ? `${t.name} (افتراضية)` : t.name }))

  if (templates.length === 0) {
    // No templates yet → nothing to add an item to. Bounce back to the
    // templates index so the owner can create one first.
    redirect('/app/disbursements/admin/checklist-templates')
  }

  const requestedTpl = (searchParams?.template ?? '').trim()
  const preselectedTemplateId = requestedTpl && templates.some((t) => t.id === requestedTpl)
    ? requestedTpl
    : templates[0]!.id

  if (requestedTpl && !templates.some((t) => t.id === requestedTpl)) {
    // The link pointed at a template that doesn't belong to this tenant.
    // Fall through to notFound rather than silently swapping.
    notFound()
  }

  // Compute highest existing order_index for the chosen template, to
  // default-fill the order field.
  const { data: maxRow } = await svc
    .from('dsb_checklist_items')
    .select('order_index')
    .eq('tenant_id', tenantId)
    .eq('template_id', preselectedTemplateId)
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = ((maxRow?.order_index as number | null) ?? 0) + 1

  const preselectedName = templates.find((t) => t.id === preselectedTemplateId)?.label ?? ''

  return (
    <div className="max-w-3xl mx-auto space-y-6" dir="rtl">
      <header className="space-y-2">
        <Link
          href={`/app/disbursements/admin/checklist-templates/${preselectedTemplateId}`}
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          ← العودة إلى القائمة
        </Link>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">بند جديد</h1>
        <p className="text-sm text-slate-600">
          أضف بندًا جديدًا إلى القائمة <span className="font-semibold">{preselectedName}</span>.
        </p>
      </header>

      <NewChecklistItemForm
        defaultOrderIndex={nextOrder}
        templates={templates}
        defaultTemplateId={preselectedTemplateId}
      />
    </div>
  )
}
