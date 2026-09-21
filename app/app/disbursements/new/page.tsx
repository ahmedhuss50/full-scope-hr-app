import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { NewCaseForm, type DeveloperOption, type ProjectOption, type DisbursementTypeOption } from './NewCaseForm'
import { DISBURSEMENT_TYPE_DEFAULTS, resolveDisbursementLabel } from '@/lib/dsb/category-labels'

export const dynamic = 'force-dynamic'

export default async function StaffNewCasePage({
  searchParams,
}: {
  searchParams?: { developer?: string; project?: string }
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
  // Deliverer can upload new cases too. Viewer cannot — they're read-only.
  if (!dsbRole || !['employee', 'supervisor', 'owner', 'deliverer'].includes(dsbRole)) {
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
    .select('id, code, name_ar, developer_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('code', { ascending: true })
  const projects: ProjectOption[] = (
    (projectsRaw ?? []) as { id: string; code: string; name_ar: string; developer_id: string | null }[]
  ).map((p) => ({ id: p.id, code: p.code, name_ar: p.name_ar, developer_id: p.developer_id }))

  // Disbursement-type dropdown (نوع الصرف). Merge shipped defaults + tenant
  // JSONB overrides + custom codes minus hidden ones.
  let dsbTypeOverrides: Record<string, string> = {}
  let dsbTypeHidden: string[] = []
  try {
    const tenantRes = await svc
      .from('tenants')
      .select('disbursement_type_labels, disbursement_type_hidden')
      .eq('id', tenantId)
      .maybeSingle()
    if (!tenantRes.error && tenantRes.data) {
      const t = tenantRes.data as {
        disbursement_type_labels: Record<string, string> | null
        disbursement_type_hidden: string[] | null
      }
      dsbTypeOverrides = (t.disbursement_type_labels ?? {}) as Record<string, string>
      dsbTypeHidden    = Array.isArray(t.disbursement_type_hidden) ? t.disbursement_type_hidden : []
    }
  } catch { /* fall back to defaults */ }
  const hiddenSet = new Set(dsbTypeHidden)
  const defaultCodes = Object.keys(DISBURSEMENT_TYPE_DEFAULTS)
  const customCodes  = Object.keys(dsbTypeOverrides).filter((c) => c.startsWith('custom_'))
  const disbursementTypes: DisbursementTypeOption[] = [...defaultCodes, ...customCodes]
    .filter((code) => !hiddenSet.has(code))
    .map((code) => ({ code, label: resolveDisbursementLabel(code, dsbTypeOverrides) }))

  const noClients = developers.length === 0
  const noProjects = projects.length === 0

  // Optional pre-selection from the query string. Only honour values that
  // match the data we just loaded — never trust unverified IDs.
  const defaultDeveloperId =
    searchParams?.developer && developers.some((d) => d.id === searchParams.developer)
      ? searchParams.developer
      : null
  const defaultProjectId =
    searchParams?.project && projects.some((p) => p.id === searchParams.project)
      ? searchParams.project
      : null

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
        <NewCaseForm
          developers={developers}
          projects={projects}
          disbursementTypes={disbursementTypes}
          defaultDeveloperId={defaultDeveloperId}
          defaultProjectId={defaultProjectId}
        />
      )}
    </div>
  )
}
