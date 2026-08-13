import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Users } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import type { ProjectLite } from '../_shared/shared-mapping'
import { BuyersImporter } from './BuyersImporter'

/**
 * Focused importer #2 — buyers only.
 *
 * For each row (matched by project + unit_number), update the ACTIVE
 * dsb_unit_sales row's buyer fields; if no active sale exists, insert one.
 * Rows whose unit doesn't exist in dsb_project_units are flagged in the
 * preview with an amber warning (owner should run the units importer first).
 *
 * Owner-only.
 */
export const dynamic = 'force-dynamic'

export default async function ImportBuyersPage() {
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
  // Task #185: staff can import for their assigned projects — server actions scope-check rows.
  if (!['owner', 'supervisor', 'employee'].includes(profile.dsb_role ?? '')) redirect('/app/disbursements/admin')

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
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700">
          <Users className="w-4 h-4" aria-hidden="true" />
          استيراد قائمة المشترين
        </div>
        <h1 className="serif font-black text-2xl tracking-tight text-slate-900">
          تحديث بيانات المشترين
        </h1>
        <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">
          يبحث عن الوحدة برقمها في المشروع، ثم يحدّث بيانات المشتري في سجل
          البيع النشط (الاسم، الهوية، الجنسية، الجوال). إذا لم يوجد سجل بيع
          نشط للوحدة، يُنشأ سجل جديد. الوحدات غير الموجودة تُبرز في المعاينة.
        </p>
      </header>

      <BuyersImporter projects={projects} />
    </div>
  )
}
