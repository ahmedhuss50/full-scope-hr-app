import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { FileText } from 'lucide-react'
import { BreakdownEditor, type BreakdownItem } from './BreakdownEditor'
import { ChecklistEditor, type ChecklistItem, type ChecklistResponse, type ChecklistStatus } from './ChecklistEditor'
import { DecisionBar } from './DecisionBar'
import { PdfOpener } from './PdfOpener'
import { ProcessDiagram } from './ProcessDiagram'

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
  status: CaseStatus
  notes: string | null
  submitted_at: string | null
  signed_at: string | null
  project: { id: string; code: string; name_ar: string; assigned_employee_id: string | null } | { id: string; code: string; name_ar: string; assigned_employee_id: string | null }[] | null
  developer: { id: string; company_name_ar: string } | { id: string; company_name_ar: string }[] | null
}

function single<T>(maybe: T | T[] | null | undefined): T | null {
  if (!maybe) return null
  return Array.isArray(maybe) ? (maybe[0] ?? null) : maybe
}

export default async function DisbursementCaseDetailPage({ params }: { params: { caseId: string } }) {
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
  const dsbRole = (profile.dsb_role as 'employee' | 'supervisor' | 'owner' | 'developer' | null) ?? null

  const { data: kaseRaw } = await svc
    .from('dsb_cases')
    .select(`id, case_number, voucher_number_text, voucher_date, amount_sar, status, notes, submitted_at, signed_at,
             project:dsb_projects!dsb_cases_project_id_fkey(id, code, name_ar, assigned_employee_id),
             developer:dsb_developers!dsb_cases_developer_id_fkey(id, company_name_ar)`)
    .eq('tenant_id', tenantId)
    .eq('id', params.caseId)
    .maybeSingle()
  const kase = kaseRaw as CaseRow | null
  if (!kase) notFound()

  const project = single(kase.project)
  const developer = single(kase.developer)
  const pill = statusPill(kase.status)

  const { data: uploads } = await svc
    .from('dsb_uploads')
    .select('id, filename, storage_path, storage_bucket, uploaded_at, file_size_bytes')
    .eq('tenant_id', tenantId)
    .eq('case_id', params.caseId)
    .order('uploaded_at', { ascending: false })

  const { data: breakdownRaw } = await svc
    .from('dsb_breakdown_items')
    .select('id, kind, page_from, page_to, summary_ar, order_index')
    .eq('tenant_id', tenantId)
    .eq('case_id', params.caseId)
    .order('order_index', { ascending: true })
    .order('id', { ascending: true })
  const breakdownItems = (breakdownRaw ?? []) as BreakdownItem[]

  type NoteRow = { id: string; body_ar: string; from_role: string | null; created_at: string; is_change_request: boolean }
  const { data: notesRaw } = await svc
    .from('dsb_notes')
    .select('id, body_ar, from_role, created_at, is_change_request')
    .eq('tenant_id', tenantId)
    .eq('case_id', params.caseId)
    .order('created_at', { ascending: false })
  const notes = (notesRaw ?? []) as NoteRow[]

  type AuditRow = { id: string; event: string; from_status: string | null; to_status: string | null; occurred_at: string; notes: string | null }
  const { data: auditRaw } = await svc
    .from('dsb_audit_log')
    .select('id, event, from_status, to_status, occurred_at, notes')
    .eq('tenant_id', tenantId)
    .eq('case_id', params.caseId)
    .order('occurred_at', { ascending: false })
  const audit = (auditRaw ?? []) as AuditRow[]

  // Assigned employee's display name for the process diagram.
  let assignedEmployeeName: string | null = null
  if (project?.assigned_employee_id) {
    const { data: assignedRow } = await svc
      .from('users')
      .select('full_name')
      .eq('id', project.assigned_employee_id)
      .maybeSingle()
    assignedEmployeeName = (assignedRow?.full_name as string | undefined) ?? null
  }

  // Checklist items visible to this tenant (global NULL or own tenant), ordered.
  const { data: checklistItemsRaw } = await svc
    .from('dsb_checklist_items')
    .select('id, code, order_index, prompt_ar, prompt_en, tenant_id, active')
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .eq('active', true)
    .order('order_index', { ascending: true })
  const checklistItems: ChecklistItem[] = ((checklistItemsRaw ?? []) as Array<{
    id: string; code: string; order_index: number; prompt_ar: string; prompt_en: string
  }>).map((r) => ({
    id: r.id,
    code: r.code,
    order_index: r.order_index,
    prompt_ar: r.prompt_ar,
    prompt_en: r.prompt_en,
  }))

  // Existing responses for this case.
  const { data: checklistRespRaw } = await svc
    .from('dsb_case_checklist_responses')
    .select('id, checklist_item_id, status, notes, ai_suggested_status')
    .eq('tenant_id', tenantId)
    .eq('case_id', params.caseId)
  const checklistResponses: ChecklistResponse[] = ((checklistRespRaw ?? []) as Array<{
    id: string; checklist_item_id: string; status: ChecklistStatus; notes: string | null;
    ai_suggested_status: ChecklistStatus | null
  }>).map((r) => ({
    id: r.id,
    checklist_item_id: r.checklist_item_id,
    status: r.status,
    notes: r.notes,
    ai_suggested_status: r.ai_suggested_status,
  }))

  const isAssignedEmployee = !!project && project.assigned_employee_id === userId
  const canEditChecklist = dsbRole === 'employee' || dsbRole === 'supervisor'
  // Breakdown is editable only by the role currently responsible.
  const breakdownEditable =
    (kase.status === 'with_employee' && dsbRole === 'employee' && isAssignedEmployee) ||
    (kase.status === 'with_supervisor' && dsbRole === 'supervisor') ||
    (kase.status === 'with_owner' && dsbRole === 'owner')

  const upload = (uploads ?? [])[0] as { id: string; filename: string; storage_path: string | null; storage_bucket: string | null; uploaded_at: string; file_size_bytes: number | null } | undefined

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      <header className="space-y-2">
        <Link href="/app/disbursements" className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700">
          ← العودة إلى طلبات الصرف
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700 mb-1">
              <FileText className="w-4 h-4" aria-hidden="true" />
              {kase.case_number}
            </div>
            <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
              {project ? `${project.code} — ${project.name_ar}` : '—'}
            </h1>
            <div className="text-sm text-slate-600 mt-1">
              {developer?.company_name_ar ?? '—'}
            </div>
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ring-1 ring-inset ${pill.cls}`}>
            {pill.label}
          </span>
        </div>
      </header>

      <ProcessDiagram
        status={kase.status}
        developerName={developer?.company_name_ar ?? '—'}
        assignedEmployeeName={assignedEmployeeName ?? '—'}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
            <h2 className="serif font-bold text-lg text-slate-900">بيانات الطلب</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <Detail label="رقم السند" value={kase.voucher_number_text ?? '—'} />
              <Detail label="تاريخ السند" value={fmtDate(kase.voucher_date)} />
              <Detail label="المبلغ" value={fmtSar(kase.amount_sar)} />
              <Detail label="وقت الإرسال" value={fmtDate(kase.submitted_at)} />
              {kase.signed_at && <Detail label="وقت التوقيع" value={fmtDate(kase.signed_at)} />}
            </div>
            {kase.notes && (
              <div className="pt-3 border-t border-slate-100">
                <div className="text-xs font-semibold text-slate-500 mb-1">ملاحظات المطوّر</div>
                <div className="text-sm text-slate-800 whitespace-pre-wrap">{kase.notes}</div>
              </div>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
            <h2 className="serif font-bold text-lg text-slate-900">ملف PDF</h2>
            {!upload ? (
              <div className="text-sm text-slate-500">لا يوجد ملف مرفوع.</div>
            ) : (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-white">
                <FileText className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{upload.filename}</div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    {upload.file_size_bytes ? `${(upload.file_size_bytes / 1024 / 1024).toFixed(2)} MB · ` : ''}{fmtDate(upload.uploaded_at)}
                  </div>
                </div>
                <PdfOpener caseId={kase.id} uploadId={upload.id} />
              </div>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="serif font-bold text-lg text-slate-900">تصنيف المستندات</h2>
                <p className="text-xs text-slate-500 mt-1">قسّم الملف إلى أقسام مصنّفة (النوع + نطاق الصفحات + ملخّص قصير).</p>
              </div>
            </div>
            <BreakdownEditor caseId={kase.id} items={breakdownItems} readOnly={!breakdownEditable} />
          </section>

          <ChecklistEditor
            caseId={kase.id}
            items={checklistItems}
            responses={checklistResponses}
            canEdit={canEditChecklist}
          />
        </div>

        <div className="space-y-6">
          <DecisionBar
            caseId={kase.id}
            status={kase.status}
            dsbRole={dsbRole}
            isAssignedEmployee={isAssignedEmployee}
          />

          {notes.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
              <h3 className="serif font-bold text-base text-slate-900">الملاحظات بين الأدوار</h3>
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className={`rounded-lg p-3 border text-sm ${n.is_change_request ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="text-xs text-slate-500 mb-1">
                      {n.from_role ?? '—'} · {fmtDate(n.created_at)}
                    </div>
                    <div className="text-sm text-slate-800 whitespace-pre-wrap">{n.body_ar}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {audit.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
              <h3 className="serif font-bold text-base text-slate-900">السجل</h3>
              <ul className="space-y-2 text-xs">
                {audit.map((a) => (
                  <li key={a.id} className="flex items-start gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-teal-400 mt-1.5 shrink-0" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900">{a.event}</div>
                      <div className="text-slate-500">
                        {a.from_status ?? '—'} → {a.to_status ?? '—'} · {fmtDate(a.occurred_at)}
                      </div>
                      {a.notes && <div className="text-slate-600 mt-1 whitespace-pre-wrap">{a.notes}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
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
