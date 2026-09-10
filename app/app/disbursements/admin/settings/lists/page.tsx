/**
 * القوائم والنسب — Lists & Percentages admin page (owner-only).
 *
 * Read-only overviews of the two enum-shaped lists (deposit categories +
 * disbursement types) plus the editable buyer-deposit distribution
 * shares. Changing the shares here overrides the 76/20/4 defaults for
 * this tenant.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, ListChecks } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { SharesEditor } from './SharesEditor'
import type { DistributionShares } from './actions'

export const dynamic = 'force-dynamic'

// Kept in sync with DepositCategoryPicker.OPTIONS (see the payments list
// component). Read-only here — changing values in the DB would require an
// enum-tolerance change across imports + tabs.
const DEPOSIT_CATEGORIES: Array<{ code: string; label: string; description: string; tone: string }> = [
  { code: 'buyer_collection', label: 'تحصيل مشتري',   description: 'أي إيداع من مشتري (يخضع لنسب التوزيع).',                 tone: 'bg-teal-50 text-teal-800 ring-teal-200' },
  { code: 'wrong_transfer',   label: 'حوالة خاطئة',   description: 'حوالات وردت بالخطأ وتُستَرد.',                              tone: 'bg-red-50 text-red-800 ring-red-200' },
  { code: 'self_financing',   label: 'تمويل ذاتي',     description: 'ضخ من المطور بدون قرض بنكي.',                              tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  { code: 'bank_financing',   label: 'تمويل بنكي',     description: 'قرض تنموي أو تمويل مؤسسي.',                                tone: 'bg-indigo-50 text-indigo-800 ring-indigo-200' },
  { code: 'other',            label: 'أخرى',           description: 'أي إيداع لا يندرج تحت التصنيفات أعلاه.',                    tone: 'bg-slate-50 text-slate-800 ring-slate-200' },
]

// Kept in sync with /api/dsb-extract prompt (disbursement_type_code enum).
const DISBURSEMENT_TYPES: Array<{ code: string; label_ar: string }> = [
  { code: 'construction',           label_ar: 'إنشائي (مقاول رئيسي، بنية تحتية، مواد)' },
  { code: 'admin_marketing',        label_ar: 'إداري / تسويقي (رواتب، عمولات، أتعاب)' },
  { code: 'bank_financing',         label_ar: 'تمويل بنكي' },
  { code: 'moh_incentive',          label_ar: 'حوافز وزارة الإسكان' },
  { code: 'unit_seriousness_fees',  label_ar: 'رسوم جدية شراء وحدة' },
  { code: 'vat_project_registry',   label_ar: 'ضريبة قيمة مضافة — تسجيل مشروع' },
  { code: 'vat_sales_payment',      label_ar: 'ضريبة قيمة مضافة — دفعة بيع' },
  { code: 'other',                  label_ar: 'أخرى' },
]

export default async function ListsAndPercentagesPage() {
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
  if ((profile.dsb_role as string | null) !== 'owner') {
    redirect('/app/disbursements/admin')
  }

  const { data: tenantRow } = await svc
    .from('tenants')
    .select('deposit_distribution_shares')
    .eq('id', profile.tenant_id as string)
    .maybeSingle()

  const rawShares = tenantRow?.deposit_distribution_shares as Partial<DistributionShares> | null | undefined
  const shares: DistributionShares = {
    construction:    rawShares?.construction    ?? 0.76,
    admin_marketing: rawShares?.admin_marketing ?? 0.20,
    escrow:          rawShares?.escrow          ?? 0.04,
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto" dir="rtl">
      <Link
        href="/app/disbursements/admin"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        العودة إلى الإدارة
      </Link>

      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <ListChecks className="w-4 h-4" aria-hidden="true" />
          الإدارة
        </div>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          القوائم والنسب
        </h1>
        <p className="text-sm text-slate-600">
          القوائم المستخدَمة عبر النظام والنسب المحاسبية لتوزيع تحصيل المشترين.
        </p>
      </header>

      {/* Distribution shares — editable */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-3">
        <div>
          <h2 className="serif font-bold text-base text-slate-900">نسب توزيع تحصيل المشترين</h2>
          <p className="text-xs text-slate-500 mt-1">
            كل دفعة مصنَّفة «تحصيل مشتري» تُوزَّع منطقيًا وفق هذه النسب على الحسابات الفرعية.
            تحديث النسب هنا يعكس على شاشة الدفعات، حساب الضمان، وتنبيهات الرئيسية.
          </p>
        </div>
        <SharesEditor initial={shares} />
      </section>

      {/* Deposit categories — read-only */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-3">
        <div>
          <h2 className="serif font-bold text-base text-slate-900">تصنيفات الإيداع</h2>
          <p className="text-xs text-slate-500 mt-1">
            التصنيفات المستخدَمة في تبويبات سجل الدفعات. تعديل القائمة يتطلَّب تحديث نظامي (تواصل مع الدعم).
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {DEPOSIT_CATEGORIES.map((c) => (
            <div key={c.code} className="rounded-lg border border-slate-200 p-3 flex items-start gap-3">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ring-1 ring-inset shrink-0 ${c.tone}`}>
                {c.label}
              </span>
              <div className="min-w-0">
                <div className="text-xs text-slate-700 leading-relaxed">{c.description}</div>
                <div className="text-[10px] font-mono text-slate-400 mt-1" dir="ltr">{c.code}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Disbursement types — read-only */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-3">
        <div>
          <h2 className="serif font-bold text-base text-slate-900">أنواع الصرف (نوع الصرف)</h2>
          <p className="text-xs text-slate-500 mt-1">
            القائمة التي يستخدمها الذكاء الاصطناعي لتصنيف سندات الصرف تلقائيًا. القيم مثبّتة على مستوى النظام لضمان توافق التقارير.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-right">
              <tr>
                <th className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase">الاسم</th>
                <th className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase">الكود</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {DISBURSEMENT_TYPES.map((t) => (
                <tr key={t.code}>
                  <td className="px-3 py-2 text-slate-800">{t.label_ar}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500" dir="ltr">{t.code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
