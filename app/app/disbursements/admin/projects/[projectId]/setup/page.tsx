/**
 * تهيئة المشروع — Project Setup Screen (per project)
 *
 * Single-scroll page listing every setup section for a project. Sections
 * either edit inline (Basics, slice 1) or link out to the existing page
 * that owns that concern (Accounts, Team, Checklist, Units, Contracts,
 * Vendors, Payments). Later slices will graduate more sections to inline
 * editing.
 *
 * Completion model — a section is "complete" when its required data is
 * populated. Basics ≥ 3, Accounts ≥ 1, Team ≥ 1 are the only three
 * required for the project to be marked نشط; the rest are informational.
 *
 * Also serves as the landing page a new project immediately lands on
 * after creation (add ?fresh=1 for the empty-state framing — we'll wire
 * that from the create-project flow later).
 */
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Settings2 } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { SectionCard } from './SectionCard'
import { BasicsSection } from './BasicsSection'

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
  rega_license_no: string | null
  rega_agreement_date_hijri: string | null
  rega_agreement_date_gregorian: string | null
  land_price_sar: number | null
  estimated_construction_sar: number | null
  estimated_admin_marketing_sar: number | null
  project_start_date: string | null
  rega_license_expiry_date: string | null
  engineer_consultant_name: string | null
  engineer_consultant_contract_sar: number | null
  contractor_1_name: string | null
  contractor_1_contract_sar: number | null
  contractor_2_name: string | null
  contractor_2_contract_sar: number | null
  contractor_3_name: string | null
  contractor_3_contract_sar: number | null
  contractor_4_name: string | null
  contractor_4_contract_sar: number | null
}

export default async function ProjectSetupPage({
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
  // Owner-only for the setup screen — same posture as everything else that
  // reshapes core project configuration.
  if (dsbRole !== 'owner') {
    redirect(`/app/disbursements/admin/projects/${params.projectId}`)
  }

  const tenantId = profile.tenant_id as string
  const projectId = params.projectId

  // ---- Project + tenant scope ----
  const { data: projectData } = await svc
    .from('dsb_projects')
    .select('id, tenant_id, code, name_ar, status, notes, developer_id, assigned_employee_id, bank_name, bank_account, bank_iban, checklist_template_id, rega_license_no, rega_agreement_date_hijri, rega_agreement_date_gregorian, land_price_sar, estimated_construction_sar, estimated_admin_marketing_sar, project_start_date, rega_license_expiry_date, engineer_consultant_name, engineer_consultant_contract_sar, contractor_1_name, contractor_1_contract_sar, contractor_2_name, contractor_2_contract_sar, contractor_3_name, contractor_3_contract_sar, contractor_4_name, contractor_4_contract_sar')
    .eq('id', projectId)
    .maybeSingle()
  if (!projectData || (projectData as { tenant_id: string }).tenant_id !== tenantId) {
    notFound()
  }
  const project = projectData as ProjectRow

  // ---- Developer name for the summary card ----
  let developerName: string | null = null
  if (project.developer_id) {
    const { data: dev } = await svc
      .from('dsb_developers')
      .select('company_name_ar')
      .eq('tenant_id', tenantId)
      .eq('id', project.developer_id)
      .maybeSingle()
    developerName = (dev?.company_name_ar as string | null) ?? null
  }

  // ---- Client (developer) picker options for the inline editor ----
  const { data: clientsData } = await svc
    .from('dsb_developers')
    .select('id, company_name_ar')
    .eq('tenant_id', tenantId)
    .order('company_name_ar', { ascending: true })
  const clients = ((clientsData ?? []) as Array<{ id: string; company_name_ar: string }>)

  // ---- Section-completion counts (lightweight, count-only queries) ----
  const [accountsCntRes, assigneesCntRes, unitsCntRes, contractsCntRes, paymentsCntRes, vendorsCntRes] = await Promise.all([
    svc.from('dsb_project_accounts').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('project_id', projectId).eq('is_active', true),
    svc.from('dsb_project_employees').select('user_id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('project_id', projectId),
    svc.from('dsb_project_units').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('project_id', projectId),
    svc.from('dsb_unit_sales').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).in('unit_id',
        // Sub-query would be nicer — fall back to a two-step in a moment
        // if the tenant grows. For now, count via project's unit ids.
        (await svc.from('dsb_project_units').select('id')
          .eq('tenant_id', tenantId).eq('project_id', projectId))
          .data?.map((r: { id: string }) => r.id) ?? ['00000000-0000-0000-0000-000000000000'],
      ),
    svc.from('dsb_payments').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('project_id', projectId),
    // Vendors are optional — count is informational.
    svc.from('dsb_vendors').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('project_id', projectId),
  ])
  const accountsCount = accountsCntRes.count ?? 0
  const assigneesCount = assigneesCntRes.count ?? 0
  const unitsCount = unitsCntRes.count ?? 0
  const contractsCount = contractsCntRes.count ?? 0
  const paymentsCount = paymentsCntRes.count ?? 0
  const vendorsCount = vendorsCntRes.count ?? 0

  // ---- Checklist template info ----
  let checklistTemplateName: string | null = null
  if (project.checklist_template_id) {
    const { data: tpl } = await svc
      .from('dsb_checklist_templates')
      .select('name')
      .eq('tenant_id', tenantId)
      .eq('id', project.checklist_template_id)
      .maybeSingle()
    checklistTemplateName = (tpl?.name as string | null) ?? null
  }

  // ---- Section completion flags ----
  const basicsComplete = Boolean(project.name_ar && project.code && project.developer_id)
  const accountsComplete = accountsCount >= 1
  const teamComplete = assigneesCount >= 1
  const checklistComplete = Boolean(project.checklist_template_id) // template picked (or default inherited)
  const unitsComplete = unitsCount >= 1
  const contractsComplete = contractsCount >= 1
  const vendorsComplete = vendorsCount >= 1
  const paymentsComplete = paymentsCount >= 1

  const sections = [
    basicsComplete, accountsComplete, teamComplete, checklistComplete,
    unitsComplete, contractsComplete, vendorsComplete, paymentsComplete,
  ]
  const completedCount = sections.filter(Boolean).length
  const totalCount = sections.length
  const pct = Math.round((completedCount / totalCount) * 100)

  // Route helpers — most sections link to the existing page that owns them.
  const projectHref = `/app/disbursements/admin/projects/${projectId}`
  const unitsHref    = `${projectHref}/units`
  const contractsHref = `${projectHref}/buyer-contracts`
  const vendorsHref  = `${projectHref}/vendors`
  const paymentsHref = `/app/disbursements/admin/lists/payments?project=${projectId}`

  return (
    <div className="space-y-6 max-w-4xl mx-auto" dir="rtl">
      {/* Breadcrumb */}
      <Link
        href={projectHref}
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        العودة إلى المشروع
      </Link>

      {/* Header + completion bar */}
      <header className="space-y-3">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <Settings2 className="w-4 h-4" aria-hidden="true" />
          تهيئة المشروع
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            {project.name_ar}
          </h1>
          <span className="font-mono text-sm text-slate-500">{project.code}</span>
        </div>
        <p className="text-sm text-slate-600">
          هذه شاشة إعداد المشروع الشاملة. عدّل كل قسم مباشرة، وسيصبح المشروع
          «نشط» عند اكتمال الأقسام المطلوبة (الأساسيات، الحسابات، الفريق).
        </p>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-sm font-semibold text-slate-800">
              اكتمال التهيئة
            </div>
            <div className="text-xs font-mono text-slate-500">
              {completedCount} من {totalCount} · {pct}٪
            </div>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-teal-500 transition-all"
              style={{ width: `${pct}%` }}
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      </header>

      {/* Sections */}
      <div className="space-y-3">
        {/* 1. Basics — inline editable in slice 1 */}
        <SectionCard
          index={1}
          title="الأساسيات"
          complete={basicsComplete}
          emptyPrompt="أدخل اسم المشروع ورمزه والعميل والحالة."
        >
          <BasicsSection
            project={{
              id: project.id,
              code: project.code,
              name_ar: project.name_ar,
              developer_id: project.developer_id ?? '',
              status: project.status,
              notes: project.notes,
              bank_name: project.bank_name,
              bank_account: project.bank_account,
              bank_iban: project.bank_iban,
              checklist_template_id: project.checklist_template_id,
              assigned_employee_id: project.assigned_employee_id,
              rega_license_no: project.rega_license_no,
              rega_agreement_date_hijri: project.rega_agreement_date_hijri,
              rega_agreement_date_gregorian: project.rega_agreement_date_gregorian,
              land_price_sar: project.land_price_sar,
              estimated_construction_sar: project.estimated_construction_sar,
              estimated_admin_marketing_sar: project.estimated_admin_marketing_sar,
              project_start_date: project.project_start_date,
              rega_license_expiry_date: project.rega_license_expiry_date,
              engineer_consultant_name: project.engineer_consultant_name,
              engineer_consultant_contract_sar: project.engineer_consultant_contract_sar,
              contractor_1_name: project.contractor_1_name,
              contractor_1_contract_sar: project.contractor_1_contract_sar,
              contractor_2_name: project.contractor_2_name,
              contractor_2_contract_sar: project.contractor_2_contract_sar,
              contractor_3_name: project.contractor_3_name,
              contractor_3_contract_sar: project.contractor_3_contract_sar,
              contractor_4_name: project.contractor_4_name,
              contractor_4_contract_sar: project.contractor_4_contract_sar,
            }}
            developerName={developerName}
            clients={clients}
          />
        </SectionCard>

        {/* 2. Bank accounts — link to project page (slice 2 will inline it) */}
        <SectionCard
          index={2}
          title="الحسابات البنكية"
          complete={accountsComplete}
          href={projectHref}
          summary={
            <div className="flex flex-wrap gap-2 text-xs">
              <Chip label={`${accountsCount} حساب نشط`} tone="emerald" />
              {accountsCount < 4 && (
                <Chip label="يوصى بإعداد 4 حسابات (عام / إنشاءات / إداري وتسويقي / حفظ)" tone="slate" />
              )}
            </div>
          }
          emptyPrompt="لم تُضَف أي حسابات بنكية بعد. افتح صفحة المشروع وأضف الحسابات (عام / إنشاءات / إداري / حفظ)."
        />

        {/* 3. Team */}
        <SectionCard
          index={3}
          title="الفريق"
          complete={teamComplete}
          href={projectHref}
          summary={<Chip label={`${assigneesCount} عضو مُسند`} tone="emerald" />}
          emptyPrompt="لم يُسند أحد لهذا المشروع بعد. أضف موظفًا أو مشرفًا على الأقل."
        />

        {/* 4. Checklist template */}
        <SectionCard
          index={4}
          title="قالب المراجعة"
          complete={checklistComplete}
          href={projectHref}
          summary={
            checklistTemplateName
              ? <Chip label={checklistTemplateName} tone="teal" />
              : <Chip label="افتراضي (يستخدم قالب العميل أو القالب الافتراضي للمكتب)" tone="slate" />
          }
        />

        {/* 5. Units */}
        <SectionCard
          index={5}
          title="الوحدات"
          complete={unitsComplete}
          href={unitsHref}
          summary={<Chip label={`${unitsCount.toLocaleString('en-US')} وحدة`} tone="indigo" />}
          emptyPrompt="لم تُستورد أي وحدات بعد."
        />

        {/* 6. Buyer contracts */}
        <SectionCard
          index={6}
          title="عقود المشترين"
          complete={contractsComplete}
          href={contractsHref}
          summary={<Chip label={`${contractsCount.toLocaleString('en-US')} عقد`} tone="teal" />}
          emptyPrompt="لا توجد عقود مشترين بعد."
        />

        {/* 7. Vendors */}
        <SectionCard
          index={7}
          title="الموردون ومقدمو الخدمات"
          complete={vendorsComplete}
          href={vendorsHref}
          summary={<Chip label={`${vendorsCount} مورد`} tone="amber" />}
          emptyPrompt="لم يُضَف أي مورد بعد (اختياري)."
        />

        {/* 8. Payments */}
        <SectionCard
          index={8}
          title="الدفعات"
          complete={paymentsComplete}
          href={paymentsHref}
          summary={<Chip label={`${paymentsCount.toLocaleString('en-US')} دفعة`} tone="emerald" />}
          emptyPrompt="لم تُسجَّل أي دفعات بعد."
        />
      </div>

      {/* REGA quarterly reports card lives on the main project page now
          (moved out of تهيئة المشروع per client request). See
          ./RegaReportsCard rendered from ../[projectId]/page.tsx. */}
    </div>
  )
}

function Chip({
  label,
  tone,
}: {
  label: string
  tone: 'teal' | 'emerald' | 'indigo' | 'amber' | 'slate'
}) {
  const cls =
    tone === 'teal'    ? 'bg-teal-50 text-teal-800 ring-teal-200' :
    tone === 'emerald' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' :
    tone === 'indigo'  ? 'bg-indigo-50 text-indigo-800 ring-indigo-200' :
    tone === 'amber'   ? 'bg-amber-50 text-amber-800 ring-amber-200' :
    'bg-slate-50 text-slate-700 ring-slate-200'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${cls}`}>
      {label}
    </span>
  )
}
