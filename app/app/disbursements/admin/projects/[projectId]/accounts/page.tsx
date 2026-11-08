/**
 * Project · الحسابات — dedicated tab for bank + escrow accounts.
 *
 * Carved out of the overview page as part of the project-tabs reorg so each
 * entity type gets its own focus surface. Reuses the existing
 * ProjectAccountsSection component (unchanged) with the same data load.
 */
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ProjectAccountsSection, type ProjectAccount } from '../ProjectAccountsSection'
import { assignedProjectIds, canAccessProject } from '@/lib/dsb/access'

export const dynamic = 'force-dynamic'

export default async function ProjectAccountsPage({
  params,
}: {
  params: { projectId: string }
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

  const tenantId = profile.tenant_id as string
  const dsbRole = profile.dsb_role as string | null

  const allowedIds = await assignedProjectIds({
    svc,
    tenantId,
    userId: profile.id as string,
    dsbRole,
  })
  if (!canAccessProject(allowedIds, params.projectId)) redirect('/app/disbursements')

  const { data: project } = await svc
    .from('dsb_projects')
    .select('id, tenant_id')
    .eq('id', params.projectId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!project) redirect('/app/disbursements/admin/projects')

  const { data: accountsRaw } = await svc
    .from('dsb_project_accounts')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('project_id', params.projectId)
    .order('is_default', { ascending: false })
    .order('label', { ascending: true })
  const accounts = ((accountsRaw ?? []) as unknown as ProjectAccount[])
  void dsbRole

  return (
    <div className="space-y-4 max-w-6xl mx-auto px-4 pb-6" dir="rtl">
      <ProjectAccountsSection
        projectId={params.projectId}
        initialAccounts={accounts}
      />
    </div>
  )
}
