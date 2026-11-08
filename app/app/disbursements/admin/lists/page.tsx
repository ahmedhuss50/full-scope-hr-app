import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ArrowRight,
  Building2,
  Coins,
  FileSignature,
  FileText,
  ListChecks,
  Users,
} from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

/**
 * Owner-only hub for the 5 tenant-wide list views (documents, payments,
 * buyers, contracts, units). Each card now shows a live row count so the
 * owner knows the size of each list before opening it.
 *
 * Mirrors the /imports hub pattern — pages still live at their own URLs for
 * direct linking; the hub + the shared ListsTabs give fast switching.
 */
export const dynamic = 'force-dynamic'

type CardConfig = {
  href: string
  title: string
  description: string
  Icon: typeof ListChecks
  accentCls: string
  count: number
}

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

  const tenantId = profile.tenant_id as string

  // Live counts per list — one count query each, all run in parallel. Each
  // returns { count: number | null } with head:true so we never ship rows
  // across the wire for a number the hub only displays as a chip.
  const [
    unitsCountRes,
    buyersCountRes,
    contractsCountRes,
    paymentsCountRes,
    docsCountRes,
  ] = await Promise.all([
    svc.from('dsb_project_units').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    svc.from('dsb_unit_sales')   .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).not('buyer_name_ar', 'is', null),
    svc.from('dsb_unit_sales')   .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    svc.from('dsb_payments')     .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    svc.from('dsb_cases')        .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
  ])
  const unitsCount     = unitsCountRes.count     ?? 0
  const buyersCount    = buyersCountRes.count    ?? 0
  const contractsCount = contractsCountRes.count ?? 0
  const paymentsCount  = paymentsCountRes.count  ?? 0
  const docsCount      = docsCountRes.count      ?? 0

  const cards: CardConfig[] = [
    {
      href: '/app/disbursements/documents',
      title: 'سجل الوثائق',
      description: 'كل وثائق الصرف (الطلبات) عبر كل المشاريع — موقّعة، قيد المراجعة، مرفوضة، أرشيف.',
      Icon: FileText,
      accentCls: 'border-slate-200 hover:border-slate-400 bg-slate-50/40',
      count: docsCount,
    },
    {
      href: '/app/disbursements/admin/lists/payments',
      title: 'الدفعات',
      description: 'السجل المالي — كل التحصيلات والدفعات، بإمكانية الفلترة حسب المشروع/الحساب/العقد.',
      Icon: Coins,
      accentCls: 'border-emerald-200 hover:border-emerald-400 bg-emerald-50/40',
      count: paymentsCount,
    },
    {
      href: '/app/disbursements/admin/lists/buyers',
      title: 'المشترون',
      description: 'كل المشترين عبر المشاريع مع بيانات الهوية والجوال وحالة البيع.',
      Icon: Users,
      accentCls: 'border-blue-200 hover:border-blue-400 bg-blue-50/40',
      count: buyersCount,
    },
    {
      href: '/app/disbursements/admin/lists/contracts',
      title: 'العقود',
      description: 'كل العقود مع تفاصيل السعر والتمويل والتسليم والأعمدة المالية.',
      Icon: FileSignature,
      accentCls: 'border-violet-200 hover:border-violet-400 bg-violet-50/40',
      count: contractsCount,
    },
    {
      href: '/app/disbursements/admin/lists/units',
      title: 'الوحدات',
      description: 'كل الوحدات في المؤسسة مع مواصفاتها وعدد مرات البيع.',
      Icon: Building2,
      accentCls: 'border-teal-200 hover:border-teal-400 bg-teal-50/40',
      count: unitsCount,
    },
  ]

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
          السجلات
        </div>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          استعراض القوائم
        </h1>
        <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">
          عرض موحد لكل البيانات على مستوى المؤسسة. كل قائمة فيها فلاتر، بحث، ترتيب، وتحديد جماعي للحذف.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
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
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white text-xs font-mono font-semibold text-slate-700 ring-1 ring-slate-200">
                {card.count.toLocaleString('en-US')}
              </span>
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
