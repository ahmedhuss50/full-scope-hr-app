/**
 * Vendor detail page — one vendor / contractor on a single project.
 *
 * Sections (top → bottom, clean & focused):
 *   1. Vendor info card (editable inline for staff)
 *   2. Developer downpayment for this vendor (total + milestone plan)
 *   3. Contracts (list; each contract has its own installment schedule)
 *   4. Receipts (invoices from the vendor + link to create a صرف case)
 *   5. وثائق الصرف — disbursement cases created for this vendor's receipts
 */
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { assignedProjectIds, canAccessProject } from '@/lib/dsb/access'
import { ArrowRight, ArrowLeft, Building2, FileText, Wallet, Receipt, User2, Phone, Mail, Landmark } from 'lucide-react'
import { VendorReceiptsPanel, type ReceiptLite, type DisbursementTypeOption } from '../VendorReceiptsPanel'
import { VendorContractsList } from '../VendorContractsList'
import { DISBURSEMENT_TYPE_DEFAULTS, resolveDisbursementLabel } from '@/lib/dsb/category-labels'
import type { VendorContractRow } from '../page'

export const dynamic = 'force-dynamic'

function fmtSar(n: number | null | undefined): string {
  if (n == null) return '—'
  try { return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }).format(n) }
  catch { return `${Math.round(n)} ر.س` }
}

type CaseLite = {
  id: string
  case_number: string | null
  voucher_number_text: string | null
  voucher_date: string | null
  amount_sar: number | null
  status: string
  receipt_id: string | null
}

export default async function VendorDetailPage({
  params,
}: {
  params: { projectId: string; vendorId: string }
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
  if (!dsbRole || !['employee', 'supervisor', 'owner', 'viewer', 'deliverer'].includes(dsbRole)) {
    redirect('/app/disbursements')
  }

  const tenantId = profile.tenant_id as string
  const { projectId, vendorId } = params

  // Project + access check
  const { data: projectData } = await svc
    .from('dsb_projects').select('id, tenant_id, code, name_ar')
    .eq('id', projectId).maybeSingle()
  if (!projectData || (projectData as { tenant_id: string }).tenant_id !== tenantId) notFound()
  const project = projectData as { id: string; code: string; name_ar: string }
  const allowed = await assignedProjectIds({ svc, tenantId, userId: profile.id as string, dsbRole })
  if (!canAccessProject(allowed, projectId)) notFound()

  // Vendor
  let vendorRes: { data: unknown | null; error: { message: string } | null } = await svc
    .from('dsb_vendors')
    .select('id, tenant_id, project_id, name_ar, service_category, tax_number, commercial_registration, phone, email, iban, references_text, contact_person_name, contact_person_phone, notes, bank_name, developer_downpayment_sar, developer_downpayment_plan')
    .eq('id', vendorId)
    .maybeSingle()
  if (vendorRes.error) {
    vendorRes = await svc
      .from('dsb_vendors')
      .select('id, tenant_id, project_id, name_ar, service_category, tax_number, commercial_registration, phone, email, iban, contact_person_name, contact_person_phone, notes')
      .eq('id', vendorId)
      .maybeSingle()
  }
  if (!vendorRes.data) notFound()
  const vendor = vendorRes.data as {
    id: string; tenant_id: string; project_id: string
    name_ar: string; service_category: string | null; tax_number: string | null
    commercial_registration: string | null; phone: string | null; email: string | null
    iban: string | null; contact_person_name: string | null; contact_person_phone: string | null
    notes: string | null; bank_name?: string | null
    developer_downpayment_sar?: number | null
    developer_downpayment_plan?: Array<{ seq: number; label_ar: string; completion_pct: number; amount_sar: number; released_at?: string | null }> | null
  }
  if (vendor.tenant_id !== tenantId || vendor.project_id !== projectId) notFound()

  // Contracts
  let contractsRes: { data: unknown[] | null; error: { message: string } | null } = await svc
    .from('dsb_vendor_contracts')
    .select('id, vendor_id, contract_number, work_type, start_date, end_date, total_amount_sar, amount_before_tax_sar, vat_sar, payment_schedule, status, storage_bucket, storage_path, filename, file_size_bytes, notes')
    .eq('tenant_id', tenantId).eq('vendor_id', vendorId)
    .order('start_date', { ascending: false, nullsFirst: false })
  if (contractsRes.error) {
    contractsRes = await svc
      .from('dsb_vendor_contracts')
      .select('id, vendor_id, contract_number, work_type, start_date, end_date, total_amount_sar, status, storage_bucket, storage_path, filename, file_size_bytes, notes')
      .eq('tenant_id', tenantId).eq('vendor_id', vendorId)
      .order('start_date', { ascending: false, nullsFirst: false })
  }
  const contracts = (contractsRes.data ?? []) as VendorContractRow[]

  // Receipts
  const receiptsRes = await svc
    .from('dsb_vendor_receipts')
    .select('id, vendor_id, contract_id, installment_seq, receipt_number, receipt_date, amount_before_tax_sar, vat_sar, total_amount_sar, description, disbursement_type_code, status, case_id')
    .eq('tenant_id', tenantId).eq('vendor_id', vendorId)
    .order('receipt_date', { ascending: false, nullsFirst: false })
  const receiptsFeatureReady = !receiptsRes.error
  const receipts = receiptsFeatureReady ? ((receiptsRes.data ?? []) as ReceiptLite[]) : []

  // Cases linked back to this vendor via receipt_id
  let cases: CaseLite[] = []
  if (receipts.length > 0) {
    const receiptIds = receipts.map((r) => r.id)
    const casesRes = await svc
      .from('dsb_cases')
      .select('id, case_number, voucher_number_text, voucher_date, amount_sar, status, receipt_id')
      .eq('tenant_id', tenantId)
      .in('receipt_id', receiptIds)
      .order('voucher_date', { ascending: false, nullsFirst: false })
    if (!casesRes.error) cases = (casesRes.data ?? []) as CaseLite[]
  }

  // Disbursement-type options for the receipts panel
  let dsbTypeOverrides: Record<string, string> = {}
  let dsbTypeHidden: string[] = []
  try {
    const tenantRes = await svc
      .from('tenants')
      .select('disbursement_type_labels, disbursement_type_hidden')
      .eq('id', tenantId).maybeSingle()
    if (!tenantRes.error && tenantRes.data) {
      const t = tenantRes.data as { disbursement_type_labels: Record<string, string> | null; disbursement_type_hidden: string[] | null }
      dsbTypeOverrides = (t.disbursement_type_labels ?? {}) as Record<string, string>
      dsbTypeHidden    = Array.isArray(t.disbursement_type_hidden) ? t.disbursement_type_hidden : []
    }
  } catch { /* fall back */ }
  const hiddenSet = new Set(dsbTypeHidden)
  const defaultCodes = Object.keys(DISBURSEMENT_TYPE_DEFAULTS)
  const customCodes  = Object.keys(dsbTypeOverrides).filter((c) => c.startsWith('custom_'))
  const disbursementTypes: DisbursementTypeOption[] = [...defaultCodes, ...customCodes]
    .filter((code) => !hiddenSet.has(code))
    .map((code) => ({ code, label: resolveDisbursementLabel(code, dsbTypeOverrides) }))

  const canOwner = dsbRole === 'owner'
  const canWrite = ['employee', 'supervisor', 'owner'].includes(dsbRole)

  return (
    <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
      <Link
        href={`/app/disbursements/admin/projects/${projectId}/vendors`}
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        العودة إلى قائمة الموردين
      </Link>

      {/* Header */}
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
          <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
          {project.name_ar} <span className="font-mono">({project.code})</span>
        </div>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          {vendor.name_ar}
        </h1>
        {vendor.service_category && (
          <div className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200">
            {vendor.service_category}
          </div>
        )}
      </header>

      {/* Vendor info card */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-3">
        <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
          <User2 className="w-4 h-4 text-slate-500" /> بيانات المورد
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <InfoRow icon={<User2 className="w-3.5 h-3.5" />} label="جهة الاتصال" value={vendor.contact_person_name} />
          <InfoRow icon={<Phone className="w-3.5 h-3.5" />} label="جوال جهة الاتصال" value={vendor.contact_person_phone} mono />
          <InfoRow icon={<Phone className="w-3.5 h-3.5" />} label="جوال" value={vendor.phone} mono />
          <InfoRow icon={<Mail className="w-3.5 h-3.5" />} label="إيميل" value={vendor.email} mono />
          <InfoRow icon={<Landmark className="w-3.5 h-3.5" />} label="البنك" value={vendor.bank_name ?? null} />
          <InfoRow icon={<Landmark className="w-3.5 h-3.5" />} label="IBAN" value={vendor.iban} mono />
          <InfoRow icon={<FileText className="w-3.5 h-3.5" />} label="الرقم الضريبي" value={vendor.tax_number} mono />
          <InfoRow icon={<FileText className="w-3.5 h-3.5" />} label="السجل التجاري" value={vendor.commercial_registration} mono />
        </div>
        {vendor.notes && (
          <div className="text-xs text-slate-600 bg-slate-50 rounded-md p-2 border border-slate-200">
            <span className="font-bold text-slate-700">ملاحظات:</span> {vendor.notes}
          </div>
        )}
        {canWrite && (
          <div className="text-[11px] text-slate-400">
            لتعديل البيانات، ارجع إلى قائمة الموردين واستخدم زر التعديل بجانب اسم المورد.
          </div>
        )}
      </section>

      {/* Downpayment + Receipts (rich panel with everything) */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-indigo-600" />
          <h2 className="text-sm font-bold text-slate-700">دفعة المطوّر والفواتير</h2>
        </div>
        <div className="p-0">
          {receiptsFeatureReady ? (
            <VendorReceiptsPanel
              vendorId={vendor.id}
              vendorName={vendor.name_ar}
              contracts={contracts.map((c) => ({
                id: c.id,
                contract_number: c.contract_number,
                total_amount_sar: c.total_amount_sar,
                amount_before_tax_sar: (c as unknown as { amount_before_tax_sar: number | null }).amount_before_tax_sar ?? null,
                vat_sar: (c as unknown as { vat_sar: number | null }).vat_sar ?? null,
                payment_schedule: (c as unknown as { payment_schedule: unknown }).payment_schedule as null | Array<{ seq: number; label_ar: string; amount_sar: number; paid_at?: string | null }>,
              }))}
              receipts={receipts}
              disbursementTypes={disbursementTypes}
              vendorDownpayment={Number(vendor.developer_downpayment_sar ?? 0)}
              vendorDownpaymentPlan={Array.isArray(vendor.developer_downpayment_plan) ? vendor.developer_downpayment_plan : []}
              canEdit={canOwner}
            />
          ) : (
            <div className="p-6 text-center text-sm text-slate-500">
              مطلوب تطبيق تحديث قاعدة البيانات (Migration 078) لتفعيل قسم الفواتير والدفعة.
            </div>
          )}
        </div>
      </section>

      {/* Contracts */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-teal-700" />
          <h2 className="text-sm font-bold text-slate-700">
            العقود <span className="text-xs font-mono text-slate-400">({contracts.length})</span>
          </h2>
        </div>
        <VendorContractsList
          vendorId={vendor.id}
          vendorName={vendor.name_ar}
          initialContracts={contracts}
          canEdit={canWrite}
          canDelete={canOwner}
        />
      </section>

      {/* Linked disbursement cases */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Receipt className="w-4 h-4 text-emerald-700" />
          <h2 className="text-sm font-bold text-slate-700">
            وثائق الصرف <span className="text-xs font-mono text-slate-400">({cases.length})</span>
          </h2>
        </div>
        {cases.length === 0 ? (
          <div className="text-xs text-slate-400 italic py-4 text-center">
            لا توجد وثائق صرف صادرة لهذا المورد بعد. أنشئ سند صرف من فاتورة أعلاه.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-right">
                  <th className="px-3 py-2 text-xs font-bold text-slate-600">رقم الطلب</th>
                  <th className="px-3 py-2 text-xs font-bold text-slate-600">رقم السند</th>
                  <th className="px-3 py-2 text-xs font-bold text-slate-600">التاريخ</th>
                  <th className="px-3 py-2 text-xs font-bold text-slate-600">المبلغ</th>
                  <th className="px-3 py-2 text-xs font-bold text-slate-600">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cases.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <Link href={`/app/disbursements/${c.id}`} className="text-teal-700 font-mono hover:underline text-xs">
                        {c.case_number ?? c.id.slice(0, 8)}
                        <ArrowLeft className="inline w-3 h-3 mr-1" />
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono">{c.voucher_number_text ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{c.voucher_date ?? '—'}</td>
                    <td className="px-3 py-2 text-xs font-mono">{fmtSar(c.amount_sar)}</td>
                    <td className="px-3 py-2">
                      <CaseStatusPill s={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function InfoRow({
  icon, label, value, mono,
}: {
  icon: React.ReactNode; label: string; value: string | null; mono?: boolean
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-slate-400 shrink-0">{icon}</span>
      <span className="text-[11px] text-slate-500 shrink-0">{label}:</span>
      {value ? (
        <span className={`truncate text-slate-800 ${mono ? 'font-mono text-xs' : ''}`} dir={mono ? 'ltr' : undefined}>
          {value}
        </span>
      ) : (
        <span className="text-slate-300">—</span>
      )}
    </div>
  )
}

function CaseStatusPill({ s }: { s: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    with_employee: { cls: 'bg-slate-100 text-slate-700 ring-slate-200',   label: 'قيد المراجعة' },
    with_manager:  { cls: 'bg-blue-50 text-blue-800 ring-blue-200',        label: 'مع المدير' },
    signed:        { cls: 'bg-amber-50 text-amber-800 ring-amber-200',     label: 'موقّعة' },
    delivered:     { cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200', label: 'مُسلَّمة' },
    rejected:      { cls: 'bg-red-50 text-red-800 ring-red-200',           label: 'مرفوضة' },
  }
  const p = map[s] ?? { cls: 'bg-slate-100 text-slate-600 ring-slate-200', label: s }
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ring-1 ring-inset ${p.cls}`}>{p.label}</span>
}
