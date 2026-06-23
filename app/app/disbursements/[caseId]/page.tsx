import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { FileText } from 'lucide-react'
import { BreakdownEditor, type BreakdownItem } from './BreakdownEditor'
import { ChecklistEditor, type ChecklistItem, type ChecklistResponse, type ChecklistStatus } from './ChecklistEditor'
import { DecisionBar } from './DecisionBar'
import { ExtractedFieldsPanel, type ExtractedFields } from './ExtractedFieldsPanel'
import { PdfOpener } from './PdfOpener'
import { ProcessDiagram } from './ProcessDiagram'
import { SignedDocumentCard } from './SignedDocumentCard'
import { DeleteCaseButton } from '../admin/EntityDeleteButtons'
import { EditCaseInfo } from './EditCaseInfo'
import { EditExtractedFields } from './EditExtractedFields'
import { AiReviewButton } from './AiReviewButton'
import { ReplaceDocumentButton } from './ReplaceDocumentButton'
import { CommentsThread, type CommentRow } from './CommentsThread'
import { RevertSignatureButton } from './RevertSignatureButton'
import { DeliverDocumentButton } from './DeliverDocumentButton'
import { AttachmentsSection } from './AttachmentsSection'
import { fmtDate, fmtDateTime } from '@/lib/dsb/datetime'

export const dynamic = 'force-dynamic'

function fmtSar(amount: number | null): string {
  if (amount == null) return '—'
  try {
    return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${amount} ر.س`
  }
}

function statusPill(status: string): { cls: string; label: string } {
  switch (status) {
    case 'with_employee':   return { cls: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'بانتظار الموظف' }
    case 'with_supervisor': return { cls: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'بانتظار المشرف' }
    case 'with_owner':      return { cls: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'بانتظار التوقيع' }
    case 'sent_back_to_developer': return { cls: 'bg-red-50 text-red-700 ring-red-200', label: 'أُعيدت إلى المطوّر' }
    case 'signed':          return { cls: 'bg-green-50 text-green-700 ring-green-200', label: 'موقَّعة' }
    case 'delivered':       return { cls: 'bg-blue-50 text-blue-700 ring-blue-200',     label: 'مسلَّمة (مؤرشفة)' }
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
  | 'delivered'
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
  submitted_at: string | null
  signed_at: string | null
  signed_document_path: string | null
  signed_document_filename: string | null
  extracted_fields: ExtractedFields | null
  extraction_cost_usd: number | null
  extraction_model: string | null
  extracted_at: string | null
  delivered_at: string | null
  delivered_by_user_id: string | null
  recipient_name: string | null
  recipient_id_number: string | null
  recipient_phone: string | null
  recipient_notes: string | null
  delivery_notes: string | null
  project:
    | { id: string; code: string; name_ar: string; assigned_employee_id: string | null; bank_name: string | null; bank_account: string | null; bank_iban: string | null }
    | { id: string; code: string; name_ar: string; assigned_employee_id: string | null; bank_name: string | null; bank_account: string | null; bank_iban: string | null }[]
    | null
  developer:
    | { id: string; company_name_ar: string; bank_name: string | null; bank_account: string | null; bank_iban: string | null }
    | { id: string; company_name_ar: string; bank_name: string | null; bank_account: string | null; bank_iban: string | null }[]
    | null
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
    .select(`id, case_number, voucher_number_text, voucher_date, amount_sar, delivery_date, status, notes, submitted_at, signed_at, signed_document_path, signed_document_filename, extracted_fields, extraction_cost_usd, extraction_model, extracted_at, delivered_at, delivered_by_user_id, recipient_name, recipient_id_number, recipient_phone, recipient_notes, delivery_notes,
             project:dsb_projects!dsb_cases_project_id_fkey(id, code, name_ar, assigned_employee_id, bank_name, bank_account, bank_iban),
             developer:dsb_developers!dsb_cases_developer_id_fkey(id, company_name_ar, bank_name, bank_account, bank_iban)`)
    .eq('tenant_id', tenantId)
    .eq('id', params.caseId)
    .maybeSingle()
  const kase = kaseRaw as CaseRow | null
  if (!kase) notFound()

  // The extracted_fields column is JSONB; cast to our shape (it may be null
  // when the AI breakdown workflow hasn't run yet, or when the extracted
  // sub-block was absent from Claude's response).
  const extractedFields: ExtractedFields | null = (kase.extracted_fields ?? null) as ExtractedFields | null

  const project = single(kase.project)
  const developer = single(kase.developer)
  const pill = statusPill(kase.status)

  // Include version-tracking fields: superseded_at filters CURRENT (active) vs
  // historical uploads. We display the most recent NON-superseded one as the
  // primary PDF; historical rows show in the version-history list.
  // `category` distinguishes the primary voucher from supplementary
  // attachments — without filtering on it here, attachments would show up
  // as if they were main PDFs.
  const { data: uploads } = await svc
    .from('dsb_uploads')
    .select('id, filename, storage_path, storage_bucket, uploaded_at, file_size_bytes, superseded_at, replaced_by_user_id, replacement_reason')
    .eq('tenant_id', tenantId)
    .eq('case_id', params.caseId)
    .eq('category', 'primary')
    .order('uploaded_at', { ascending: false })

  // Supplementary attachments — separate section.
  const { data: attachmentsRaw } = await svc
    .from('dsb_uploads')
    .select('id, filename, attachment_label, file_size_bytes, mime_type, uploaded_at, uploaded_by_user_id')
    .eq('tenant_id', tenantId)
    .eq('case_id', params.caseId)
    .eq('category', 'supplementary')
    .order('uploaded_at', { ascending: false })
  const attachments = (attachmentsRaw ?? []) as Array<{
    id: string
    filename: string
    attachment_label: string | null
    file_size_bytes: number | null
    mime_type: string | null
    uploaded_at: string
    uploaded_by_user_id: string | null
  }>

  // Per-case comments thread. Soft-deleted comments are hidden.
  const { data: commentsRaw } = await svc
    .from('dsb_case_comments')
    .select('id, body, created_at, author:users!dsb_case_comments_author_user_id_fkey(id, full_name, email, dsb_role)')
    .eq('tenant_id', tenantId)
    .eq('case_id', params.caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  const comments: CommentRow[] = ((commentsRaw ?? []) as Array<{
    id: string
    body: string
    created_at: string
    author:
      | { id: string; full_name: string | null; email: string | null; dsb_role: string | null }
      | { id: string; full_name: string | null; email: string | null; dsb_role: string | null }[]
      | null
  }>).map((c) => {
    const a = Array.isArray(c.author) ? c.author[0] : c.author
    return {
      id: c.id,
      body: c.body,
      created_at: c.created_at,
      author: {
        id: a?.id ?? '',
        full_name: a?.full_name ?? null,
        email: a?.email ?? null,
        dsb_role: (a?.dsb_role as 'employee' | 'supervisor' | 'owner' | null) ?? null,
      },
    }
  })

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
  const canEditChecklist = dsbRole === 'employee' || dsbRole === 'supervisor' || dsbRole === 'owner'
  // Breakdown is editable only by the role currently responsible.
  const breakdownEditable =
    (kase.status === 'with_employee' && dsbRole === 'employee' && isAssignedEmployee) ||
    (kase.status === 'with_supervisor' && dsbRole === 'supervisor') ||
    (kase.status === 'with_owner' && dsbRole === 'owner')

  // Find the CURRENT (non-superseded) upload — that's the active PDF reviewers
  // should see. Historical versions still live in `uploads`; we surface them
  // in the document-history card below the main PDF section.
  type UploadRow = {
    id: string
    filename: string
    storage_path: string | null
    storage_bucket: string | null
    uploaded_at: string
    file_size_bytes: number | null
    superseded_at: string | null
    replaced_by_user_id: string | null
    replacement_reason: string | null
  }
  const allUploads = (uploads ?? []) as UploadRow[]
  const upload = allUploads.find((u) => !u.superseded_at)
  const supersededUploads = allUploads.filter((u) => u.superseded_at)

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
          <div className="flex items-center gap-2 flex-wrap">
            {kase.status === 'signed' && (
              <Link
                href={`/app/disbursements/${kase.id}/delivery-document`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
              >
                <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                إصدار وثيقة تسليم
              </Link>
            )}
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ring-1 ring-inset ${pill.cls}`}>
              {pill.label}
            </span>
            {kase.status === 'signed' && dsbRole === 'owner' && (
              <RevertSignatureButton caseId={kase.id} />
            )}
            {kase.status === 'signed' && (dsbRole === 'employee' || dsbRole === 'supervisor' || dsbRole === 'owner') && (
              <DeliverDocumentButton caseId={kase.id} />
            )}
            {dsbRole === 'owner' && (
              <DeleteCaseButton
                caseId={kase.id}
                caseNumber={kase.case_number}
                size="sm"
              />
            )}
          </div>
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
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="serif font-bold text-lg text-slate-900">بيانات الطلب</h2>
              <EditCaseInfo
                kase={{
                  id: kase.id,
                  voucher_number_text: kase.voucher_number_text,
                  voucher_date: kase.voucher_date,
                  amount_sar: kase.amount_sar,
                  delivery_date: kase.delivery_date,
                  notes: kase.notes,
                }}
                canEdit={dsbRole === 'employee' || dsbRole === 'supervisor' || dsbRole === 'owner'}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <Detail label="رقم السند" value={kase.voucher_number_text ?? '—'} />
              <Detail label="تاريخ السند" value={fmtDate(kase.voucher_date)} />
              <Detail label="المبلغ" value={fmtSar(kase.amount_sar)} />
              <Detail label="تاريخ التسليم" value={fmtDate(kase.delivery_date)} />
              <Detail label="وقت الإرسال" value={fmtDateTime(kase.submitted_at)} />
              {kase.signed_at && <Detail label="وقت التوقيع" value={fmtDateTime(kase.signed_at)} />}
              {kase.extraction_cost_usd != null && (
                <Detail
                  label="تكلفة الاستخراج"
                  value={`$${Number(kase.extraction_cost_usd).toFixed(4)}${kase.extraction_model ? ` · ${kase.extraction_model.includes('haiku') ? 'Haiku' : kase.extraction_model.includes('sonnet') ? 'Sonnet' : kase.extraction_model}` : ''}`}
                />
              )}
            </div>
            {kase.notes && (
              <div className="pt-3 border-t border-slate-100">
                <div className="text-xs font-semibold text-slate-500 mb-1">ملاحظات المطوّر</div>
                <div className="text-sm text-slate-800 whitespace-pre-wrap">{kase.notes}</div>
              </div>
            )}
          </section>

          {(() => {
            // Project-level bank wins (حساب المشروع). When the project hasn't been
            // tagged yet we fall back to the developer's bank so something useful
            // still shows.
            const payerBankName = project?.bank_name || developer?.bank_name || null
            const payerAccount = project?.bank_account || developer?.bank_account || null
            const payerIban = project?.bank_iban || developer?.bank_iban || null
            const payerSourceLabel = project?.bank_name || project?.bank_account || project?.bank_iban
              ? 'حساب المشروع'
              : (developer?.bank_name || developer?.bank_account || developer?.bank_iban
                  ? 'بنك المطور (افتراضي)'
                  : null)
            const anyPayer = !!(payerBankName || payerAccount || payerIban)
            const anyBeneficiary = !!(
              extractedFields?.beneficiary_bank_name ||
              extractedFields?.beneficiary_account_number ||
              extractedFields?.beneficiary_iban ||
              extractedFields?.beneficiary_name_ar
            )
            if (!anyPayer && !anyBeneficiary) return null
            return (
              <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                <h2 className="serif font-bold text-lg text-slate-900 mb-3">مسار التحويل المالي</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">من (حساب المشروع)</div>
                      {payerSourceLabel && (
                        <span className="text-[10px] text-blue-600/80 font-mono">{payerSourceLabel}</span>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-slate-900">{project?.name_ar ?? developer?.company_name_ar ?? '—'}</div>
                    {payerBankName && (
                      <div className="text-xs text-slate-700">
                        <span className="text-slate-500">البنك:</span> {payerBankName}
                      </div>
                    )}
                    {payerAccount && (
                      <div className="text-xs text-slate-700 font-mono" dir="ltr">
                        <span className="font-sans text-slate-500">الحساب: </span>{payerAccount}
                      </div>
                    )}
                    {payerIban && (
                      <div className="text-xs text-slate-700 font-mono" dir="ltr">
                        <span className="font-sans text-slate-500">IBAN: </span>{payerIban}
                      </div>
                    )}
                    {!anyPayer && (
                      <div className="text-xs text-slate-500 italic">لم يتم تسجيل حساب للمشروع أو للمطور بعد.</div>
                    )}
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 space-y-1.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">إلى (حساب المستفيد)</div>
                    <div className="text-sm font-semibold text-slate-900">{(extractedFields?.beneficiary_name_ar as string | null) ?? '—'}</div>
                    {extractedFields?.beneficiary_bank_name && (
                      <div className="text-xs text-slate-700">
                        <span className="text-slate-500">البنك:</span> {extractedFields.beneficiary_bank_name}
                      </div>
                    )}
                    {extractedFields?.beneficiary_account_number && (
                      <div className="text-xs text-slate-700 font-mono" dir="ltr">
                        <span className="font-sans text-slate-500">الحساب: </span>{extractedFields.beneficiary_account_number}
                      </div>
                    )}
                    {extractedFields?.beneficiary_iban && (
                      <div className="text-xs text-slate-700 font-mono" dir="ltr">
                        <span className="font-sans text-slate-500">IBAN: </span>{extractedFields.beneficiary_iban}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )
          })()}

          {kase.signed_document_path && (
            <SignedDocumentCard
              caseId={kase.id}
              filename={kase.signed_document_filename ?? 'signed.pdf'}
            />
          )}

          {kase.status === 'delivered' && (
            <section className="bg-white border border-blue-200 rounded-xl p-6 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="serif font-bold text-lg text-slate-900">معلومات التسليم</h2>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset bg-blue-50 text-blue-700 ring-blue-200">
                  مؤرشفة
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <Detail label="اسم المستلم" value={kase.recipient_name ?? '—'} />
                <Detail label="وقت التسليم" value={fmtDateTime(kase.delivered_at)} />
                {kase.recipient_phone && (
                  <Detail label="رقم الجوال" value={kase.recipient_phone} />
                )}
              </div>
              {kase.recipient_notes && (
                <div className="pt-3 border-t border-slate-100">
                  <div className="text-xs font-semibold text-slate-500 mb-1">ملاحظات عن المستلم</div>
                  <div className="text-sm text-slate-800 whitespace-pre-wrap">{kase.recipient_notes}</div>
                </div>
              )}
              {kase.delivery_notes && (
                <div className="pt-3 border-t border-slate-100">
                  <div className="text-xs font-semibold text-slate-500 mb-1">ملاحظات عن التسليم</div>
                  <div className="text-sm text-slate-800 whitespace-pre-wrap">{kase.delivery_notes}</div>
                </div>
              )}
            </section>
          )}

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="serif font-bold text-lg text-slate-900">ملف PDF</h2>
              {upload && (dsbRole === 'employee' || dsbRole === 'supervisor' || dsbRole === 'owner') && (
                <ReplaceDocumentButton caseId={kase.id} />
              )}
            </div>

            {supersededUploads.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 leading-relaxed">
                ⚠ تم استبدال الوثيقة الأصلية. النسخة الحالية هي أحدث نسخة مرفوعة. النسخ السابقة محفوظة في السجل أدناه.
              </div>
            )}

            {!upload ? (
              <div className="text-sm text-slate-500">لا يوجد ملف مرفوع.</div>
            ) : (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-white">
                <FileText className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{upload.filename}</div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    {upload.file_size_bytes ? `${(upload.file_size_bytes / 1024 / 1024).toFixed(2)} MB · ` : ''}{fmtDateTime(upload.uploaded_at)}
                  </div>
                </div>
                <PdfOpener caseId={kase.id} uploadId={upload.id} />
              </div>
            )}

            {supersededUploads.length > 0 && (
              <details className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                <summary className="text-xs font-semibold text-slate-700 cursor-pointer">
                  سجل النسخ السابقة ({supersededUploads.length})
                </summary>
                <ul className="mt-2 space-y-2">
                  {supersededUploads.map((u) => (
                    <li key={u.id} className="flex items-center gap-3 p-2 rounded-md border border-slate-200 bg-white">
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-slate-700 truncate">{u.filename}</div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          رُفعت {fmtDateTime(u.uploaded_at)} · استُبدلت {u.superseded_at ? fmtDateTime(u.superseded_at) : '—'}
                        </div>
                        {u.replacement_reason && (
                          <div className="text-[11px] text-slate-600 mt-0.5 leading-snug">السبب: {u.replacement_reason}</div>
                        )}
                      </div>
                      <PdfOpener caseId={kase.id} uploadId={u.id} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          <AttachmentsSection
            caseId={kase.id}
            attachments={attachments}
            currentUserId={userId}
            isOwner={dsbRole === 'owner'}
          />

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="serif font-bold text-lg text-slate-900">تصنيف المستندات</h2>
                <p className="text-xs text-slate-500 mt-1">قسّم الملف إلى أقسام مصنّفة (النوع + نطاق الصفحات + ملخّص قصير).</p>
              </div>
            </div>
            <BreakdownEditor caseId={kase.id} items={breakdownItems} readOnly={!breakdownEditable} />
          </section>

          {canEditChecklist && (
            <div className="flex items-center justify-end">
              <AiReviewButton caseId={kase.id} />
            </div>
          )}

          <ChecklistEditor
            caseId={kase.id}
            items={checklistItems}
            responses={checklistResponses}
            canEdit={canEditChecklist}
          />

          <CommentsThread
            caseId={kase.id}
            currentUserId={userId}
            currentUserRole={(dsbRole as 'employee' | 'supervisor' | 'owner' | null) ?? null}
            comments={comments}
          />

          <div className="space-y-3">
            <div className="flex items-center justify-end">
              <EditExtractedFields
                caseId={kase.id}
                extracted={extractedFields}
                canEdit={dsbRole === 'employee' || dsbRole === 'supervisor' || dsbRole === 'owner'}
              />
            </div>
            <ExtractedFieldsPanel
              extracted={extractedFields}
              expectedDeveloperNameAr={developer?.company_name_ar ?? null}
              fmt={{ fmtSar, fmtDate }}
            />
          </div>
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
