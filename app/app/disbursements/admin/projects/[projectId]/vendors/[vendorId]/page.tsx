/**
 * Vendor detail page — one contractor / vendor on a single project.
 *
 * Sections (top → bottom, focused & clean):
 *   1. Vendor info card
 *   2. Developer downpayment PLAN for this vendor (spending plan only —
 *      no invoices, no schedule rows; those live in وثائق الصرف)
 *   3. Activity feed — every وثيقة صرف assigned to this vendor + the
 *      auto-deducted deposit rollup (deposit − paid = remaining)
 *   4. Contracts (list, edit, PDF)
 */
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { assignedProjectIds, canAccessProject } from '@/lib/dsb/access'
import { ArrowRight, ArrowLeft, Building2, FileText, Wallet, Activity, User2, Phone, Mail, Landmark, TrendingDown } from 'lucide-react'
import { VendorContractsList } from '../VendorContractsList'
import { VendorDownpaymentEditor } from '../VendorDownpaymentEditor'
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
  paid_at: string | null
  is_downpayment: boolean | null
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
    .from('users').select('id, tenant_id, dsb_role').eq('email', user.email!).maybeSingle()
  if (!profile) redirect('/login')

  const dsbRole = (profile.dsb_role as string | null) ?? null
  if (!dsbRole || !['employee', 'supervisor', 'owner', 'viewer', 'deliverer'].includes(dsbRole)) {
    redirect('/app/disbursements')
  }

  const tenantId = profile.tenant_id as string
  const { projectId, vendorId } = params

  const { data: projectData } = await svc
    .from('dsb_projects').select('id, tenant_id, code, name_ar').eq('id', projectId).maybeSingle()
  if (!projectData || (projectData as { tenant_id: string }).tenant_id !== tenantId) notFound()
  const project = projectData as { id: string; code: string; name_ar: string }
  const allowed = await assignedProjectIds({ svc, tenantId, userId: profile.id as string, dsbRole })
  if (!canAccessProject(allowed, projectId)) notFound()

  // Vendor
  let vendorRes: { data: unknown | null; error: { message: string } | null } = await svc
    .from('dsb_vendors')
    .select('id, tenant_id, project_id, name_ar, service_category, tax_number, commercial_registration, phone, email, iban, contact_person_name, contact_person_phone, notes, bank_name, developer_downpayment_sar, developer_downpayment_plan')
    .eq('id', vendorId).maybeSingle()
  if (vendorRes.error) {
    vendorRes = await svc
      .from('dsb_vendors')
      .select('id, tenant_id, project_id, name_ar, service_category, tax_number, commercial_registration, phone, email, iban, contact_person_name, contact_person_phone, notes')
      .eq('id', vendorId).maybeSingle()
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
    .select('id, vendor_id, contract_number, work_type, start_date, end_date, total_amount_sar, status, storage_bucket, storage_path, filename, file_size_bytes, notes')
    .eq('tenant_id', tenantId).eq('vendor_id', vendorId)
    .order('start_date', { ascending: false, nullsFirst: false })
  if (contractsRes.error) {
    contractsRes = await svc
      .from('dsb_vendor_contracts')
      .select('id, vendor_id, contract_number, work_type, start_date, end_date, total_amount_sar, status, filename, storage_path')
      .eq('tenant_id', tenantId).eq('vendor_id', vendorId)
      .order('start_date', { ascending: false, nullsFirst: false })
  }
  const contracts = (contractsRes.data ?? []) as VendorContractRow[]

  // All cases (وثائق الصرف) assigned to this vendor (mig 084)
  let cases: CaseLite[] = []
  let vendorLinkReady = true
  let casesRes: { data: unknown[] | null; error: { message: string } | null } = await svc
    .from('dsb_cases')
    .select('id, case_number, voucher_number_text, voucher_date, amount_sar, status, paid_at, is_downpayment')
    .eq('tenant_id', tenantId)
    .eq('vendor_id', vendorId)
    .order('voucher_date', { ascending: false, nullsFirst: false })
  if (casesRes.error) {
    // Fallback if migration 085 not yet applied
    casesRes = await svc
      .from('dsb_cases')
      .select('id, case_number, voucher_number_text, voucher_date, amount_sar, status, paid_at')
      .eq('tenant_id', tenantId)
      .eq('vendor_id', vendorId)
      .order('voucher_date', { ascending: false, nullsFirst: false })
  }
  if (casesRes.error) {
    vendorLinkReady = false
  } else {
    cases = (casesRes.data ?? []) as CaseLite[]
  }

  // Rollup: total paid to this vendor = sum of signed/delivered cases.
  // Split into downpayment vs invoices for accountant reporting.
  const paidCases = cases.filter((c) => c.status === 'signed' || c.status === 'delivered')
  const paidToVendor  = paidCases.reduce((n, c) => n + Number(c.amount_sar || 0), 0)
  const paidDownpayment = paidCases
    .filter((c) => c.is_downpayment)
    .reduce((n, c) => n + Number(c.amount_sar || 0), 0)
  const paidInvoices = paidToVendor - paidDownpayment
  const pendingAmount = cases
    .filter((c) => c.status !== 'signed' && c.status !== 'delivered' && c.status !== 'cancelled' && c.status !== 'rejected')
    .reduce((n, c) => n + Number(c.amount_sar || 0), 0)

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
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">{vendor.name_ar}</h1>
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
      </section>

      {/* Downpayment PLAN (spending plan only — no invoices/payments here) */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-indigo-600" />
          <h2 className="text-sm font-bold text-slate-700">خطة دفعة المطوّر لهذا المورد</h2>
        </div>
        <div className="p-4">
          <VendorDownpaymentEditor
            vendorId={vendor.id}
            vendorName={vendor.name_ar}
            initialDownpayment={Number(vendor.developer_downpayment_sar ?? 0)}
            initialPlan={Array.isArray(vendor.developer_downpayment_plan) ? vendor.developer_downpayment_plan : []}
            paidToVendor={paidToVendor}
            canEdit={canOwner}
          />
        </div>
      </section>

      {/* Activity feed — all وثائق الصرف for this vendor */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-700" />
            <h2 className="text-sm font-bold text-slate-700">
              وثائق الصرف <span className="text-xs font-mono text-slate-400">({cases.length})</span>
            </h2>
          </div>
          {canWrite && (
            <Link
              href={`/app/disbursements/new?project=${projectId}`}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-teal-600 text-white text-xs font-bold hover:bg-teal-700"
            >
              + سند صرف جديد
            </Link>
          )}
        </div>

        {!vendorLinkReady && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            مطلوب تطبيق تحديث قاعدة البيانات (Migration 084) لعرض النشاط المربوط بالمورد.
          </p>
        )}

        {vendorLinkReady && (
          <>
            {/* Activity rollup */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-right">
              <RollupCell label="دفعات مقدمة مسدَّدة" value={fmtSar(paidDownpayment)} icon={<Wallet className="w-3 h-3" />} tone="indigo" />
              <RollupCell label="فواتير مسدَّدة" value={fmtSar(paidInvoices)} icon={<TrendingDown className="w-3 h-3" />} tone="amber" />
              <RollupCell label="قيد المعالجة" value={fmtSar(pendingAmount)} icon={<FileText className="w-3 h-3" />} tone="slate" />
              <RollupCell label="عدد الوثائق" value={String(cases.length)} icon={<Activity className="w-3 h-3" />} tone="emerald" />
            </div>

            {cases.length === 0 ? (
              <div className="text-xs text-slate-400 italic py-6 text-center">
                لا توجد وثائق صرف صادرة لهذا المورد بعد.
                {canWrite && (
                  <>
                    {' '}
                    <Link href={`/app/disbursements/new?project=${projectId}`} className="text-teal-700 font-semibold hover:underline">
                      أنشئ سند صرف
                    </Link>
                    {' '}واختر المورد من داخل السند.
                  </>
                )}
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
                      <th className="px-3 py-2 text-xs font-bold text-slate-600">تاريخ السداد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cases.map((c) => (
                      <tr key={c.id} className={`hover:bg-slate-50/60 ${c.is_downpayment ? 'bg-indigo-50/30' : ''}`}>
                        <td className="px-3 py-2">
                          <Link href={`/app/disbursements/${c.id}`} className="text-teal-700 font-mono hover:underline text-xs inline-flex items-center gap-1">
                            {c.case_number ?? c.id.slice(0, 8)}
                            <ArrowLeft className="w-3 h-3 opacity-60" />
                          </Link>
                          {c.is_downpayment && (
                            <span className="mr-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-indigo-100 text-indigo-800 ring-1 ring-inset ring-indigo-200">
                              <Wallet className="w-2.5 h-2.5" /> دفعة مقدّمة
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono">{c.voucher_number_text ?? '—'}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{c.voucher_date ?? '—'}</td>
                        <td className="px-3 py-2 text-xs font-mono">{fmtSar(c.amount_sar)}</td>
                        <td className="px-3 py-2"><CaseStatusPill s={c.status} /></td>
                        <td className="px-3 py-2 text-xs text-slate-500">{c.paid_at ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
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
    </div>
  )
}

function InfoRow({ icon, label, value, mono }: {
  icon: React.ReactNode; label: string; value: string | null; mono?: boolean
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-slate-400 shrink-0">{icon}</span>
      <span className="text-[11px] text-slate-500 shrink-0">{label}:</span>
      {value ? (
        <span className={`truncate text-slate-800 ${mono ? 'font-mono text-xs' : ''}`} dir={mono ? 'ltr' : undefined}>{value}</span>
      ) : (
        <span className="text-slate-300">—</span>
      )}
    </div>
  )
}

function RollupCell({ label, value, icon, tone }: {
  label: string; value: string; icon: React.ReactNode
  tone: 'amber' | 'slate' | 'emerald' | 'indigo'
}) {
  const cls =
    tone === 'amber'  ? 'bg-amber-50 text-amber-800 ring-amber-200' :
    tone === 'slate'  ? 'bg-slate-50 text-slate-800 ring-slate-200' :
    tone === 'indigo' ? 'bg-indigo-50 text-indigo-800 ring-indigo-200' :
                        'bg-emerald-50 text-emerald-800 ring-emerald-200'
  return (
    <div className={`rounded-lg ring-1 ring-inset ${cls} px-3 py-2`}>
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-80 inline-flex items-center gap-1">
        {icon}{label}
      </div>
      <div className="mt-1 text-base font-black font-mono">{value}</div>
    </div>
  )
}

function CaseStatusPill({ s }: { s: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    with_employee:          { cls: 'bg-slate-100 text-slate-700 ring-slate-200',    label: 'قيد المراجعة' },
    with_supervisor:        { cls: 'bg-blue-50 text-blue-800 ring-blue-200',        label: 'مع المشرف' },
    with_owner:             { cls: 'bg-amber-50 text-amber-800 ring-amber-200',     label: 'مع المدير' },
    signed:                 { cls: 'bg-green-50 text-green-800 ring-green-200',     label: 'موقّعة' },
    delivered:              { cls: 'bg-blue-50 text-blue-800 ring-blue-200',        label: 'مُسلَّمة' },
    sent_back_to_developer: { cls: 'bg-red-50 text-red-700 ring-red-200',           label: 'أُعيدت' },
    rejected:               { cls: 'bg-red-50 text-red-800 ring-red-200',           label: 'مرفوضة' },
    cancelled:              { cls: 'bg-slate-100 text-slate-500 ring-slate-200',    label: 'ملغاة' },
  }
  const p = map[s] ?? { cls: 'bg-slate-100 text-slate-600 ring-slate-200', label: s }
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ring-1 ring-inset ${p.cls}`}>{p.label}</span>
}
