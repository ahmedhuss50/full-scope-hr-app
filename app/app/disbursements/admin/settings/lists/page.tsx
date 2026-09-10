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
import { VendorCategoriesEditor, type VendorCategory } from './VendorCategoriesEditor'
import { LabelListEditor, type LabelRow } from './LabelListEditor'
import type { DistributionShares } from './actions'
import {
  DEPOSIT_CATEGORY_DEFAULTS,
  DISBURSEMENT_TYPE_DEFAULTS,
} from '@/lib/dsb/category-labels'

export const dynamic = 'force-dynamic'

// Deposit + disbursement rows come from DEPOSIT_CATEGORY_DEFAULTS /
// DISBURSEMENT_TYPE_DEFAULTS in lib/dsb/category-labels.ts. The
// LabelListEditor merges those defaults with the tenant's saved overrides
// (tenants.deposit_category_labels / .disbursement_type_labels).

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

  const [tenantRes, vendorCatsRes] = await Promise.all([
    svc
      .from('tenants')
      .select('deposit_distribution_shares, deposit_category_labels, disbursement_type_labels')
      .eq('id', profile.tenant_id as string)
      .maybeSingle(),
    svc
      .from('dsb_vendor_categories')
      .select('id, name_ar')
      .eq('tenant_id', profile.tenant_id as string)
      .order('sort_order', { ascending: true })
      .order('name_ar',    { ascending: true }),
  ])

  const rawShares = tenantRes.data?.deposit_distribution_shares as Partial<DistributionShares> | null | undefined
  const shares: DistributionShares = {
    construction:    rawShares?.construction    ?? 0.76,
    admin_marketing: rawShares?.admin_marketing ?? 0.20,
    escrow:          rawShares?.escrow          ?? 0.04,
  }
  const vendorCategories = ((vendorCatsRes.data ?? []) as VendorCategory[])
  const depositLabelOverrides      = (tenantRes.data?.deposit_category_labels    as Record<string, string> | null | undefined) ?? {}
  const disbursementLabelOverrides = (tenantRes.data?.disbursement_type_labels   as Record<string, string> | null | undefined) ?? {}

  // Build the LabelRow arrays for both fixed-enum lists. The tones on the
  // deposit rows carry over so the pill in the preview matches what the
  // payments list shows.
  const depositRows: LabelRow[] = [
    { code: 'buyer_collection', defaultLabel: DEPOSIT_CATEGORY_DEFAULTS.buyer_collection, description: 'أي إيداع من مشتري (يخضع لنسب التوزيع).',           toneCls: 'bg-teal-50 text-teal-800 ring-teal-200' },
    { code: 'wrong_transfer',   defaultLabel: DEPOSIT_CATEGORY_DEFAULTS.wrong_transfer,   description: 'حوالات وردت بالخطأ وتُستَرد.',                        toneCls: 'bg-red-50 text-red-800 ring-red-200' },
    { code: 'self_financing',   defaultLabel: DEPOSIT_CATEGORY_DEFAULTS.self_financing,   description: 'ضخ من المطور بدون قرض بنكي.',                        toneCls: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
    { code: 'bank_financing',   defaultLabel: DEPOSIT_CATEGORY_DEFAULTS.bank_financing,   description: 'قرض تنموي أو تمويل مؤسسي.',                          toneCls: 'bg-indigo-50 text-indigo-800 ring-indigo-200' },
    { code: 'other',            defaultLabel: DEPOSIT_CATEGORY_DEFAULTS.other,            description: 'أي إيداع لا يندرج تحت التصنيفات أعلاه.',              toneCls: 'bg-slate-50 text-slate-800 ring-slate-200' },
  ]
  const disbursementRows: LabelRow[] = [
    { code: 'construction',          defaultLabel: DISBURSEMENT_TYPE_DEFAULTS.construction },
    { code: 'admin_marketing',       defaultLabel: DISBURSEMENT_TYPE_DEFAULTS.admin_marketing },
    { code: 'bank_financing',        defaultLabel: DISBURSEMENT_TYPE_DEFAULTS.bank_financing },
    { code: 'moh_incentive',         defaultLabel: DISBURSEMENT_TYPE_DEFAULTS.moh_incentive },
    { code: 'unit_seriousness_fees', defaultLabel: DISBURSEMENT_TYPE_DEFAULTS.unit_seriousness_fees },
    { code: 'vat_project_registry',  defaultLabel: DISBURSEMENT_TYPE_DEFAULTS.vat_project_registry },
    { code: 'vat_sales_payment',     defaultLabel: DISBURSEMENT_TYPE_DEFAULTS.vat_sales_payment },
    { code: 'other',                 defaultLabel: DISBURSEMENT_TYPE_DEFAULTS.other },
  ]

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

      {/* Vendor / service-provider categories — CRUD */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-3">
        <div>
          <h2 className="serif font-bold text-base text-slate-900">تصنيفات الموردين ومقدمي الخدمات</h2>
          <p className="text-xs text-slate-500 mt-1">
            أضِف وعدِّل التصنيفات التي تُستخدم لتنظيم الموردين ومقدمي الخدمات على مستوى كل المشاريع.
            التصنيف الذي يُستخدَم من قِبل أي مورد لا يمكن حذفه حتى يُغيَّر تصنيف ذاك المورد.
          </p>
        </div>
        <VendorCategoriesEditor initial={vendorCategories} />
      </section>

      {/* Deposit categories — editable labels (codes fixed) */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-3">
        <div>
          <h2 className="serif font-bold text-base text-slate-900">تصنيفات الإيداع</h2>
          <p className="text-xs text-slate-500 mt-1">
            التصنيفات المستخدَمة في تبويبات سجل الدفعات. يمكنك إعادة تسمية أي تصنيف —
            التغيير ينعكس على كل الشاشات والتقارير. أكواد النظام تبقى ثابتة لضمان توافق البيانات المستوردة.
          </p>
        </div>
        <LabelListEditor kind="deposit" rows={depositRows} overrides={depositLabelOverrides} />
      </section>

      {/* Disbursement types — editable labels (codes fixed) */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-3">
        <div>
          <h2 className="serif font-bold text-base text-slate-900">أنواع الصرف (نوع الصرف)</h2>
          <p className="text-xs text-slate-500 mt-1">
            القائمة التي يستخدمها الذكاء الاصطناعي لتصنيف سندات الصرف تلقائيًا. يمكن إعادة التسمية —
            الأكواد تبقى ثابتة لضمان دقة التصنيف الآلي.
          </p>
        </div>
        <LabelListEditor kind="disbursement" rows={disbursementRows} overrides={disbursementLabelOverrides} />
      </section>
    </div>
  )
}
