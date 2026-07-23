import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ArrowRight,
  Building2,
  FileSignature,
  ListChecks,
  Users,
} from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

/**
 * Owner-only hub for the three tenant-wide list views (units, buyers,
 * contracts). Mirrors the /imports hub pattern — each card links to a
 * paginated table with filters + search + sort.
 *
 * Purpose: the per-project «الوحدات والمشترون» section on a project page
 * mixes all three dimensions and is scoped to one project. The lists here
 * let the owner browse ONE dimension across the whole tenant at a time.
 */
export const dynamic = 'force-dynamic'

type CardConfig = {
  href: string
  title: string
  description: string
  Icon: typeof ListChecks
  accentCls: string
}

const CARDS: CardConfig[] = [
  {
    href: '/app/disbursements/admin/lists/units',
    title: 'الوحدات',
    description:
      'قائمة كل الوحدات في كل المشاريع مع مواصفاتها (البلوك، المنطقة، المساحة، الحي) وعدد مرات البيع.',
    Icon: Building2,
    accentCls: 'border-teal-200 hover:border-teal-400 bg-teal-50/40',
  },
  {
    href: '/app/disbursements/admin/lists/buyers',
    title: 'المشترون',
    description:
      'قائمة كل المشترين عبر جميع المشاريع مع بيانات الهوية والجوال وحالة البيع.',
    Icon: Users,
    accentCls: 'border-blue-200 hover:border-blue-400 bg-blue-50/40',
  },
  {
    href: '/app/disbursements/admin/lists/contracts',
    title: 'العقود',
    description:
      'قائمة كل العقود مع تفاصيل السعر والتمويل والتسليم، إضافةً إلى الأعمدة المالية (النسبة المستقطعة، نسبة التحصيل).',
    Icon: FileSignature,
    accentCls: 'border-violet-200 hover:border-violet-400 bg-violet-50/40',
  },
]

export default async function ListsHubPage() {
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
  if (profile.dsb_role !== 'owner') {
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
          <ListChecks className="w-4 h-4" aria-hidden="true" />
          القوائم الكاملة على مستوى المؤسسة
        </div>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          استعراض القوائم
        </h1>
        <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">
          كل قائمة هنا مستقلة عن المشروع الواحد وتشمل جميع الوحدات في المؤسسة.
          للاستيراد الأولي أو تحديث بُعد واحد، استخدم «أداة الاستيراد».
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
