import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { Link2 } from 'lucide-react'
import { RelinkRunner } from './RelinkRunner'

export const dynamic = 'force-dynamic'

/**
 * Batch re-extraction admin page.
 *
 * One-shot backfill tool for the ~200 cases that were AI-extracted BEFORE
 * the prompt was updated to capture unit_number / contract_number /
 * buyer_name_ar. Re-runs extraction on each with skip_sections=true so the
 * auto-linker can fill in unit_id / sale_id / contract_id without
 * duplicating the breakdown sections that already exist.
 *
 * Owner-only. Shows the unlinked count up front and delegates the actual
 * batch processing to a client component that calls /api/dsb-relink-batch
 * and streams results in-place.
 */
export default async function RelinkAdminPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id, dsb_role')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile || (profile.dsb_role as string) !== 'owner') {
    redirect('/app/disbursements')
  }

  const tenantId = profile.tenant_id as string

  // Counts up front so the operator sees the scope before firing anything.
  const { count: totalExtracted } = await svc
    .from('dsb_cases')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .not('extracted_at', 'is', null)

  const { count: unlinkedCount } = await svc
    .from('dsb_cases')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .is('unit_id', null)
    .not('extracted_at', 'is', null)

  // Projects list for the optional narrow-to-one-project filter.
  const { data: projects } = await svc
    .from('dsb_projects')
    .select('id, code, name_ar')
    .eq('tenant_id', tenantId)
    .order('code', { ascending: true })
  const projectOptions = ((projects ?? []) as Array<{ id: string; code: string; name_ar: string }>)
    .map((p) => ({ id: p.id, label: `${p.code} — ${p.name_ar}` }))

  const linkedCount = (totalExtracted ?? 0) - (unlinkedCount ?? 0)
  const pctLinked = totalExtracted && totalExtracted > 0
    ? Math.round((linkedCount / totalExtracted) * 100)
    : 0

  return (
    <div className="max-w-3xl mx-auto space-y-6" dir="rtl">
      <Link
        href="/app/disbursements/admin"
        className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
      >
        ← الإدارة
      </Link>

      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <Link2 className="w-4 h-4" aria-hidden="true" />
          إعادة ربط الطلبات القديمة
        </div>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          ربط تلقائي بالوحدات
        </h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          هذه الأداة تُعيد تحليل الطلبات التي سبق استخراج بياناتها لكنها لم تُربط بوحدة أو عقد أو مشتري
          (السبب الغالب: الطلبات القديمة صدرت قبل تحديث الذكاء الاصطناعي ليطلب رقم الوحدة). كل طلب
          يُعاد إرساله للذكاء الاصطناعي بالنص المُحدَّث ثم يُشغَّل الرابط التلقائي.
        </p>
      </header>

      {/* Scorecards */}
      <section className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-semibold text-slate-500">إجمالي الطلبات المُستخرَجة</div>
          <div className="text-2xl font-black text-slate-900 mt-1 font-mono">{totalExtracted ?? 0}</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          <div className="text-[11px] font-semibold text-emerald-700">مربوطة بوحدة</div>
          <div className="text-2xl font-black text-emerald-800 mt-1 font-mono">
            {linkedCount}
            <span className="text-sm font-semibold text-emerald-600 mr-1">({pctLinked}%)</span>
          </div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
          <div className="text-[11px] font-semibold text-amber-700">في انتظار الربط</div>
          <div className="text-2xl font-black text-amber-800 mt-1 font-mono">{unlinkedCount ?? 0}</div>
        </div>
      </section>

      {/* Runner (client component) */}
      <RelinkRunner
        initialUnlinked={unlinkedCount ?? 0}
        projects={projectOptions}
      />

      {/* Cost/timing note */}
      <div className="text-xs text-slate-500 leading-relaxed rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="font-semibold text-slate-700 mb-1">ملاحظات</div>
        <ul className="list-disc ms-5 space-y-1">
          <li>كل طلب يستغرق ٥–٢٠ ثانية للمعالجة. الحد الأقصى ٣٠ طلب في الدُفعة الواحدة.</li>
          <li>التكلفة التقريبية: ٠.٠٠٥ دولار لكل طلب (نموذج Haiku).</li>
          <li>الأقسام (breakdown items) والقائمة المرجعية لا تُلمَس — فقط تُحدَّث بيانات الاستخراج والروابط.</li>
          <li>لو صادف الطلب مشكلة (PDF محذوف مثلًا)، ينتقل إلى «فشل» ونستمر مع الباقي.</li>
        </ul>
      </div>
    </div>
  )
}
