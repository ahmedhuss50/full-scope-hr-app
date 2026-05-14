import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import { StartWorkflowForm, type ClientOption, type TemplateOption } from './StartWorkflowForm'

export const dynamic = 'force-dynamic'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

/**
 * Start a new disbursement workflow — firm-staff facing.
 *
 * Pre-fetches the tenant's clients (with primary_contact_* used to auto-fill the
 * developer fields client-side) and the active workflow templates, then renders
 * the client form which calls createWorkflow() server action on submit.
 */
export default async function StartWorkflowPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id, locale')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) return null

  const tenantId = profile.tenant_id as string
  const locale = ((profile.locale as Locale) ?? 'ar')

  // Disbursement Document Review template id (seeded). We still load all
  // active templates so this scales when more templates are added — it's just
  // pre-selected as the default in the form.
  const DEFAULT_TEMPLATE_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

  const [clientsRes, templatesRes] = await Promise.all([
    svc
      .from('clients')
      .select('id, name, primary_contact_name, primary_contact_email')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .order('name', { ascending: true }),
    svc
      .from('dms_workflow_templates')
      .select('id, name, description')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('name', { ascending: true }),
  ])

  const clients: ClientOption[] = (clientsRes.data ?? []).map((c) => ({
    id: c.id as string,
    name: (c.name as string) ?? '',
    primary_contact_name: (c.primary_contact_name as string | null) ?? null,
    primary_contact_email: (c.primary_contact_email as string | null) ?? null,
  }))

  const templates: TemplateOption[] = (templatesRes.data ?? []).map((t) => ({
    id: t.id as string,
    name: (t.name as string) ?? '',
    description: (t.description as string | null) ?? null,
  }))

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back link */}
      <Link
        href="/app/dms/workflows"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" />
        {tServer('workflows.title', locale)}
      </Link>

      <header className="space-y-2">
        <h1 className="serif font-black text-2xl sm:text-3xl tracking-tight text-slate-900">
          {tServer('workflows.start.title', locale)}
        </h1>
        <p className="text-sm text-slate-500 max-w-2xl leading-relaxed">
          {tServer('workflows.start.subtitle', locale)}
        </p>
      </header>

      <StartWorkflowForm
        locale={locale}
        clients={clients}
        templates={templates}
        defaultTemplateId={
          templates.find((t) => t.id === DEFAULT_TEMPLATE_ID)?.id ??
          templates[0]?.id ??
          ''
        }
      />
    </div>
  )
}
