/**
 * عقود المشترين — buyer + contract list for a project.
 *
 * Post-migration 058, sales are project-scoped and can exist WITHOUT a
 * linked unit. This page lists them all, showing per-row whether the sale
 * is linked to a unit or not. A "ربط تلقائي" button triggers the AI linker
 * (see /api/dsb-link-sales-to-units).
 */
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ArrowRight, ScrollText, Upload } from 'lucide-react'
import { AutoLinkButton } from './AutoLinkButton'

export const dynamic = 'force-dynamic'

function fmtSar(v: number | null | undefined): string {
  if (v == null) return '—'
  try {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR',
      maximumFractionDigits: 0,
    }).format(v)
  } catch {
    return `${v} ر.س`
  }
}
function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(s + 'T00:00:00'))
  } catch {
    return s
  }
}

type SaleRow = {
  id: string
  unit_id: string | null
  unit_number_raw: string | null
  contract_number: string | null
  buyer_name_ar: string | null
  buyer_phone: string | null
  sale_date: string | null
  price_with_vat_sar: number | null
  delivery_status: string | null
  delivery_date: string | null
  // Nested unit (when linked) for showing the resolved unit_number.
  unit: { id: string; unit_number: string | null } | { id: string; unit_number: string | null }[] | null
}

function single<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export default async function ProjectBuyerContractsPage({
  params,
  searchParams,
}: {
  params: { projectId: string }
  searchParams?: { q?: string; linked?: 'yes' | 'no' | 'all' }
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
  if (!dsbRole || !['employee', 'supervisor', 'owner', 'viewer'].includes(dsbRole)) {
    redirect('/app/disbursements')
  }

  const tenantId = profile.tenant_id as string
  const projectId = params.projectId

  const { data: projectData } = await svc
    .from('dsb_projects')
    .select('id, tenant_id, code, name_ar')
    .eq('id', projectId)
    .maybeSingle()
  if (!projectData || (projectData as { tenant_id: string }).tenant_id !== tenantId) {
    notFound()
  }
  const project = projectData as { id: string; code: string; name_ar: string }

  const q = (searchParams?.q ?? '').trim()
  const linkedFilter = (searchParams?.linked ?? 'all') as 'all' | 'yes' | 'no'

  let salesQ = svc
    .from('dsb_unit_sales')
    .select(
      `id, unit_id, unit_number_raw, contract_number, buyer_name_ar, buyer_phone,
       sale_date, price_with_vat_sar, delivery_status, delivery_date,
       unit:dsb_project_units!dsb_unit_sales_unit_id_fkey(id, unit_number)`,
    )
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (q) {
    salesQ = salesQ.or(
      [
        `buyer_name_ar.ilike.%${q}%`,
        `contract_number.ilike.%${q}%`,
        `unit_number_raw.ilike.%${q}%`,
        `buyer_phone.ilike.%${q}%`,
      ].join(','),
    )
  }
  if (linkedFilter === 'yes') salesQ = salesQ.not('unit_id', 'is', null)
  if (linkedFilter === 'no') salesQ = salesQ.is('unit_id', null)

  const { data: salesData } = await salesQ
  const sales = (salesData ?? []) as SaleRow[]

  // Compute counts (unfiltered by q / linked) for the tabs.
  const { count: totalCount } = await svc
    .from('dsb_unit_sales')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
  const { count: linkedCount } = await svc
    .from('dsb_unit_sales')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .not('unit_id', 'is', null)
  const { count: unlinkedCount } = await svc
    .from('dsb_unit_sales')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .is('unit_id', null)

  const baseHref = `/app/disbursements/admin/projects/${projectId}/buyer-contracts`
  const filterHref = (v: 'all' | 'yes' | 'no') => {
    const params = new URLSearchParams()
    if (v !== 'all') params.set('linked', v)
    if (q) params.set('q', q)
    const qs = params.toString()
    return qs ? `${baseHref}?${qs}` : baseHref
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6" dir="rtl">
      <Link
        href={`/app/disbursements/admin/projects/${projectId}`}
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        العودة إلى المشروع
      </Link>

      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <ScrollText className="w-4 h-4" aria-hidden="true" />
          عقود المشترين
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            {project.name_ar}
          </h1>
          <span className="font-mono text-sm text-slate-500">{project.code}</span>
          <span className="text-sm text-slate-400 font-mono">({totalCount ?? 0})</span>
        </div>
        <p className="text-sm text-slate-600">
          كل العقود والمشترين المستوردة لهذا المشروع. تُربط تلقائيًا بالوحدات؛ استخدم زر «ربط تلقائي بالوحدات» لإعادة المحاولة.
        </p>
      </header>

      {/* Scorecards + auto-link */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-semibold text-slate-500">إجمالي العقود</div>
          <div className="text-2xl font-black text-slate-900 mt-1 font-mono">{totalCount ?? 0}</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          <div className="text-[11px] font-semibold text-emerald-700">مربوطة بوحدة</div>
          <div className="text-2xl font-black text-emerald-800 mt-1 font-mono">{linkedCount ?? 0}</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
          <div className="text-[11px] font-semibold text-amber-700">غير مربوطة</div>
          <div className="text-2xl font-black text-amber-800 mt-1 font-mono">{unlinkedCount ?? 0}</div>
        </div>
      </section>

      {/* Auto-link button (owner-only). Client component. */}
      {dsbRole === 'owner' && (unlinkedCount ?? 0) > 0 && (
        <AutoLinkButton projectId={projectId} unlinkedCount={unlinkedCount ?? 0} />
      )}

      {/* Filters */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <form className="flex flex-wrap items-end gap-3" method="GET">
          <div className="flex-1 min-w-[220px]">
            <label className="text-[11px] font-semibold text-slate-500 mb-1 block">بحث</label>
            <input
              name="q"
              defaultValue={q}
              placeholder="اسم المشتري، رقم العقد، رقم الوحدة، الجوال…"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          {linkedFilter !== 'all' && (
            <input type="hidden" name="linked" value={linkedFilter} />
          )}
          <button
            type="submit"
            className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 text-sm font-semibold"
          >
            تطبيق
          </button>
          {(q || linkedFilter !== 'all') && (
            <Link
              href={baseHref}
              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-2"
            >
              مسح
            </Link>
          )}
          <div className="flex-1" />
          {dsbRole === 'owner' && (
            <Link
              href={`/app/disbursements/admin/imports/contracts?project=${projectId}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-3 py-2 text-xs font-bold"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              استيراد عقود ومشترين
            </Link>
          )}
        </form>

        {/* Linked-status tabs */}
        <div className="flex gap-2 mt-3">
          {(['all', 'yes', 'no'] as const).map((v) => {
            const label = v === 'all' ? 'الكل' : v === 'yes' ? 'مربوطة' : 'غير مربوطة'
            const active = linkedFilter === v
            return (
              <Link
                key={v}
                href={filterHref(v)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                  active
                    ? 'bg-teal-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {label}
              </Link>
            )
          })}
        </div>
      </section>

      {sales.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500 shadow-sm">
          {q || linkedFilter !== 'all'
            ? 'لا توجد نتائج مطابقة للفلاتر.'
            : 'لم تُستورَد عقود لهذا المشروع بعد.'}
        </div>
      ) : (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-right">
                  <Th>الوحدة</Th>
                  <Th>المشتري</Th>
                  <Th>رقم العقد</Th>
                  <Th>تاريخ البيع</Th>
                  <Th>السعر</Th>
                  <Th>التسليم</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales.map((s) => {
                  const unit = single(s.unit)
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/70">
                      <Td>
                        {unit && unit.unit_number ? (
                          <span className="font-mono font-semibold text-emerald-800">
                            {unit.unit_number}
                          </span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 w-fit">
                              غير مربوطة
                            </span>
                            {s.unit_number_raw && (
                              <span className="text-[11px] text-slate-500 font-mono">
                                خام: {s.unit_number_raw}
                              </span>
                            )}
                          </div>
                        )}
                      </Td>
                      <Td>
                        {s.buyer_name_ar ? (
                          <div>
                            <div className="text-slate-900">{s.buyer_name_ar}</div>
                            {s.buyer_phone && (
                              <div className="text-[11px] font-mono text-slate-500" dir="ltr">
                                {s.buyer_phone}
                              </div>
                            )}
                          </div>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>
                        <span className="font-mono text-xs">{s.contract_number ?? '—'}</span>
                      </Td>
                      <Td>{fmtDate(s.sale_date)}</Td>
                      <Td>
                        <span className="font-mono">{fmtSar(s.price_with_vat_sar)}</span>
                      </Td>
                      <Td>
                        {s.delivery_status === 'delivered' ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200">
                            مُسلَّمة
                          </span>
                        ) : s.delivery_status === 'pending' ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200">
                            قيد التسليم
                          </span>
                        ) : (
                          '—'
                        )}
                        {s.delivery_date && (
                          <div className="text-[10px] text-slate-500 mt-0.5">{fmtDate(s.delivery_date)}</div>
                        )}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  )
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2.5 text-sm text-slate-700 align-top">{children}</td>
}
