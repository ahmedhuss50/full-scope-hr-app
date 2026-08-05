import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { FolderKanban, FileText, Plus, Users, Scale } from 'lucide-react'
import { DeleteProjectButton } from '../../EntityDeleteButtons'
import { EditProjectInfo } from './EditProjectInfo'
import { ProjectAccountsSection, type ProjectAccount } from './ProjectAccountsSection'
import { ProjectQuickUpload } from './ProjectQuickUpload'
import {
  type UnitRow,
  type SaleRow,
  type ContractRow,
} from './UnitsSection'

export const dynamic = 'force-dynamic'

type ProjectRow = {
  id: string
  tenant_id: string
  code: string
  name_ar: string
  status: string | null
  notes: string | null
  developer_id: string | null
  assigned_employee_id: string | null
  bank_name: string | null
  bank_account: string | null
  bank_iban: string | null
  checklist_template_id: string | null
}

type DeveloperLite = {
  id: string
  company_name_ar: string
}

type CaseRow = {
  id: string
  case_number: string
  voucher_number_text: string | null
  amount_sar: number | null
  status: string
  submitted_at: string | null
  created_at: string
}

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

function statusPill(status: string | null): { cls: string; label: string } {
  switch (status) {
    case 'active':
      return { cls: 'bg-green-50 text-green-700 ring-green-200', label: 'نشط' }
    case 'archived':
    case 'inactive':
      return { cls: 'bg-slate-100 text-slate-500 ring-slate-200', label: 'مؤرشف' }
    default:
      return { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: status ?? '—' }
  }
}

const PIPELINE_COLUMNS: {
  key: 'with_employee' | 'with_supervisor' | 'with_owner' | 'signed' | 'sent_back_to_developer'
  title: string
  headCls: string
}[] = [
  { key: 'with_employee',          title: 'بانتظار الموظف',         headCls: 'bg-amber-50 text-amber-800 border-amber-200' },
  { key: 'with_supervisor',        title: 'بانتظار السوبرفايزر',    headCls: 'bg-amber-50 text-amber-800 border-amber-200' },
  { key: 'with_owner',             title: 'بانتظار مدير المراجعة',    headCls: 'bg-amber-50 text-amber-800 border-amber-200' },
  { key: 'signed',                 title: 'جاهزة للتسليم',            headCls: 'bg-green-50 text-green-800 border-green-200' },
  { key: 'sent_back_to_developer', title: 'أعيدت إلى المطور',        headCls: 'bg-red-50 text-red-800 border-red-200' },
]

export default async function ProjectDetailPage({
  params,
}: {
  params: { projectId: string }
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
  if (!dsbRole || !['employee', 'supervisor', 'owner'].includes(dsbRole)) {
    redirect('/app/disbursements')
  }

  const tenantId = profile.tenant_id as string
  const projectId = params.projectId

  // Fetch the project + tenant-scope.
  const { data: projectData } = await svc
    .from('dsb_projects')
    .select('id, tenant_id, code, name_ar, status, notes, developer_id, assigned_employee_id, bank_name, bank_account, bank_iban, checklist_template_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!projectData || (projectData as { tenant_id: string }).tenant_id !== tenantId) {
    notFound()
  }
  const project = projectData as ProjectRow

  // Resolve developer + assigned employee names.
  let developer: DeveloperLite | null = null
  if (project.developer_id) {
    const { data: devRow } = await svc
      .from('dsb_developers')
      .select('id, company_name_ar')
      .eq('tenant_id', tenantId)
      .eq('id', project.developer_id)
      .maybeSingle()
    if (devRow) {
      developer = {
        id: devRow.id as string,
        company_name_ar: devRow.company_name_ar as string,
      }
    }
  }

  // Load the current set of assigned employees from the junction. The
  // legacy assigned_employee_id is preserved as the "primary" pointer but
  // the multi-select edits the junction directly. If the junction is
  // empty but a legacy pointer exists (unmigrated row), we surface that
  // value as a pre-check so the picker shows the same person the rest of
  // the system treats as "assigned".
  const { data: junctionRows } = await svc
    .from('dsb_project_employees')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
  const junctionIds = ((junctionRows ?? []) as { user_id: string }[]).map((r) => r.user_id)
  const assignedUserIds = junctionIds.length > 0
    ? junctionIds
    : (project.assigned_employee_id ? [project.assigned_employee_id] : [])

  // Resolve assigned employee names for the read-only info card.
  const assignedNameById = new Map<string, string>()
  if (assignedUserIds.length > 0) {
    const { data: rows } = await svc
      .from('users')
      .select('id, full_name')
      .in('id', assignedUserIds)
    for (const r of (rows ?? []) as { id: string; full_name: string | null }[]) {
      assignedNameById.set(r.id, r.full_name ?? '—')
    }
  }
  const assignedEmployeeNames = assignedUserIds.map((id) => assignedNameById.get(id) ?? '—')

  // Lists for the edit form: tenant clients + all staff.
  const { data: clientsForEdit } = await svc
    .from('dsb_developers')
    .select('id, company_name_ar')
    .eq('tenant_id', tenantId)
    .order('company_name_ar', { ascending: true })
  const clientOptions = ((clientsForEdit ?? []) as { id: string; company_name_ar: string }[])
    .map((c) => ({ id: c.id, company_name_ar: c.company_name_ar }))

  const { data: staffForEdit } = await svc
    .from('users')
    .select('id, full_name, dsb_role')
    .eq('tenant_id', tenantId)
    // Deliverer is included so a project can be assigned to a delivery
    // contact. Approval at "with_employee" stage still requires supervisor
    // or owner to step in when the assignee is a deliverer.
    .in('dsb_role', ['employee', 'supervisor', 'owner', 'deliverer'])
    .order('full_name', { ascending: true })
  const staffOptions = ((staffForEdit ?? []) as { id: string; full_name: string | null; dsb_role: string | null }[])
    .map((u) => ({
      id: u.id,
      full_name: u.full_name ?? '—',
      role_label:
        u.dsb_role === 'owner' ? 'مدير' :
        u.dsb_role === 'supervisor' ? 'مشرف' :
        u.dsb_role === 'deliverer' ? 'مسلِّم' :
        'مراجع',
    }))

  // Checklist templates for this tenant — feeds the "قائمة المراجعة" picker.
  const { data: tplsForEdit } = await svc
    .from('dsb_checklist_templates')
    .select('id, name, is_default')
    .eq('tenant_id', tenantId)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })
  const checklistTemplateOptions = ((tplsForEdit ?? []) as Array<{ id: string; name: string; is_default: boolean }>)
    .map((t) => ({ id: t.id, label: t.is_default ? `${t.name} (افتراضية)` : t.name }))

  // Fetch cases for this project.
  const { data: casesData } = await svc
    .from('dsb_cases')
    .select('id, case_number, voucher_number_text, amount_sar, status, submitted_at, created_at')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  const cases = (casesData ?? []) as CaseRow[]

  // Fetch per-project payment accounts (admin-managed list shown to owners).
  const { data: accountsData } = await svc
    .from('dsb_project_accounts')
    .select('id, label, account_number, bank_name, iban')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .order('label', { ascending: true })
  const projectAccounts = (accountsData ?? []) as ProjectAccount[]

  // ---- Units + sales + contracts (owner-only section) ----
  // We always load these arrays so the section can render for owners; they
  // stay empty for non-owners and the section itself is not rendered.
  let units: UnitRow[] = []
  let salesByUnitId: Record<string, SaleRow[]> = {}
  let contractsByUnitId: Record<string, ContractRow[]> = {}
  let contractsUnlinked: ContractRow[] = []
  let latestSaleByUnit: Record<string, SaleRow | null> = {}

  if (dsbRole === 'owner') {
    const { data: unitRows } = await svc
      .from('dsb_project_units')
      .select('id, unit_number, zone_number, block_number, unit_type, area_m2, district, city, region, notes')
      .eq('tenant_id', tenantId)
      .eq('project_id', projectId)
      .order('unit_number', { ascending: true })
    units = ((unitRows ?? []) as UnitRow[])

    const unitIds = units.map((u) => u.id)
    if (unitIds.length > 0) {
      const { data: salesRows } = await svc
        .from('dsb_unit_sales')
        .select(
          'id, unit_id, sale_count, sale_status, buyer_name_ar, buyer_id_type, buyer_id_number, buyer_nationality, buyer_phone, contract_number, contract_type, financing_type, financing_bank, sale_date, price_before_tax_sar, vat_sar, price_with_vat_sar, delivery_status, delivery_date, created_at, retention_percentage, installment_number, total_collected_before_tax_sar, total_collected_with_tax_sar, remaining_amount_sar, collection_percentage, price_per_meter_sar',
        )
        .eq('tenant_id', tenantId)
        .in('unit_id', unitIds)
        .order('sale_count', { ascending: false })
        .order('created_at', { ascending: false })
      for (const s of (salesRows ?? []) as SaleRow[]) {
        const arr = salesByUnitId[s.unit_id] ?? []
        arr.push(s)
        salesByUnitId[s.unit_id] = arr
      }
      // Latest sale = first entry per unit (already sorted desc by sale_count).
      for (const uid of unitIds) {
        const arr = salesByUnitId[uid] ?? []
        // Prefer the active row when the latest sale_count row is cancelled.
        const active = arr.find((s) => s.sale_status === 'active')
        latestSaleByUnit[uid] = active ?? arr[0] ?? null
      }

      // Two separate queries — the .or() with a nested in-list gets tricky
      // to escape safely. Load linked contracts by unit_id, then load
      // unlinked contracts (no unit_id yet) for the tenant.
      const [linkedRes, unlinkedRes] = await Promise.all([
        svc
          .from('dsb_unit_contracts')
          .select('id, sale_id, unit_id, filename, storage_path, storage_bucket, extraction_status, extracted_fields, extracted_at, uploaded_at')
          .eq('tenant_id', tenantId)
          .in('unit_id', unitIds)
          .order('uploaded_at', { ascending: false }),
        svc
          .from('dsb_unit_contracts')
          .select('id, sale_id, unit_id, filename, storage_path, storage_bucket, extraction_status, extracted_fields, extracted_at, uploaded_at')
          .eq('tenant_id', tenantId)
          .is('unit_id', null)
          .order('uploaded_at', { ascending: false }),
      ])
      for (const c of (linkedRes.data ?? []) as ContractRow[]) {
        if (!c.unit_id) continue
        const arr = contractsByUnitId[c.unit_id] ?? []
        arr.push(c)
        contractsByUnitId[c.unit_id] = arr
      }
      contractsUnlinked = ((unlinkedRes.data ?? []) as ContractRow[])
    } else {
      // No units yet — surface unmatched contracts for this tenant so the
      // owner can still see uploads waiting to be linked once units are
      // imported.
      const { data: unlinked } = await svc
        .from('dsb_unit_contracts')
        .select('id, sale_id, unit_id, filename, storage_path, storage_bucket, extraction_status, extracted_fields, extracted_at, uploaded_at')
        .eq('tenant_id', tenantId)
        .is('unit_id', null)
        .order('uploaded_at', { ascending: false })
      contractsUnlinked = (unlinked ?? []) as ContractRow[]
    }
  }

  // Group by pipeline column.
  const byStatus = new Map<string, CaseRow[]>()
  for (const col of PIPELINE_COLUMNS) byStatus.set(col.key, [])
  for (const c of cases) {
    const bucket = byStatus.get(c.status)
    if (bucket) bucket.push(c)
  }

  const pill = statusPill(project.status)

  // Pre-select dev + project on the new-case form.
  const newCaseQuery = new URLSearchParams()
  if (developer) newCaseQuery.set('developer', developer.id)
  newCaseQuery.set('project', project.id)
  const newCaseHref = `/app/disbursements/new?${newCaseQuery.toString()}`

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      {/* Breadcrumb */}
      <Link
        href="/app/disbursements/admin"
        className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
      >
        ← المشاريع
      </Link>

      {/* Header */}
      <header className="space-y-3">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <FolderKanban className="w-4 h-4" aria-hidden="true" />
          مشروع
        </div>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-sm text-slate-500">{project.code}</span>
              <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
                {project.name_ar}
              </h1>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${pill.cls}`}
              >
                {pill.label}
              </span>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2 flex-wrap">
            <Link
              href={newCaseHref}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              سند صرف جديد
            </Link>
            <EditProjectInfo
              project={{
                id: project.id,
                code: project.code,
                name_ar: project.name_ar,
                developer_id: project.developer_id ?? '',
                assigned_employee_id: project.assigned_employee_id ?? null,
                notes: project.notes ?? null,
                status: project.status ?? null,
                bank_name: project.bank_name,
                bank_account: project.bank_account,
                bank_iban: project.bank_iban,
                checklist_template_id: project.checklist_template_id,
              }}
              clients={clientOptions}
              staff={staffOptions}
              assignedUserIds={assignedUserIds}
              canEditAssignees={dsbRole === 'owner'}
              checklistTemplates={checklistTemplateOptions}
            />
            {dsbRole === 'owner' && (
              <DeleteProjectButton
                projectId={project.id}
                projectCode={project.code}
                size="sm"
              />
            )}
          </div>
        </div>
      </header>

      {/* Info card */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-slate-500 mb-0.5">العميل</div>
            <div className="font-semibold text-slate-900">
              {developer ? (
                <Link
                  href={`/app/disbursements/admin/clients/${developer.id}`}
                  className="hover:text-teal-700 hover:underline"
                >
                  {developer.company_name_ar}
                </Link>
              ) : (
                '—'
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">الموظفون المسؤولون</div>
            <div className="font-semibold text-slate-900">
              {assignedEmployeeNames.length === 0 ? '—' : (
                <div className="flex flex-wrap gap-1.5">
                  {assignedEmployeeNames.map((name, idx) => (
                    <span
                      key={`${name}-${idx}`}
                      className="inline-flex items-center px-2 py-0.5 rounded-full bg-teal-50 text-teal-800 ring-1 ring-teal-200 text-[11px] font-semibold"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">عدد السندات</div>
            <div className="font-semibold text-slate-900">{cases.length}</div>
          </div>
        </div>
        {project.notes && (
          <div className="pt-3 border-t border-slate-100">
            <div className="text-xs text-slate-500 mb-1">ملاحظات</div>
            <div className="text-sm text-slate-700 whitespace-pre-wrap">{project.notes}</div>
          </div>
        )}
      </section>

      {/* One-click voucher upload — auto-assigned to this project. AI extracts
          metadata and links to the matching unit/sale/contract. Only shown
          when the project has a linked developer (createCaseByStaff requires
          both project_id and developer_id). */}
      {developer && (
        <ProjectQuickUpload
          projectId={project.id}
          projectName={project.name_ar}
          developerId={developer.id}
          developerName={developer.company_name_ar}
        />
      )}

      {/* Reports quick links — سجل المشترين + حساب الضمان.
          Both are read-only rolled-up views built on top of the units /
          sales / cases / payments tables. Available to everyone who can
          see the project (owner, supervisor, employee, viewer). */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div>
            <h2 className="serif font-black text-lg text-slate-900">التقارير</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              عرضٌ مجمَّع للوحدات والعقود والتحصيل والصرف على مستوى المشروع.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href={`/app/disbursements/admin/projects/${project.id}/reports/buyers-register`}
            className="group flex items-start gap-3 rounded-xl border border-teal-200 bg-teal-50/40 hover:bg-teal-50 hover:border-teal-300 transition p-4"
          >
            <div className="shrink-0 w-10 h-10 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center">
              <Users className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-slate-900 group-hover:text-teal-800 transition">
                سجل المشترين
              </div>
              <div className="text-xs text-slate-600 mt-0.5">
                كل وحدة مع مشتريها وعقدها وسجل الدفعات المرتبطة.
              </div>
            </div>
          </Link>
          <Link
            href={`/app/disbursements/admin/projects/${project.id}/reports/escrow-account`}
            className="group flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50 hover:border-indigo-300 transition p-4"
          >
            <div className="shrink-0 w-10 h-10 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
              <Scale className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-slate-900 group-hover:text-indigo-800 transition">
                حساب الضمان
              </div>
              <div className="text-xs text-slate-600 mt-0.5">
                تحصيل داخل − صرف خارج = الرصيد الجاري، مع فلترة حسب الحساب.
              </div>
            </div>
          </Link>
        </div>
      </section>

      {/* Per-project payment accounts — owner-only */}
      {dsbRole === 'owner' && (
        <ProjectAccountsSection
          projectId={project.id}
          initialAccounts={projectAccounts}
        />
      )}

      {/* Units + عقود المشترين — two separate quick-links.
          Neither auto-populates here; click into each list to view.
          Available to everyone who can see the project (owner+staff+viewer). */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div>
            <h2 className="serif font-black text-lg text-slate-900">البيانات الأساسية</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              الوحدات المادية وعقود المشترين — قائمتان منفصلتان مرتبطتان تلقائيًا بالذكاء الاصطناعي.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href={`/app/disbursements/admin/projects/${project.id}/units`}
            className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-slate-100 hover:border-slate-300 transition p-4"
          >
            <div className="shrink-0 w-10 h-10 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center">
              <FolderKanban className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-slate-900 group-hover:text-slate-950 transition">
                قائمة الوحدات
              </div>
              <div className="text-xs text-slate-600 mt-0.5">
                الوحدات المادية للمشروع فقط — بدون بيانات المشترين أو العقود.
              </div>
            </div>
          </Link>
          <Link
            href={`/app/disbursements/admin/projects/${project.id}/buyer-contracts`}
            className="group flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/40 hover:bg-amber-50 hover:border-amber-300 transition p-4"
          >
            <div className="shrink-0 w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
              <FileText className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-slate-900 group-hover:text-amber-800 transition">
                عقود المشترين
              </div>
              <div className="text-xs text-slate-600 mt-0.5">
                العقود وبيانات المشترين، مرتبطة بالوحدات بالذكاء الاصطناعي.
              </div>
            </div>
          </Link>
        </div>
      </section>

      {/* Pipeline */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <FileText className="w-4 h-4 text-slate-500" aria-hidden="true" />
          <h2 className="serif font-bold text-lg text-slate-900">مسار سندات المشروع</h2>
        </div>

        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {PIPELINE_COLUMNS.map((col) => {
              const items = byStatus.get(col.key) ?? []
              return (
                <div
                  key={col.key}
                  className="flex flex-col bg-slate-50/60 border border-slate-200 rounded-xl overflow-hidden min-h-[160px]"
                >
                  <div
                    className={`flex items-center justify-between gap-2 px-3 py-2 border-b ${col.headCls}`}
                  >
                    <div className="text-xs font-bold truncate">{col.title}</div>
                    <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full bg-white/70 text-[11px] font-bold font-mono">
                      {items.length}
                    </span>
                  </div>
                  <div className="p-2 space-y-2 flex-1">
                    {items.length === 0 ? (
                      <div className="text-center text-xs text-slate-400 py-6">—</div>
                    ) : (
                      items.map((c) => (
                        <Link
                          key={c.id}
                          href={`/app/disbursements/${c.id}`}
                          className="block bg-white rounded-lg border border-slate-200 p-2.5 hover:border-teal-300 hover:shadow-sm transition"
                        >
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-mono text-[11px] text-slate-500 truncate">
                              {c.case_number}
                            </span>
                          </div>
                          {c.voucher_number_text && (
                            <div className="text-xs text-slate-600 truncate">
                              سند {c.voucher_number_text}
                            </div>
                          )}
                          <div className="text-sm font-bold text-slate-900 mt-1">
                            {fmtSar(c.amount_sar)}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {fmtDate(c.submitted_at ?? c.created_at)}
                          </div>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
