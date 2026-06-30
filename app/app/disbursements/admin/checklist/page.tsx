import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { Plus, ListChecks } from 'lucide-react'

export const dynamic = 'force-dynamic'

type ChecklistItemRow = {
  id: string
  tenant_id: string | null
  code: string
  order_index: number
  prompt_ar: string
  prompt_en: string
  active: boolean
  project_id: string | null
  developer_id: string | null
}

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
function toArabicDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)] ?? d)
}

type ScopeKey = 'global' | 'developer' | 'project'
const SCOPE_GROUPS: Array<{ key: ScopeKey; title: string }> = [
  { key: 'global', title: 'بنود عامة' },
  { key: 'developer', title: 'بنود خاصة بعميل' },
  { key: 'project', title: 'بنود خاصة بمشروع' },
]

export default async function ChecklistAdminPage() {
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

  // Fetch global defaults (tenant_id IS NULL) + tenant-specific items.
  const { data: itemsData } = await svc
    .from('dsb_checklist_items')
    .select('id, tenant_id, code, order_index, prompt_ar, prompt_en, active, project_id, developer_id')
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .order('order_index', { ascending: true })
  const items = (itemsData ?? []) as ChecklistItemRow[]

  // Collect referenced developer/project IDs so we can render their names in
  // the scope chip. Service-role fetch — RLS would already permit since we're
  // restricted to the caller's tenant via the IDs that came back.
  const developerIds = Array.from(
    new Set(items.map((i) => i.developer_id).filter((v): v is string => !!v)),
  )
  const projectIds = Array.from(
    new Set(items.map((i) => i.project_id).filter((v): v is string => !!v)),
  )
  const [devLookup, projLookup] = await Promise.all([
    developerIds.length === 0
      ? Promise.resolve(new Map<string, string>())
      : svc
          .from('dsb_developers')
          .select('id, company_name_ar')
          .in('id', developerIds)
          .then(({ data }) => {
            const m = new Map<string, string>()
            for (const r of (data ?? []) as Array<{ id: string; company_name_ar: string }>) {
              m.set(r.id, r.company_name_ar)
            }
            return m
          }),
    projectIds.length === 0
      ? Promise.resolve(new Map<string, string>())
      : svc
          .from('dsb_projects')
          .select('id, name_ar')
          .in('id', projectIds)
          .then(({ data }) => {
            const m = new Map<string, string>()
            for (const r of (data ?? []) as Array<{ id: string; name_ar: string }>) {
              m.set(r.id, r.name_ar)
            }
            return m
          }),
  ])

  // Bucket items by scope.
  const grouped: Record<ScopeKey, ChecklistItemRow[]> = {
    global: [],
    developer: [],
    project: [],
  }
  for (const it of items) {
    if (it.developer_id) grouped.developer.push(it)
    else if (it.project_id) grouped.project.push(it)
    else grouped.global.push(it)
  }

  function scopeChip(it: ChecklistItemRow) {
    if (it.developer_id) {
      const name = devLookup.get(it.developer_id) ?? '—'
      return { cls: 'bg-blue-50 text-blue-700 ring-blue-200', label: `عميل: ${name}` }
    }
    if (it.project_id) {
      const name = projLookup.get(it.project_id) ?? '—'
      return { cls: 'bg-teal-50 text-teal-700 ring-teal-200', label: `مشروع: ${name}` }
    }
    return { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: 'عام' }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto" dir="rtl">
      <header className="space-y-2">
        <Link
          href="/app/disbursements/admin"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          ← إدارة
        </Link>
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <ListChecks className="w-4 h-4" aria-hidden="true" />
          إعدادات قائمة المراجعة
        </div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
              إعدادات قائمة المراجعة
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              إدارة البنود التي تظهر في قائمة مراجعة كل طلب. يمكن للبنود أن تكون عامة أو خاصة بعميل أو خاصة بمشروع.
            </p>
          </div>
          {isOwner && (
            <Link
              href="/app/disbursements/admin/checklist/new"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              بند جديد
            </Link>
          )}
        </div>
      </header>

      {items.length === 0 ? (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-10 text-center text-sm text-slate-500">لا توجد بنود.</div>
        </section>
      ) : (
        SCOPE_GROUPS.map(({ key, title }) => {
          const rows = grouped[key]
          if (rows.length === 0) return null
          return (
            <section
              key={key}
              className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
            >
              <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
                <span className="text-[11px] text-slate-500 font-mono">
                  {toArabicDigits(rows.length)}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs font-semibold text-slate-500 border-b border-slate-200 bg-slate-50/40">
                      <th className="text-start py-2 px-3 w-12">#</th>
                      <th className="text-start py-2 px-3">البند</th>
                      <th className="text-start py-2 px-3 w-28">النوع</th>
                      <th className="text-start py-2 px-3">النطاق</th>
                      <th className="text-start py-2 px-3 w-24">الحالة</th>
                      <th className="text-start py-2 px-3 w-36">الإجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((it) => {
                      const isGlobalTenant = it.tenant_id === null
                      const kindPill = isGlobalTenant
                        ? { cls: 'bg-blue-50 text-blue-700 ring-blue-200', label: 'افتراضي' }
                        : { cls: 'bg-teal-50 text-teal-700 ring-teal-200', label: 'مخصص' }
                      const statePill = it.active
                        ? { cls: 'bg-green-50 text-green-700 ring-green-200', label: 'نشط' }
                        : { cls: 'bg-slate-100 text-slate-500 ring-slate-200', label: 'غير نشط' }
                      const scope = scopeChip(it)
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
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${kindPill.cls}`}
                            >
                              {kindPill.label}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${scope.cls}`}
                              title={scope.label}
                            >
                              {scope.label}
                            </span>
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
                              <div className="flex items-center gap-2">
                                <Link
                                  href={`/app/disbursements/admin/checklist/${it.id}/edit`}
                                  className="inline-flex items-center px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition"
                                  title={isGlobalTenant ? 'تعديل بند افتراضي' : undefined}
                                >
                                  تعديل
                                </Link>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })
      )}

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        البنود الافتراضية قابلة للتعديل والحذف. إذا أردت إخفاء بند مؤقتًا اجعله «غير نشط» بدلاً من حذفه. البنود المخصصة لعميل أو مشروع تظهر فقط في طلباتهم.
      </div>
    </div>
  )
}
