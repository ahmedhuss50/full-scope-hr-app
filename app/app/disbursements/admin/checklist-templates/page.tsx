import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ListChecks } from 'lucide-react'
import { TemplatesIndex, type TemplateRow } from './TemplatesIndex'

export const dynamic = 'force-dynamic'

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
// Local helper — NOT exported. Next.js page files only allow a specific
// set of exports (default component, metadata, dynamic config, etc.);
// exporting a utility function from a page.tsx fails the build with
// `"toArabicDigits" is not a valid Page export field`.
function toArabicDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)] ?? d)
}

export default async function ChecklistTemplatesIndexPage() {
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

  // Tenant templates + their item counts.
  const { data: tplsRaw } = await svc
    .from('dsb_checklist_templates')
    .select('id, name, is_default, created_at')
    .eq('tenant_id', tenantId)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })
  const templates = (tplsRaw ?? []) as Array<{
    id: string; name: string; is_default: boolean; created_at: string
  }>

  // Item counts per template (one query, then bucket in memory).
  const itemCountByTemplate = new Map<string, { total: number; active: number }>()
  if (templates.length > 0) {
    const { data: countsRaw } = await svc
      .from('dsb_checklist_items')
      .select('template_id, active')
      .eq('tenant_id', tenantId)
      .in('template_id', templates.map((t) => t.id))
    for (const r of (countsRaw ?? []) as Array<{ template_id: string | null; active: boolean }>) {
      if (!r.template_id) continue
      const cur = itemCountByTemplate.get(r.template_id) ?? { total: 0, active: 0 }
      cur.total += 1
      if (r.active) cur.active += 1
      itemCountByTemplate.set(r.template_id, cur)
    }
  }

  const rows: TemplateRow[] = templates.map((t) => {
    const c = itemCountByTemplate.get(t.id) ?? { total: 0, active: 0 }
    return {
      id: t.id,
      name: t.name,
      is_default: t.is_default,
      total_items: c.total,
      active_items: c.active,
    }
  })

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
          قوائم المراجعة
        </div>
        <div>
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            قوائم المراجعة
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            القائمة عبارة عن مجموعة من بنود المراجعة المسماة. لكل مكتب قوائم متعددة
            وقائمة افتراضية واحدة. يمكن لكل مشروع أو عميل اختيار قائمة مختلفة، وإلا
            تُستخدم القائمة الافتراضية.
          </p>
        </div>
      </header>

      <TemplatesIndex templates={rows} isOwner={isOwner} />

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        لا يمكن حذف القائمة الافتراضية. لحذف قائمة أخرى يجب أولًا حذف بنودها وإزالة
        ارتباطها بأي مشروع أو عميل.
      </div>
    </div>
  )
}
