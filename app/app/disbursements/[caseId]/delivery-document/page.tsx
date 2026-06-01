import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { PrintButton } from './PrintButton'

export const dynamic = 'force-dynamic'

function fmtSar(amount: number | null): string {
  if (amount == null) return '—'
  try {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: 'SAR',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${amount} ر.س`
  }
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(s))
  } catch {
    return s
  }
}

function fmtDateTime(s: string | null): string {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return new Intl.DateTimeFormat('ar-SA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  } catch {
    return s
  }
}

type CaseStatus =
  | 'draft'
  | 'with_employee'
  | 'with_supervisor'
  | 'with_owner'
  | 'sent_back_to_developer'
  | 'signed'
  | 'cancelled'

type CaseRow = {
  id: string
  case_number: string
  voucher_number_text: string | null
  voucher_date: string | null
  amount_sar: number | null
  delivery_date: string | null
  status: CaseStatus
  notes: string | null
  signed_at: string | null
  signed_by_user_id: string | null
  project:
    | { id: string; code: string; name_ar: string }
    | { id: string; code: string; name_ar: string }[]
    | null
  developer:
    | { id: string; company_name_ar: string }
    | { id: string; company_name_ar: string }[]
    | null
}

function single<T>(maybe: T | T[] | null | undefined): T | null {
  if (!maybe) return null
  return Array.isArray(maybe) ? (maybe[0] ?? null) : maybe
}

export default async function DeliveryDocumentPage({
  params,
}: {
  params: { caseId: string }
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

  const { data: kaseRaw } = await svc
    .from('dsb_cases')
    .select(
      `id, case_number, voucher_number_text, voucher_date, amount_sar, delivery_date, status, notes, signed_at, signed_by_user_id,
       project:dsb_projects!dsb_cases_project_id_fkey(id, code, name_ar),
       developer:dsb_developers!dsb_cases_developer_id_fkey(id, company_name_ar)`,
    )
    .eq('tenant_id', tenantId)
    .eq('id', params.caseId)
    .maybeSingle()
  const kase = kaseRaw as CaseRow | null
  if (!kase) notFound()

  // Gate: only show when signed.
  if (kase.status !== 'signed') {
    return (
      <div className="max-w-3xl mx-auto py-12 px-6" dir="rtl">
        <div className="bg-white border border-amber-200 rounded-xl p-6 shadow-sm">
          <h1 className="serif font-black text-xl text-slate-900 mb-2">
            وثيقة التسليم
          </h1>
          <p className="text-sm text-amber-800">
            وثيقة التسليم متاحة فقط بعد التوقيع النهائي.
          </p>
          <Link
            href={`/app/disbursements/${kase.id}`}
            className="inline-flex items-center mt-4 text-sm font-semibold text-teal-700 hover:text-teal-900"
          >
            ← العودة إلى تفاصيل الطلب
          </Link>
        </div>
      </div>
    )
  }

  const project = single(kase.project)
  const developer = single(kase.developer)

  // Look up the signing user (e.g. Mahdi).
  let signedByName: string | null = null
  if (kase.signed_by_user_id) {
    const { data: u } = await svc
      .from('users')
      .select('full_name')
      .eq('id', kase.signed_by_user_id)
      .maybeSingle()
    signedByName = (u?.full_name as string | undefined) ?? null
  }

  const today = new Date().toISOString()
  const signedDisplay = kase.signed_at
    ? `${signedByName ?? '—'} · ${fmtDateTime(kase.signed_at)}`
    : (signedByName ?? '—')

  return (
    <div dir="rtl" className="bg-slate-50 min-h-screen print:bg-white">
      <div className="max-w-[210mm] mx-auto px-4 py-6 print:py-0 print:px-0">
        {/* Toolbar (hidden in print) */}
        <div className="flex items-center justify-between mb-4 print:hidden">
          <Link
            href={`/app/disbursements/${kase.id}`}
            className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
          >
            ← العودة إلى تفاصيل الطلب
          </Link>
          <PrintButton label="طباعة / حفظ كـ PDF" />
        </div>

        {/* A4 sheet */}
        <article
          className="bg-white border border-slate-200 shadow-sm print:shadow-none print:border-0 mx-auto"
          style={{
            width: '210mm',
            minHeight: '297mm',
            padding: '24mm 20mm',
            boxSizing: 'border-box',
          }}
        >
          {/* Letterhead */}
          <header className="text-center pb-6 border-b-2 border-slate-900">
            <div className="serif font-black text-3xl tracking-tight text-slate-900">
              FULL SCOPE
            </div>
            <div className="text-sm text-slate-600 mt-1">إدارة الصرفيات</div>
          </header>

          {/* Title */}
          <div className="text-center my-10">
            <h1 className="serif font-black text-3xl text-slate-900 mb-1">
              وثيقة تسليم
            </h1>
            <div className="text-xs tracking-[0.2em] text-slate-500">
              DELIVERY DOCUMENT
            </div>
          </div>

          {/* Facts grid */}
          <section className="space-y-3 text-sm">
            <FactRow label="رقم القضية" value={kase.case_number} mono />
            <FactRow label="تاريخ الإصدار" value={fmtDate(today)} />
            <FactRow
              label="المشروع"
              value={project ? `${project.code} — ${project.name_ar}` : '—'}
            />
            <FactRow label="العميل" value={developer?.company_name_ar ?? '—'} />
            <FactRow
              label="رقم وثيقة الصرف"
              value={kase.voucher_number_text ?? '—'}
              mono
            />
            <FactRow label="المبلغ" value={fmtSar(kase.amount_sar)} mono />
            <FactRow label="تاريخ السند" value={fmtDate(kase.voucher_date)} />
            <FactRow label="تاريخ التسليم" value={fmtDate(kase.delivery_date)} />
            <FactRow label="الحالة" value="موقّعة" />
            <FactRow label="وقع نهائياً" value={signedDisplay} />
          </section>

          {/* Notes */}
          {kase.notes && (
            <section className="mt-8 pt-6 border-t border-slate-200">
              <div className="text-xs font-semibold text-slate-500 mb-2">ملاحظات</div>
              <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                {kase.notes}
              </p>
            </section>
          )}

          {/* Signature block */}
          <section className="mt-20 pt-8">
            <div className="flex justify-end">
              <div className="text-center">
                <div className="text-sm font-semibold text-slate-700 mb-12">
                  توقيع الإدارة
                </div>
                <div className="border-t border-slate-400 w-56" />
              </div>
            </div>
          </section>
        </article>
      </div>

      {/* Print rules */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0; }
          html, body { background: white !important; }
        }
      `}</style>
    </div>
  )
}

function FactRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline gap-4 py-1.5 border-b border-dotted border-slate-200">
      <div className="w-44 shrink-0 text-xs font-semibold text-slate-500">
        {label}
      </div>
      <div
        className={`text-sm font-semibold text-slate-900 ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </div>
    </div>
  )
}
