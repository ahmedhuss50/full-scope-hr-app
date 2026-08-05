/**
 * قائمة الوحدات — physical inventory list for a project.
 *
 * Each unit row is enriched with a compact summary of its linked sale
 * (buyer + contract + price + delivery). Physical specs are the primary
 * data; the sale summary is contextual so the operator can see at a
 * glance which units are sold and to whom. Full contract detail lives on
 * the sibling /buyer-contracts page.
 *
 * Owner + supervisor + employee can view. Delete is owner-only.
 */
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ArrowRight, Building2, Upload } from 'lucide-react'
import { DeleteRowButton } from '../_shared/DeleteRowButton'
import { DeleteAllButton } from '../_shared/DeleteAllButton'
import { deleteUnit, deleteAllUnitsForProject } from '../../../units/actions'

export const dynamic = 'force-dynamic'

type UnitRow = {
  id: string
  unit_number: string
  unit_type: string | null
  area_m2: number | null
  block_number: string | null
  zone_number: string | null
  district: string | null
  city: string | null
  region: string | null
}

type SaleLite = {
  id: string
  unit_id: string
  sale_status: string | null
  buyer_name_ar: string | null
  buyer_phone: string | null
  contract_number: string | null
  sale_date: string | null
  price_with_vat_sar: number | null
  price_before_tax_sar: number | null
  delivery_status: string | null
  delivery_date: string | null
  created_at: string
}

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

function fmtShortDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      day: 'numeric',
      month: 'short',
      year: '2-digit',
    }).format(new Date(s + 'T00:00:00'))
  } catch {
    return s
  }
}

export default async function ProjectUnitsListPage({
  params,
  searchParams,
}: {
  params: { projectId: string }
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
  let unitsQ = svc
    .from('dsb_project_units')
    .select('id, unit_number, unit_type, area_m2, block_number, zone_number, district, city, region')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .order('unit_number', { ascending: true })
  if (q) {
    unitsQ = unitsQ.or(
      [
        `unit_number.ilike.%${q}%`,
        `block_number.ilike.%${q}%`,
        `zone_number.ilike.%${q}%`,
        `district.ilike.%${q}%`,
      ].join(','),
    )
  }
  const { data: unitsData } = await unitsQ
  const units = (unitsData ?? []) as UnitRow[]

  // Load linked sales for every unit in one query, then pick the
  // active (or most-recent) sale per unit_id. This gives each row the
  // "current buyer/contract" summary without hammering the DB per unit.
  const unitIds = units.map((u) => u.id)
  const saleByUnit = new Map<string, SaleLite>()
  if (unitIds.length > 0) {
    const { data: salesData } = await svc
      .from('dsb_unit_sales')
      .select(
        `id, unit_id, sale_status, buyer_name_ar, buyer_phone, contract_number,
         sale_date, price_with_vat_sar, price_before_tax_sar,
         delivery_status, delivery_date, created_at`,
      )
      .eq('tenant_id', tenantId)
      .in('unit_id', unitIds)
      .order('created_at', { ascending: false })
    const sales = (salesData ?? []) as SaleLite[]
    // Active sale wins; ties broken by newest created_at (already sorted DESC).
    for (const s of sales) {
      const prev = saleByUnit.get(s.unit_id)
      if (!prev) {
        saleByUnit.set(s.unit_id, s)
      } else if (prev.sale_status !== 'active' && s.sale_status === 'active') {
        saleByUnit.set(s.unit_id, s)
      }
    }
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
          <Building2 className="w-4 h-4" aria-hidden="true" />
          قائمة الوحدات
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            {project.name_ar}
          </h1>
          <span className="font-mono text-sm text-slate-500">{project.code}</span>
          <span className="text-sm text-slate-400 font-mono">({units.length})</span>
        </div>
        <p className="text-sm text-slate-600">
          الوحدات المادية للمشروع. لا يتضمن هذا العرض بيانات المشترين أو العقود — تلك متوفرة في «عقود المشترين».
        </p>
      </header>

      {/* Search + import */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <form className="flex flex-wrap items-end gap-3" method="GET">
          <div className="flex-1 min-w-[200px]">
            <label className="text-[11px] font-semibold text-slate-500 mb-1 block">بحث</label>
            <input
              name="q"
              defaultValue={q}
              placeholder="رقم الوحدة، البلوك، المنطقة، الحي…"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 text-sm font-semibold"
          >
            تطبيق
          </button>
          {q && (
            <Link
              href={`/app/disbursements/admin/projects/${projectId}/units`}
              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-2"
            >
              مسح
            </Link>
          )}
          <div className="flex-1" />
          {dsbRole === 'owner' && (
            <Link
              href={`/app/disbursements/admin/imports/units?project=${projectId}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 text-xs font-bold"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              استيراد وحدات
            </Link>
          )}
          {dsbRole === 'owner' && (
            <DeleteAllButton
              label="حذف كل الوحدات"
              count={units.length}
              itemNoun="وحدة (وكل عقودها ومشترينها)"
              projectId={projectId}
              action={deleteAllUnitsForProject}
            />
          )}
        </form>
      </section>

      {units.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500 shadow-sm">
          {q
            ? 'لا توجد نتائج مطابقة للبحث.'
            : 'لم تُدخَل وحدات لهذا المشروع بعد. استخدم زر «استيراد وحدات» أعلاه.'}
        </div>
      ) : (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-right">
                  <Th>رقم الوحدة</Th>
                  <Th>البلوك / المنطقة</Th>
                  <Th>النوع / المساحة</Th>
                  <Th>الموقع</Th>
                  <Th>المشتري والعقد</Th>
                  {dsbRole === 'owner' && <Th> </Th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {units.map((u) => {
                  const sale = saleByUnit.get(u.id)
                  const displayPrice = sale?.price_with_vat_sar ?? sale?.price_before_tax_sar ?? null
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70">
                      <Td>
                        <span className="font-mono font-semibold text-slate-900">{u.unit_number}</span>
                      </Td>
                      <Td>
                        <div className="text-slate-900">{u.block_number ?? '—'}</div>
                        {u.zone_number && (
                          <div className="text-[11px] text-slate-500 font-mono">Z {u.zone_number}</div>
                        )}
                      </Td>
                      <Td>
                        <div className="text-slate-900">{unitTypeLabel(u.unit_type)}</div>
                        {u.area_m2 != null && (
                          <div className="text-[11px] font-mono text-slate-500">
                            {new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(u.area_m2)} م²
                          </div>
                        )}
                      </Td>
                      <Td>
                        <div className="text-slate-900">{u.city ?? '—'}</div>
                        {u.district && (
                          <div className="text-[11px] text-slate-500">{u.district}</div>
                        )}
                      </Td>
                      <Td>
                        {sale ? (
                          <div className="leading-tight">
                            {sale.buyer_name_ar ? (
                              <div className="text-slate-900 font-semibold">{sale.buyer_name_ar}</div>
                            ) : (
                              <div className="text-slate-400 italic text-xs">— بدون اسم مشتري —</div>
                            )}
                            <div className="text-[11px] text-slate-600 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                              {sale.contract_number && (
                                <span>
                                  <span className="text-slate-400">عقد </span>
                                  <span className="font-mono">{sale.contract_number}</span>
                                </span>
                              )}
                              {sale.sale_date && (
                                <span className="text-slate-500">{fmtShortDate(sale.sale_date)}</span>
                              )}
                              {displayPrice != null && (
                                <span className="font-mono text-emerald-700">{fmtSar(displayPrice)}</span>
                              )}
                            </div>
                            <div className="text-[10px] mt-0.5">
                              {sale.delivery_status === 'delivered' && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full font-bold bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200">
                                  مُسلَّمة
                                </span>
                              )}
                              {sale.delivery_status === 'pending' && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full font-bold bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200">
                                  قيد التسليم
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200">
                            لم تُبَع
                          </span>
                        )}
                      </Td>
                      {dsbRole === 'owner' && (
                        <Td>
                          <DeleteRowButton
                            id={u.id}
                            itemLabel={`الوحدة ${u.unit_number}`}
                            action={deleteUnit}
                          />
                        </Td>
                      )}
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

/**
 * Map the internal enum value (villa/apartment/other) to a human-friendly
 * Arabic label. Anything unknown falls through as-is so custom types stored
 * pre-normalization still display sensibly.
 */
function unitTypeLabel(t: string | null): string {
  if (!t) return '—'
  const k = t.toLowerCase().trim()
  if (k === 'villa') return 'فيلا'
  if (k === 'apartment') return 'شقة'
  if (k === 'other') return 'أخرى'
  return t
}
