import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { FileText, ArrowRight, Plus, Settings } from 'lucide-react'

export const dynamic = 'force-dynamic'

type CaseRow = {
  id: string
  case_number: string
  voucher_number_text: string | null
  voucher_date: string | null
  amount_sar: number | null
  status: string
  submitted_at: string | null
  project: { id: string; code: string; name_ar: string; assigned_employee_id: string | null } | { id: string; code: string; name_ar: string; assigned_employee_id: string | null }[] | null
  developer: { company_name_ar: string } | { company_name_ar: string }[] | null
}

function single<T>(maybe: T | T[] | null | undefined): T | null {
  if (!maybe) return null
  return Array.isArray(maybe) ? (maybe[0] ?? null) : maybe
}

function fmtSar(amount: number | null): string {
  if (amount == null) return '—'
  try {
    return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${amount} ر.س`
  }
}
function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Intl.DateTimeFormat('ar-SA', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(s))
  } catch {
    return s
  }
}

function statusPill(status: string): { cls: string; label: string } {
  switch (status) {
    case 'with_employee':   return { cls: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'بانتظار الموظف' }
    case 'with_supervisor': return { cls: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'بانتظار المشرف' }
    case 'with_owner':      return { cls: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'بانتظار التوقيع' }
    case 'sent_back_to_developer': return { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'أُعيدت إلى المطوّر' }
    case 'signed':          return { cls: 'bg-green-50 text-green-700 ring-green-200', label: 'موقَّعة' }
    case 'cancelled':       return { cls: 'bg-slate-100 text-slate-500 ring-slate-200', label: 'ملغاة' }
    case 'draft':           return { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: 'مسودة' }
    default:                return { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: status }
  }
}

type Tab = 'mine' | 'active' | 'signed' | 'sent_back'

function inboxStatusFor(role: string | null): string | null {
  if (role === 'employee')   return 'with_employee'
  if (role === 'supervisor') return 'with_supervisor'
  if (role === 'owner')      return 'with_owner'
  return null
}

export default async function DisbursementsInboxPage({
  searchParams,
}: {
  searchParams?: { tab?: string }
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

  const tenantId = profile.tenant_id as string
  const userId = profile.id as string
  const dsbRole = (profile.dsb_role as string | null) ?? null

  const tab: Tab = (() => {
    const t = (searchParams?.tab ?? '').toString()
    if (t === 'active' || t === 'signed' || t === 'sent_back' || t === 'mine') return t
    return 'mine'
  })()

  let query = svc
    .from('dsb_cases')
    .select(`id, case_number, voucher_number_text, voucher_date, amount_sar, status, submitted_at,
             project:dsb_projects!dsb_cases_project_id_fkey(id, code, name_ar, assigned_employee_id),
             developer:dsb_developers!dsb_cases_developer_id_fkey(company_name_ar)`)
    .eq('tenant_id', tenantId)
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(200)

  const myInboxStatus = inboxStatusFor(dsbRole)
  if (tab === 'mine') {
    if (!myInboxStatus) {
      // No specific inbox status — show nothing.
      query = query.eq('status', '__none__')
    } else {
      query = query.eq('status', myInboxStatus)
    }
  } else if (tab === 'active') {
    query = query.in('status', ['with_employee', 'with_supervisor', 'with_owner'])
  } else if (tab === 'signed') {
    query = query.eq('status', 'signed')
  } else if (tab === 'sent_back') {
    query = query.eq('status', 'sent_back_to_developer')
  }

  const { data } = await query
  let rows = (data ?? []) as CaseRow[]

  // For employees on "mine": restrict to projects they're assigned to.
  if (tab === 'mine' && dsbRole === 'employee') {
    rows = rows.filter((r) => {
      const p = single(r.project)
      return p?.assigned_employee_id === userId
    })
  }

  // Counts for tab badges.
  const [mineCount, activeCount, signedCount, sentBackCount] = await Promise.all([
    (async () => {
      if (!myInboxStatus) return 0
      const { count } = await svc
        .from('dsb_cases')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', myInboxStatus)
      return count ?? 0
    })(),
    (async () => {
      const { count } = await svc
        .from('dsb_cases')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('status', ['with_employee', 'with_supervisor', 'with_owner'])
      return count ?? 0
    })(),
    (async () => {
      const { count } = await svc
        .from('dsb_cases')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'signed')
      return count ?? 0
    })(),
    (async () => {
      const { count } = await svc
        .from('dsb_cases')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'sent_back_to_developer')
      return count ?? 0
    })(),
  ])

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'mine',      label: 'بانتظاري',          count: mineCount },
    { key: 'active',    label: 'كل النشطة',         count: activeCount },
    { key: 'signed',    label: 'الموقَّعة',           count: signedCount },
    { key: 'sent_back', label: 'المُعادة إلى المطوّر', count: sentBackCount },
  ]

  const canManage = dsbRole === 'employee' || dsbRole === 'supervisor' || dsbRole === 'owner'

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
            <FileText className="w-4 h-4" aria-hidden="true" />
            الصرف
          </div>
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">طلبات الصرف</h1>
          <p className="text-sm text-slate-600">مراجعة طلبات الصرف الواردة من المطوّرين واتخاذ القرار.</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/app/disbursements/new"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              سند صرف جديد
            </Link>
            <Link
              href="/app/disbursements/admin"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 transition"
            >
              <Settings className="w-4 h-4" aria-hidden="true" />
              إدارة
            </Link>
          </div>
        )}
      </header>

      <div className="border-b border-slate-200">
        <nav className="flex gap-2 -mb-px flex-wrap">
          {TABS.map((tInfo) => {
            const active = tab === tInfo.key
            return (
              <Link
                key={tInfo.key}
                href={`/app/disbursements?tab=${tInfo.key}`}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition ${
                  active
                    ? 'border-teal-600 text-teal-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                {tInfo.label}
                {tInfo.count > 0 && (
                  <span className={`inline-flex items-center justify-center min-w-[1.25rem] px-2 py-0.5 rounded-full text-xs font-semibold ${active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-700'}`}>
                    {tInfo.count}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>
      </div>

      <section>
        {rows.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-slate-500">
            لا يوجد شيء حاليًا.
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
            {rows.map((r) => {
              const pill = statusPill(r.status)
              const proj = single(r.project)
              const dev = single(r.developer)
              return (
                <Link
                  key={r.id}
                  href={`/app/disbursements/${r.id}`}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-xs text-slate-500">{r.case_number}</span>
                      {r.voucher_number_text && (
                        <>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs text-slate-500 truncate">{r.voucher_number_text}</span>
                        </>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {proj ? `${proj.code} — ${proj.name_ar}` : '—'}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {dev?.company_name_ar ?? '—'} · {fmtSar(r.amount_sar)} · {fmtDate(r.voucher_date)}
                    </div>
                  </div>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset ${pill.cls}`}>
                    {pill.label}
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-400 shrink-0 rotate-180" aria-hidden="true" />
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
