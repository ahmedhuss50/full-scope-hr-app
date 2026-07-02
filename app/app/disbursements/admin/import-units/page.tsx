import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ArrowRight, FileSpreadsheet } from 'lucide-react'
import { UnitsImporter, type ProjectLite } from './UnitsImporter'

/**
 * Tenant-wide bulk import of real-estate units + buyers + sales history.
 *
 * The user maintains one Excel workbook per project (4 fixed sheets: active,
 * cancelled+resold, cancelled, completed). Owner drops a file — the client
 * fuzzy-matches the "اسم المشروع" column to a `dsb_projects.name_ar`, shows
 * a preview so the owner can fix any mismatches, then bulkImportUnitsFromRows
 * upserts units + inserts sales in one call.
 *
 * Owner-only.
 */
export const dynamic = 'force-dynamic'

export default async function ImportUnitsPage() {
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
  if (profile.dsb_role !== 'owner') {
    redirect('/app/disbursements/admin')
  }

  const tenantId = profile.tenant_id as string

  // Universe of projects the parser will fuzzy-match against.
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
          href="/app/disbursements/admin"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          <ArrowRight className="w-3.5 h-3.5 ms-1 rotate-180" aria-hidden="true" />
          العودة إلى الإدارة
        </Link>
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />
          استيراد قائمة الوحدات والمشترين
        </div>
        <h1 className="serif font-black text-2xl tracking-tight text-slate-900">
          استيراد من ملف الأستاذ
        </h1>
        <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">
          ارفع ملف Excel الرئيسي للمشروع (٤ صفحات: سجل المشترين النشطين،
          الوحدات الملغية والمعاد بيعها، الوحدات الملغية، والوحدات المنجزة).
          سيتم قراءة الأعمدة تلقائيًا ومطابقة اسم المشروع مع القائمة، مع
          إمكانية تعديل المطابقة يدويًا قبل التأكيد.
        </p>
      </header>

      <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-700 space-y-2">
        <div className="font-semibold text-slate-900">تنسيق الملف المتوقع:</div>
        <ul className="list-disc ms-5 space-y-1">
          <li>الصفحة 1 «سجل المشترين وحدات قائمة» — العنوان في الصف 7، البيانات من الصف 8.</li>
          <li>الصفحات 2–4 — العنوان في الصف 1، البيانات من الصف 2.</li>
          <li>يتم استخراج: العميل، الهوية، رقم الوحدة، رقم العقد، السعر، تاريخ البيع، حالة التسليم…إلخ.</li>
          <li>الصفوف بدون اسم عميل ورقم وحدة تُتجاهل تلقائيًا.</li>
        </ul>
      </section>

      <UnitsImporter projects={projects} />
    </div>
  )
}
