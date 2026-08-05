import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, FileSignature } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import type { ProjectLite } from '../_shared/shared-mapping'
import { ContractsImporter } from './ContractsImporter'

/**
 * Focused importer #3 — contracts only.
 *
 * For each row (matched by project + unit_number), update the ACTIVE
 * dsb_unit_sales row's contract + pricing + delivery fields; insert a new
 * active sale if none exists. Rows for missing units are flagged.
 *
 * Owner-only.
 */
export const dynamic = 'force-dynamic'

export default async function ImportContractsPage({
  searchParams,
}: {
  searchParams?: { project?: string }
}) {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) redirect('/login')
  if (profile.dsb_role !== 'owner') redirect('/app/disbursements/admin')

  const tenantId = profile.tenant_id as string
  const { data: projsRes } = await svc
    .from('dsb_projects')
    .select('id, name_ar, developer_id, code')
    .eq('tenant_id', tenantId)
    .order('name_ar', { ascending: true })
  const projects: ProjectLite[] = (
    (projsRes ?? []) as Array<{ id: string; name_ar: string; developer_id: string | null }>
  ).map((p) => ({ id: p.id, name_ar: p.name_ar, developer_id: p.developer_id }))

  // Optional project-scope: when navigated from a project page, the import
  // locks to that project so the operator doesn't have to pick from the
  // dropdown and the file's rows all attach to the right project.
  const lockedProjectId = (searchParams?.project ?? '').trim() || null
  const lockedProject = lockedProjectId
    ? (
        ((projsRes ?? []) as Array<{ id: string; name_ar: string; code: string }>).find(
          (p) => p.id === lockedProjectId,
        ) ?? null
      )
    : null
  // If a project id was passed but doesn't belong to this tenant, ignore it.
  const effectiveLockedId = lockedProject ? lockedProject.id : null

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      <header className="space-y-2">
        <Link
          href={
            effectiveLockedId
              ? `/app/disbursements/admin/projects/${effectiveLockedId}`
              : '/app/disbursements/admin/imports'
          }
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          <ArrowRight className="w-3.5 h-3.5 ms-1 rotate-180" aria-hidden="true" />
          {effectiveLockedId ? 'العودة إلى المشروع' : 'العودة إلى قائمة الاستيرادات'}
        </Link>
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-violet-700">
          <FileSignature className="w-4 h-4" aria-hidden="true" />
          استيراد عقود ومشترين
        </div>
        <h1 className="serif font-black text-2xl tracking-tight text-slate-900">
          {lockedProject ? `عقود ومشترين — ${lockedProject.name_ar}` : 'تحديث بيانات العقود'}
        </h1>
        <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">
          {lockedProject
            ? `كل الصفوف ستُنسب تلقائيًا إلى مشروع «${lockedProject.name_ar}». بعد الاستيراد، يعمل الذكاء الاصطناعي على ربط العقود بالوحدات.`
            : 'يحدّث بيانات العقد وتاريخ البيع والسعر والتمويل وحالة التسليم. بعد الاستيراد، يعمل الذكاء الاصطناعي على ربط العقود بالوحدات في كل مشروع تم استيراد صفوف له.'}
        </p>
      </header>

      <ContractsImporter projects={projects} lockedProjectId={effectiveLockedId} />
    </div>
  )
}
