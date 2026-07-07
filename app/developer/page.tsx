import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { FileText, Plus, ArrowRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

type CaseRow = {
  id: string
  case_number: string
  voucher_number_text: string | null
  voucher_date: string | null
  amount_sar: number | null
  status: string
  submitted_at: string | null
  created_at: string
  project: { id: string; code: string; name_ar: string } | { id: string; code: string; name_ar: string }[] | null
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
    case 'draft':
      return { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: 'مسودة' }
    case 'with_employee':
    case 'with_supervisor':
    case 'with_owner':
      return { cls: 'bg-blue-50 text-blue-700 ring-blue-200', label: 'قيد المراجعة' }
    case 'sent_back_to_developer':
      return { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'أُعيدت إليك' }
    case 'signed':
      return { cls: 'bg-green-50 text-green-700 ring-green-200', label: 'جاهزة للتسليم' }
    case 'cancelled':
      return { cls: 'bg-slate-100 text-slate-500 ring-slate-200', label: 'ملغاة' }
    default:
      return { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: status }
  }
}

export default async function DeveloperHomePage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile || profile.dsb_role !== 'developer') redirect('/login')

  const tenantId = profile.tenant_id as string
  const userId = profile.id as string

  // Find this developer's row.
  const { data: dev } = await svc
    .from('dsb_developers')
    .select('id, company_name_ar')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle()

  const cases: CaseRow[] = dev
    ? (((await svc
        .from('dsb_cases')
        .select(`id, case_number, voucher_number_text, voucher_date, amount_sar, status, submitted_at, created_at,
                 project:dsb_projects!dsb_cases_project_id_fkey(id, code, name_ar)`)
        .eq('tenant_id', tenantId)
        .eq('developer_id', dev.id)
        .order('created_at', { ascending: false })
        .limit(50)).data ?? []) as CaseRow[])
    : []

  return (
    <div className="space-y-8 max-w-5xl mx-auto" dir="rtl">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
            <FileText className="w-4 h-4" aria-hidden="true" />
            صرفياتي
          </div>
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            {dev?.company_name_ar ?? 'مرحبًا'}
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl">
            أنشئ طلبات الصرف وتابع حالتها حتى التوقيع.
          </p>
        </div>
        <Link
          href="/developer/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          طلب صرف جديد
        </Link>
      </header>

      <section className="space-y-4">
        {cases.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-slate-500">
            لا توجد طلبات بعد — أنشئ أول طلب لك.
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
            {cases.map((c) => {
              const pill = statusPill(c.status)
              const proj = single(c.project)
              return (
                <Link
                  key={c.id}
                  href={`/developer/${c.id}`}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-xs text-slate-500">{c.case_number}</span>
                      {c.voucher_number_text && (
                        <>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs text-slate-500 truncate">{c.voucher_number_text}</span>
                        </>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {proj ? `${proj.code} — ${proj.name_ar}` : '—'}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{fmtSar(c.amount_sar)} · {fmtDate(c.voucher_date)}</div>
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
