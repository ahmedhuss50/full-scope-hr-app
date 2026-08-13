import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  Archive,
  ArrowRight,
  Building2,
  Coins,
  FileSignature,
  FileSpreadsheet,
} from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

/**
 * Owner-only hub for the four master-list importers. Presents four cards
 * so the owner can update ONE dimension of a project's inventory at a time
 * (or all at once via the master importer).
 *
 * All four importers reuse the same AI column-mapping endpoint
 * (/api/dsb-units-map-columns) and match rows by (project_id, unit_number).
 */
export const dynamic = 'force-dynamic'

type CardConfig = {
  href: string
  title: string
  description: string
  Icon: typeof FileSpreadsheet
  accentCls: string
}

const CARDS: CardConfig[] = [
  {
    href: '/app/disbursements/admin/imports/units',
    title: 'قائمة الوحدات (المواصفات)',
    description:
      'استيراد أو تحديث مواصفات الوحدات فقط: البلوك، المنطقة، المساحة، الحي، المدينة. لا يمس بيانات المشترين أو العقود.',
    Icon: Building2,
    accentCls: 'border-teal-200 hover:border-teal-400 bg-teal-50/40',
  },
  {
    // Consolidated: what used to be two separate cards (buyers + contracts)
    // is now one path. The contracts importer accepts buyer fields since
    // the refactor, and post-import an AI linker attaches unit_id even
    // when the Excel doesn't reference an existing unit.
    href: '/app/disbursements/admin/imports/contracts',
    title: 'عقود المشترين',
    description:
      'استيراد بيانات العقود والمشترين معًا في ملف واحد: اسم المشتري، الجوال، الهوية، رقم العقد، تاريخ البيع، السعر، التمويل، حالة التسليم. الذكاء الاصطناعي يربط الصفوف تلقائيًا بالوحدات الموجودة بعد الاستيراد.',
    Icon: FileSignature,
    accentCls: 'border-violet-200 hover:border-violet-400 bg-violet-50/40',
  },
  {
    href: '/app/disbursements/admin/imports/master',
    title: 'القائمة الرئيسية (كل شيء دفعة واحدة)',
    description:
      'الاستيراد الشامل من ملف الأستاذ الكامل (٤ صفحات: نشطة، ملغاة/معاد، ملغاة، منجزة). يُنشئ الوحدات ويضيف سجلات البيع في خطوة واحدة.',
    Icon: FileSpreadsheet,
    accentCls: 'border-amber-200 hover:border-amber-400 bg-amber-50/40',
  },
  {
    href: '/app/disbursements/admin/imports/historical-cases',
    title: 'الصرفيات السابقة (تاريخية)',
    description:
      'استيراد سجلات الصرف القديمة (سندات، ملفات ورقية) مباشرةً كطلبات مؤرشَفة — تظهر في الأرشيف بشارة «تاريخي» بدون المرور بمسار المراجعة.',
    Icon: Archive,
    accentCls: 'border-orange-200 hover:border-orange-400 bg-orange-50/40',
  },
  {
    href: '/app/disbursements/admin/imports/payments',
    title: 'دفعات (سجل مالي)',
    description:
      'سجل المعاملات المالية المستقل — تاريخ الدفع، المبلغ، المستفيد، المرجع، طريقة الدفع. الربط بمشروع/حساب/طلب/وحدة اختياري.',
    Icon: Coins,
    accentCls: 'border-emerald-200 hover:border-emerald-400 bg-emerald-50/40',
  },
]

export default async function ImportsHubPage() {
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
  if (!['owner', 'supervisor', 'employee'].includes(profile.dsb_role ?? '')) {
    redirect('/app/disbursements/admin')
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto" dir="rtl">
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
          استيراد قوائم الوحدات
        </div>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          اختر نوع الاستيراد
        </h1>
        <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">
          كل الاستيرادات تطابق الصفوف بواسطة (المشروع + رقم الوحدة). استخدم
          الاستيرادات الجزئية عند تحديث بُعد واحد فقط، أو الاستيراد الرئيسي
          عند إدخال ملف الأستاذ الكامل لأول مرة.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className={`group block rounded-xl border ${card.accentCls} shadow-sm p-5 transition`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="inline-flex items-center gap-2">
                <card.Icon className="w-5 h-5 text-slate-700" aria-hidden="true" />
                <h2 className="serif font-bold text-base text-slate-900">
                  {card.title}
                </h2>
              </div>
              <ArrowRight
                className="w-4 h-4 text-slate-400 rotate-180 group-hover:text-slate-700 transition"
                aria-hidden="true"
              />
            </div>
            <p className="mt-2 text-xs text-slate-600 leading-relaxed">
              {card.description}
            </p>
            <div className="mt-4">
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-white text-xs font-semibold text-slate-800 border border-slate-200 group-hover:bg-slate-50 transition">
                فتح
                <ArrowRight className="w-3 h-3 rotate-180" aria-hidden="true" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
