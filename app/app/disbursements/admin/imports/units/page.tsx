import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Building2 } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import type { ProjectLite } from '../_shared/shared-mapping'
import { UnitsOnlyImporter } from './UnitsOnlyImporter'

/**
 * Focused importer #1 — unit specs only.
 *
 * Upserts into dsb_project_units and never touches dsb_unit_sales. Use case:
 * the physical inventory list changed (added a block, corrected an area)
 * and the owner wants to update specs without disturbing buyer/contract
 * data already recorded against those units.
 *
 * Owner-only.
 */
export const dynamic = 'force-dynamic'

export default async function ImportUnitsOnlyPage() {
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
    .select('id, name_ar, developer_id')
    .eq('tenant_id', tenantId)
    .order('name_ar', { ascending: true })
  const projects: ProjectLite[] = (
    (projsRes ?? []) as Array<{ id: string; name_ar: string; developer_id: string | null }>
  ).map((p) => ({ id: p.id, name_ar: p.name_ar, developer_id: p.developer_id }))

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      <header className="space-y-2">
        <Link
          href="/app/disbursements/admin/imports"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          <ArrowRight className="w-3.5 h-3.5 ms-1 rotate-180" aria-hidden="true" />
          العودة إلى قائمة الاستيرادات
        </Link>
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <Building2 className="w-4 h-4" aria-hidden="true" />
          استيراد قائمة الوحدات (المواصفات)
        </div>
        <h1 className="serif font-black text-2xl tracking-tight text-slate-900">
          استيراد مواصفات الوحدات
        </h1>
        <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">
          يستورد أو يحدّث مواصفات الوحدات في المشروع فقط (البلوك، المنطقة،
          المساحة، الحي، المدينة). لا يمس بيانات المشترين أو العقود
          المرتبطة بالوحدات.
        </p>
      </header>

      <UnitsOnlyImporter projects={projects} />
    </div>
  )
}
