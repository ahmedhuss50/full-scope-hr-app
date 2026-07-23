import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Archive } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import type { ProjectLite } from '../_shared/shared-mapping'
import { HistoricalCasesImporter } from './HistoricalCasesImporter'

/**
 * Historical cases importer — loads past voucher/disbursement records
 * directly into dsb_cases as delivered/archived, bypassing the entire
 * review workflow. Owner-only.
 *
 * Every imported row is stamped `is_historical = true` so archive views
 * can display a "تاريخي" badge and other queries can exclude them from
 * workflow-scoped stats.
 */
export const dynamic = 'force-dynamic'

export default async function ImportHistoricalCasesPage() {
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
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-orange-700">
          <Archive className="w-4 h-4" aria-hidden="true" />
          استيراد الصرفيات السابقة (تاريخية)
        </div>
        <h1 className="serif font-black text-2xl tracking-tight text-slate-900">
          استيراد الصرفيات التاريخية
        </h1>
        <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">
          سجّل الصرفيات السابقة التي تمت خارج النظام (كسندات ورقية أو من
          أنظمة قديمة) مباشرةً في الأرشيف. تُدرج كطلبات مؤرشَفة (مسلَّمة)
          دون المرور بمسار المراجعة، وتُميَّز بشارة «تاريخي» في الأرشيف.
        </p>
      </header>

      <HistoricalCasesImporter projects={projects} />
    </div>
  )
}
