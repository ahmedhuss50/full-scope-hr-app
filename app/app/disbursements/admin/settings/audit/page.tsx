/**
 * سجل التدقيق — Audit Log viewer (owner-only, read-only).
 *
 * Reads from dsb_audit_log (migration 067). URL-driven filters:
 *   ?entity=project|case|payment|sale|account|tenant
 *   ?actor=<user_id>
 *   ?from=YYYY-MM-DD  ?to=YYYY-MM-DD
 *
 * The write path (logAudit helper called from mutations) lands in a later
 * slice; until then this page shows an informative empty state that
 * explains what will appear once auditing is turned on.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, History, User as UserIcon, FileText } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type AuditRow = {
  id: string
  occurred_at: string
  actor_user_id: string | null
  actor_email: string | null
  entity_type: string
  entity_id: string | null
  action: string
  summary: string | null
}

const ENTITY_LABEL: Record<string, string> = {
  project:  'مشروع',
  case:     'طلب',
  payment:  'دفعة',
  sale:     'عقد بيع',
  account:  'حساب',
  tenant:   'إعدادات',
  employee: 'موظف',
  client:   'عميل',
  vendor:   'مورد',
}

const ACTION_LABEL: Record<string, string> = {
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  export: 'تصدير',
  send:   'إرسال',
  sign:   'توقيع',
  reject: 'رفض',
}

function fmtDateTime(s: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(s))
  } catch { return s }
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams?: { entity?: string; actor?: string; from?: string; to?: string }
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
  if ((profile.dsb_role as string | null) !== 'owner') {
    redirect('/app/disbursements/admin')
  }

  const tenantId = profile.tenant_id as string
  const entity = (searchParams?.entity ?? '').trim() || null
  const actor  = (searchParams?.actor  ?? '').trim() || null
  const from   = (searchParams?.from   ?? '').trim() || null
  const to     = (searchParams?.to     ?? '').trim() || null

  let q = svc
    .from('dsb_audit_log')
    .select('id, occurred_at, actor_user_id, actor_email, entity_type, entity_id, action, summary')
    .eq('tenant_id', tenantId)
    .order('occurred_at', { ascending: false })
    .limit(200)
  if (entity) q = q.eq('entity_type', entity)
  if (actor)  q = q.eq('actor_user_id', actor)
  if (from)   q = q.gte('occurred_at', from)
  if (to)     q = q.lte('occurred_at', to)
  const { data } = await q
  const rows = (data ?? []) as AuditRow[]

  // Tenant users for the actor picker
  const { data: staffRows } = await svc
    .from('users')
    .select('id, full_name, email')
    .eq('tenant_id', tenantId)
    .in('dsb_role', ['owner', 'supervisor', 'employee', 'deliverer'])
    .order('full_name', { ascending: true })

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500'

  return (
    <div className="space-y-6 max-w-5xl mx-auto" dir="rtl">
      <Link
        href="/app/disbursements/admin"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        العودة إلى الإدارة
      </Link>

      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <History className="w-4 h-4" aria-hidden="true" />
          الإدارة
        </div>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          سجل التدقيق
        </h1>
        <p className="text-sm text-slate-600">
          كل تعديل يتم على البيانات (مشاريع، طلبات، دفعات، عقود، حسابات، إعدادات) يُسجَّل هنا مع الشخص والوقت وحالة قبل/بعد.
        </p>
      </header>

      {/* Filters — plain GET form */}
      <form
        method="GET"
        action="/app/disbursements/admin/settings/audit"
        className="bg-white border border-slate-200 rounded-xl shadow-sm p-3"
      >
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-500 mb-1">نوع الكيان</span>
            <select name="entity" defaultValue={entity ?? ''} className={inputCls}>
              <option value="">— الكل —</option>
              {Object.entries(ENTITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-500 mb-1">المستخدم</span>
            <select name="actor" defaultValue={actor ?? ''} className={inputCls}>
              <option value="">— الكل —</option>
              {((staffRows ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((u) => (
                <option key={u.id} value={u.id}>{u.full_name ?? u.email ?? u.id}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-500 mb-1">من تاريخ</span>
            <input type="date" name="from" defaultValue={from ?? ''} className={inputCls} dir="ltr" />
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-500 mb-1">إلى تاريخ</span>
            <input type="date" name="to" defaultValue={to ?? ''} className={inputCls} dir="ltr" />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="submit"
            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
          >
            تطبيق
          </button>
          <Link
            href="/app/disbursements/admin/settings/audit"
            className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            مسح
          </Link>
        </div>
      </form>

      {rows.length === 0 ? (
        <section className="bg-white border border-dashed border-slate-200 rounded-xl p-8 text-center">
          <History className="w-8 h-8 text-slate-300 mx-auto mb-3" aria-hidden="true" />
          <div className="serif font-bold text-base text-slate-800">لا توجد إدخالات في سجل التدقيق بعد</div>
          <p className="text-xs text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
            جدول التدقيق جاهز في قاعدة البيانات، وسيبدأ بالتسجيل تلقائيًا عند تفعيل التوثيق الحي على الإجراءات (سيتم تفعيله في الشريحة القادمة).
            حتى ذلك الحين، هذه الشاشة تعرض القيم الحقيقية عندما تصل.
          </p>
        </section>
      ) : (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-right">
                <tr>
                  <Th>الوقت</Th>
                  <Th>المستخدم</Th>
                  <Th>النوع</Th>
                  <Th>الإجراء</Th>
                  <Th>الملخّص</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <Td><span className="font-mono text-xs">{fmtDateTime(r.occurred_at)}</span></Td>
                    <Td>
                      <div className="inline-flex items-center gap-1.5">
                        <UserIcon className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                        <span className="truncate">{r.actor_email ?? r.actor_user_id ?? '—'}</span>
                      </div>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ring-1 ring-inset bg-slate-50 text-slate-700 ring-slate-200">
                        {ENTITY_LABEL[r.entity_type] ?? r.entity_type}
                      </span>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ring-1 ring-inset bg-teal-50 text-teal-800 ring-teal-200">
                        {ACTION_LABEL[r.action] ?? r.action}
                      </span>
                    </Td>
                    <Td className="max-w-md">
                      <div className="flex items-start gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
                        <span className="text-slate-700 leading-tight">{r.summary ?? '—'}</span>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 border-t border-slate-100 text-[11px] text-slate-500">
            آخر {rows.length} إدخال (بحد أقصى 200 لكل استعلام).
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
function Td({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return <td className={`px-3 py-2.5 text-sm text-slate-700 align-top ${className}`}>{children}</td>
}
