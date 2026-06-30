import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { Plus, ListChecks, Star } from 'lucide-react'

export const dynamic = 'force-dynamic'

type ChecklistItemRow = {
  id: string
  code: string
  order_index: number
  prompt_ar: string
  prompt_en: string
  active: boolean
}

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
function toArabicDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)] ?? d)
}

export default async function ChecklistTemplateDetailPage({
  params,
}: {
  params: { templateId: string }
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
  if (!dsbRole || !['employee', 'supervisor', 'owner'].includes(dsbRole)) {
    redirect('/app/disbursements')
  }
  const isOwner = dsbRole === 'owner'
  const tenantId = profile.tenant_id as string

  const { data: tplRaw } = await svc
    .from('dsb_checklist_templates')
    .select('id, tenant_id, name, is_default')
    .eq('id', params.templateId)
    .maybeSingle()
  if (!tplRaw || (tplRaw as { tenant_id: string }).tenant_id !== tenantId) {
    notFound()
  }
  const tpl = tplRaw as { id: string; name: string; is_default: boolean }

  const { data: itemsRaw } = await svc
    .from('dsb_checklist_items')
    .select('id, code, order_index, prompt_ar, prompt_en, active')
    .eq('tenant_id', tenantId)
    .eq('template_id', tpl.id)
    .order('order_index', { ascending: true })
  const items = (itemsRaw ?? []) as ChecklistItemRow[]

  return (
    <div className="space-y-6 max-w-5xl mx-auto" dir="rtl">
      <header className="space-y-2">
        <Link
          href="/app/disbursements/admin/checklist-templates"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          ← قوائم المراجعة
        </Link>
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <ListChecks className="w-4 h-4" aria-hidden="true" />
          بنود القائمة
        </div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
                {tpl.name}
              </h1>
              {tpl.is_default && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset bg-amber-50 text-amber-800 ring-amber-200">
                  <Star className="w-3 h-3" aria-hidden="true" />
                  افتراضية
                </span>
              )}
            </div>
            <p className="text-sm text-slate-600 mt-1">
              البنود التي تظهر للمشاريع والعملاء المرتبطين بهذه القائمة.
            </p>
          </div>
          {isOwner && (
            <Link
              href={`/app/disbursements/admin/checklist/new?template=${encodeURIComponent(tpl.id)}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              بند جديد
            </Link>
          )}
        </div>
      </header>

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {items.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            لا توجد بنود في هذه القائمة بعد.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold text-slate-500 border-b border-slate-200 bg-slate-50/40">
                  <th className="text-start py-2 px-3 w-12">#</th>
                  <th className="text-start py-2 px-3">البند</th>
                  <th className="text-start py-2 px-3 w-24">الحالة</th>
                  <th className="text-start py-2 px-3 w-36">الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const statePill = it.active
                    ? { cls: 'bg-green-50 text-green-700 ring-green-200', label: 'نشط' }
                    : { cls: 'bg-slate-100 text-slate-500 ring-slate-200', label: 'غير نشط' }
                  return (
                    <tr key={it.id} className="border-b border-slate-100 align-top last:border-b-0">
                      <td className="py-3 px-3 text-xs text-slate-500 font-mono">
                        {toArabicDigits(it.order_index)}
                      </td>
                      <td className="py-3 px-3">
                        <div className="text-sm font-semibold text-slate-900 leading-snug">
                          {it.prompt_ar}
                        </div>
                        <div className="text-[11px] text-slate-500 leading-snug mt-0.5">
                          {it.prompt_en}
                        </div>
                        <div className="mt-1">
                          <span className="inline-block text-[10px] font-mono text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">
                            {it.code}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${statePill.cls}`}
                        >
                          {statePill.label}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        {!isOwner ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          <Link
                            href={`/app/disbursements/admin/checklist/${it.id}/edit`}
                            className="inline-flex items-center px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition"
                          >
                            تعديل
                          </Link>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
