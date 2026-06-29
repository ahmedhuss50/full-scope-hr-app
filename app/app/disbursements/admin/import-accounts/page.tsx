import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ArrowRight, FileSpreadsheet } from 'lucide-react'
import { AccountsImporter, type DeveloperLite, type ProjectLite } from './AccountsImporter'

/**
 * Tenant-wide bulk import of project payment accounts.
 *
 * The existing per-project upload (in ProjectAccountsSection) takes a file
 * scoped to one project. For datasets where every row already specifies
 * which project it belongs to, this page is the right tool — it parses the
 * whole sheet, auto-matches each row to a project by developer+project name,
 * lets the owner fix mismatches, then sends one bulk insert.
 *
 * Owner-only.
 */
export const dynamic = 'force-dynamic'

export default async function ImportAccountsPage() {
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

  // Load the universe of developers + projects the parser will match against.
  const [devsRes, projsRes] = await Promise.all([
    svc
      .from('dsb_developers')
      .select('id, company_name_ar')
      .eq('tenant_id', tenantId)
      .order('company_name_ar', { ascending: true }),
    svc
      .from('dsb_projects')
      .select('id, name_ar, developer_id')
      .eq('tenant_id', tenantId)
      .order('name_ar', { ascending: true }),
  ])

  const developers: DeveloperLite[] = ((devsRes.data ?? []) as Array<{ id: string; company_name_ar: string }>)
    .map((d) => ({ id: d.id, company_name_ar: d.company_name_ar }))
  const projects: ProjectLite[] = ((projsRes.data ?? []) as Array<{ id: string; name_ar: string; developer_id: string | null }>)
    .map((p) => ({ id: p.id, name_ar: p.name_ar, developer_id: p.developer_id }))

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      <header className="space-y-2">
        <Link
          href="/app/disbursements/admin"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          ← العودة إلى الإدارة
        </Link>
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />
          استيراد حسابات الدفع للمشاريع
        </div>
        <h1 className="serif font-black text-2xl tracking-tight text-slate-900">
          استيراد جماعي
        </h1>
        <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">
          ارفع ملف Excel يحتوي على حسابات الدفع لجميع المشاريع. سيتم مطابقة
          كل صف مع المشروع الصحيح تلقائيًا بناءً على اسم المطور واسم المشروع.
          يمكنك مراجعة المطابقات قبل التأكيد وتعديل أي صف يدويًا.
        </p>
      </header>

      <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-700">
        <div className="font-semibold mb-2 text-slate-900">صيغة الملف المتوقعة:</div>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 font-mono text-[11px]">
          <Cell head>A: رقم الحساب</Cell>
          <Cell head>B: نوع الحساب</Cell>
          <Cell head>C: اسم المطور</Cell>
          <Cell head>D: المشروع</Cell>
          <Cell head>E: اسم البنك</Cell>
        </div>
        <p className="mt-2 text-slate-600">
          الصف الأول يُعتبر عنوانًا ويتم تجاهله. الصفوف التي يكون رقم الحساب
          فيها فارغًا أو يحوي "—" تُتخطّى تلقائيًا.
        </p>
        <p className="mt-1 text-slate-600 inline-flex items-center gap-1">
          <ArrowRight className="w-3 h-3" aria-hidden="true" />
          يتم تخزين اسم الحساب على هيئة:
          <span className="font-mono bg-white border border-slate-200 px-1.5 rounded">
            {"{نوع الحساب} — {البنك}"}
          </span>
        </p>
      </section>

      <AccountsImporter developers={developers} projects={projects} />
    </div>
  )
}

function Cell({ children, head }: { children: React.ReactNode; head?: boolean }) {
  return (
    <div className={`px-2 py-1.5 rounded border ${head ? 'border-slate-300 bg-white text-slate-900 font-semibold' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
      {children}
    </div>
  )
}
