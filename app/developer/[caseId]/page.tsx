import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { FileText } from 'lucide-react'

export const dynamic = 'force-dynamic'

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
    case 'draft': return { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: 'مسودة' }
    case 'with_employee':
    case 'with_supervisor':
    case 'with_owner':
      return { cls: 'bg-blue-50 text-blue-700 ring-blue-200', label: 'قيد المراجعة' }
    case 'sent_back_to_developer': return { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'أُعيدت إليك' }
    case 'signed': return { cls: 'bg-green-50 text-green-700 ring-green-200', label: 'موقَّعة' }
    case 'cancelled': return { cls: 'bg-slate-100 text-slate-500 ring-slate-200', label: 'ملغاة' }
    default: return { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: status }
  }
}

export default async function DeveloperCaseDetailPage({ params }: { params: { caseId: string } }) {
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

  const { data: dev } = await svc
    .from('dsb_developers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!dev) notFound()

  type CaseRow = {
    id: string
    case_number: string
    voucher_number_text: string | null
    voucher_date: string | null
    amount_sar: number | null
    status: string
    notes: string | null
    submitted_at: string | null
    project: { code: string; name_ar: string } | { code: string; name_ar: string }[] | null
  }

  const { data: kase } = await svc
    .from('dsb_cases')
    .select(`id, case_number, voucher_number_text, voucher_date, amount_sar, status, notes, submitted_at,
             project:dsb_projects!dsb_cases_project_id_fkey(code, name_ar)`)
    .eq('tenant_id', tenantId)
    .eq('id', params.caseId)
    .eq('developer_id', dev.id)
    .maybeSingle()
  if (!kase) notFound()
  const row = kase as CaseRow

  const { data: uploads } = await svc
    .from('dsb_uploads')
    .select('id, filename, storage_path, storage_bucket, uploaded_at')
    .eq('tenant_id', tenantId)
    .eq('case_id', params.caseId)
    .order('uploaded_at', { ascending: false })

  type NoteRow = { id: string; body_ar: string; from_role: string | null; created_at: string; is_change_request: boolean }
  const { data: notes } = await svc
    .from('dsb_notes')
    .select('id, body_ar, from_role, created_at, is_change_request')
    .eq('tenant_id', tenantId)
    .eq('case_id', params.caseId)
    .order('created_at', { ascending: false })

  const project = Array.isArray(row.project) ? row.project[0] : row.project
  const pill = statusPill(row.status)
  const canResubmit = row.status === 'sent_back_to_developer'

  return (
    <div className="max-w-4xl mx-auto space-y-6" dir="rtl">
      <header className="space-y-2">
        <Link href="/developer" className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700">
          ← العودة إلى صرفياتي
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
              {row.case_number}
            </h1>
            <div className="text-sm text-slate-600 mt-1">
              {project ? `${project.code} — ${project.name_ar}` : '—'}
            </div>
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ring-1 ring-inset ${pill.cls}`}>
            {pill.label}
          </span>
        </div>
      </header>

      <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
        <h2 className="serif font-bold text-lg text-slate-900 mb-2">بيانات الطلب</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <Detail label="رقم السند" value={row.voucher_number_text ?? '—'} />
          <Detail label="تاريخ السند" value={fmtDate(row.voucher_date)} />
          <Detail label="المبلغ" value={fmtSar(row.amount_sar)} />
          <Detail label="وقت الإرسال" value={fmtDate(row.submitted_at)} />
        </div>
        {row.notes && (
          <div className="pt-3 border-t border-slate-100">
            <div className="text-xs font-semibold text-slate-500 mb-1">ملاحظات</div>
            <div className="text-sm text-slate-800 whitespace-pre-wrap">{row.notes}</div>
          </div>
        )}
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
        <h2 className="serif font-bold text-lg text-slate-900 mb-2">ملف PDF</h2>
        {(uploads ?? []).length === 0 ? (
          <div className="text-sm text-slate-500">لا يوجد ملف مرفوع.</div>
        ) : (
          <ul className="space-y-2">
            {(uploads ?? []).map((u) => (
              <li key={u.id} className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-white">
                <FileText className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{u.filename}</div>
                  <div className="text-[11px] text-slate-500">{fmtDate(u.uploaded_at)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(notes ?? []).length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
          <h2 className="serif font-bold text-lg text-slate-900 mb-2">السجل والملاحظات</h2>
          <ul className="space-y-3">
            {(notes ?? []).map((n: NoteRow) => (
              <li key={n.id} className={`rounded-lg p-3 border ${n.is_change_request ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                <div className="text-xs text-slate-500 mb-1">
                  {n.from_role ?? '—'} · {fmtDate(n.created_at)}
                </div>
                <div className="text-sm text-slate-800 whitespace-pre-wrap">{n.body_ar}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canResubmit && (
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <h3 className="font-bold text-amber-900 mb-2">يتطلب الطلب تعديلًا</h3>
          <p className="text-sm text-amber-800 mb-4">
            راجع ملاحظات الفريق، عدّل ملف PDF إن لزم الأمر ثم أعِد إرسال الطلب من خلال إنشاء طلب جديد أو رفع ملف بديل عبر صفحة الطلب الجديد.
          </p>
          <Link
            href="/developer/new"
            className="inline-flex items-center px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold shadow-sm hover:bg-amber-700 transition"
          >
            رفع طلب بديل
          </Link>
        </section>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-500 mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
    </div>
  )
}
