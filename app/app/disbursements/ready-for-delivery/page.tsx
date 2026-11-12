/**
 * «جاهز للتسليم» — dedicated list of all signed cases awaiting physical
 * delivery. Primary audience: the deliverer (مسلِّم) role, who previously
 * had to dig through the kanban to find them. Also visible to owners and
 * supervisors for oversight.
 *
 * Shows: case number, project, developer, voucher date, amount, signed_at,
 * assigned deliverer (if any), and a direct action to open the case.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { assignedProjectIds, applyProjectScope } from '@/lib/dsb/access'
import { PackageCheck, ArrowLeft, Search } from 'lucide-react'

export const dynamic = 'force-dynamic'

type SignedCase = {
  id: string
  case_number: string | null
  voucher_number_text: string | null
  amount_sar: number | null
  signed_at: string | null
  project: { id: string; code: string; name_ar: string } | null
  developer: { id: string; company_name_ar: string } | null
}

export default async function ReadyForDeliveryPage({
  searchParams,
}: {
  searchParams?: { q?: string }
}) {
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

  const dsbRole = (profile.dsb_role as string | null) ?? null
  // Visible to roles that either deliver or oversee delivery.
  if (!dsbRole || !['deliverer', 'owner', 'supervisor', 'employee', 'viewer'].includes(dsbRole)) {
    redirect('/app/disbursements')
  }

  const tenantId = profile.tenant_id as string
  const currentUserId = profile.id as string
  const q = (searchParams?.q ?? '').trim()

  const allowedProjectIds = await assignedProjectIds({
    svc, tenantId, userId: currentUserId, dsbRole,
  })

  // Signed cases only — those ready to be physically handed to the client.
  let query = svc
    .from('dsb_cases')
    .select(
      `id, case_number, voucher_number_text, amount_sar, signed_at,
       project:dsb_projects!dsb_cases_project_id_fkey(id, code, name_ar),
       developer:dsb_developers!dsb_cases_developer_id_fkey(id, company_name_ar)`,
    )
    .eq('tenant_id', tenantId)
    .eq('status', 'signed')
    .order('signed_at', { ascending: false })
    .limit(500)
  query = applyProjectScope(query, allowedProjectIds)
  if (q) {
    query = query.or(
      [
        `case_number.ilike.%${q}%`,
        `voucher_number_text.ilike.%${q}%`,
        `recipient_name.ilike.%${q}%`,
      ].join(','),
    )
  }
  const { data: rawCases } = await query
  const cases = (rawCases ?? []) as unknown as SignedCase[]

  const totalAmount = cases.reduce((sum, c) => sum + (Number(c.amount_sar) || 0), 0)
  const fmt = (n: number) => new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 2 }).format(n)
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('ar-SA', { dateStyle: 'medium' }) : '—'

  return (
    <div dir="rtl" className="max-w-6xl mx-auto p-6 space-y-5">
      <div>
        <Link
          href="/app/disbursements"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 mb-1"
        >
          <ArrowLeft className="w-3.5 h-3.5 rotate-180" /> رجوع للرئيسية
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <PackageCheck className="w-6 h-6 text-emerald-600" />
              جاهز للتسليم
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              كل وثائق الصرف الموقّعة والجاهزة لتسليمها للمستفيد.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex flex-col items-center justify-center px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200 min-w-[6rem]">
              <span className="text-[11px] text-emerald-700 font-semibold">العدد</span>
              <span className="font-mono font-bold text-lg text-emerald-800">{cases.length}</span>
            </div>
            <div className="inline-flex flex-col items-center justify-center px-4 py-2 rounded-lg bg-slate-50 border border-slate-200 min-w-[8rem]">
              <span className="text-[11px] text-slate-600 font-semibold">إجمالي القيمة</span>
              <span className="font-mono font-bold text-lg text-slate-800">{fmt(totalAmount)} ر.س</span>
            </div>
          </div>
        </div>
      </div>

      <form method="get" className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            name="q"
            defaultValue={q}
            placeholder="بحث برقم الوثيقة أو السند أو اسم المستفيد…"
            className="w-full rounded-lg border border-slate-200 bg-white pr-9 pl-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700"
        >
          بحث
        </button>
      </form>

      {cases.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center">
          <PackageCheck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-600 font-semibold">
            لا توجد وثائق جاهزة للتسليم حالياً.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            ستظهر الوثائق هنا بمجرد توقيعها من قبل مدير المراجعة.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-right text-xs text-slate-600 font-semibold">
                  <th className="px-4 py-3">رقم الوثيقة</th>
                  <th className="px-4 py-3">السند</th>
                  <th className="px-4 py-3">المشروع</th>
                  <th className="px-4 py-3">المطور</th>
                  <th className="px-4 py-3">المبلغ</th>
                  <th className="px-4 py-3">تاريخ التوقيع</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cases.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-800">
                      {c.case_number ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {c.voucher_number_text ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-800">
                      {c.project ? (
                        <div className="flex flex-col">
                          <span className="font-semibold">{c.project.name_ar}</span>
                          <span className="font-mono text-[10px] text-slate-500">{c.project.code}</span>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {c.developer?.company_name_ar ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-900 font-semibold">
                      {c.amount_sar != null ? fmt(Number(c.amount_sar)) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {fmtDate(c.signed_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/disbursements/${c.id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition"
                      >
                        فتح للتسليم
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
