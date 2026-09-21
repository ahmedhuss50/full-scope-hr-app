/**
 * CPA quarterly report page — owner-only editor for the report record
 * that drives the نموذج المحاسب القانوني generator.
 */
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ArrowRight, FileSpreadsheet } from 'lucide-react'
import { CpaReportEditor } from './CpaReportEditor'
import type { ForecastRow } from './actions'
import { ValidationCard, type ValidationItem } from './ValidationCard'

export const dynamic = 'force-dynamic'

function currentQuarterOfYear(): { year: number; quarter: number } {
  const now = new Date()
  const month = now.getMonth() + 1
  const quarter = Math.min(4, Math.max(1, Math.ceil(month / 3)))
  return { year: now.getFullYear(), quarter }
}

export default async function CpaReportPage({
  params,
  searchParams,
}: {
  params: { projectId: string }
  searchParams?: { year?: string; quarter?: string }
}) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users').select('id, tenant_id, dsb_role').eq('email', user.email!).maybeSingle()
  if (!profile) redirect('/login')

  const dsbRole = (profile.dsb_role as string | null) ?? ''
  if (dsbRole !== 'owner') redirect('/app/disbursements')

  const tenantId = profile.tenant_id as string
  const projectId = params.projectId

  // Load project (basic + REGA fields for header)
  const { data: projectData } = await svc
    .from('dsb_projects')
    .select('id, tenant_id, code, name_ar, rega_license_no')
    .eq('id', projectId)
    .maybeSingle()
  if (!projectData || (projectData as { tenant_id: string }).tenant_id !== tenantId) notFound()
  const project = projectData as { id: string; code: string; name_ar: string; rega_license_no: string | null }

  // Period defaults
  const now = currentQuarterOfYear()
  const yearParam    = Number(searchParams?.year ?? now.year)
  const quarterParam = Number(searchParams?.quarter ?? now.quarter)
  const year    = Number.isFinite(yearParam)    && yearParam >= 2020 && yearParam <= 2100 ? yearParam    : now.year
  const quarter = Number.isFinite(quarterParam) && [1,2,3,4].includes(quarterParam)       ? quarterParam : now.quarter

  // Load existing report (if any) for this period
  const { data: reportData } = await svc
    .from('dsb_cpa_reports')
    .select('preparer_name, preparer_phone, preparer_email, opening_balance_sar, forecast_rows, notes_sales, notes_expenses, notes_collection, notes_current_risks, notes_future_risks, notes_other')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .eq('period_year', year)
    .eq('period_quarter', quarter)
    .maybeSingle()

  const report = reportData ? {
    preparer_name:  (reportData as { preparer_name: string | null }).preparer_name,
    preparer_phone: (reportData as { preparer_phone: string | null }).preparer_phone,
    preparer_email: (reportData as { preparer_email: string | null }).preparer_email,
    opening_balance_sar: Number((reportData as { opening_balance_sar: number | null }).opening_balance_sar ?? 0),
    forecast_rows: (Array.isArray((reportData as { forecast_rows: unknown }).forecast_rows) ? (reportData as { forecast_rows: ForecastRow[] }).forecast_rows : []) as ForecastRow[],
    notes_sales:         (reportData as { notes_sales: string | null }).notes_sales,
    notes_expenses:      (reportData as { notes_expenses: string | null }).notes_expenses,
    notes_collection:    (reportData as { notes_collection: string | null }).notes_collection,
    notes_current_risks: (reportData as { notes_current_risks: string | null }).notes_current_risks,
    notes_future_risks:  (reportData as { notes_future_risks: string | null }).notes_future_risks,
    notes_other:         (reportData as { notes_other: string | null }).notes_other,
  } : null

  // Tenant defaults for preparer info (mig 066 fields)
  const { data: tenantData } = await svc
    .from('tenants')
    .select('accountant_office_name, accountant_signer_name, accountant_signer_phone, accountant_signer_email')
    .eq('id', tenantId)
    .maybeSingle()
  const tenantDefaults = {
    preparer_name:  (tenantData as { accountant_signer_name: string | null } | null)?.accountant_signer_name  ?? null,
    preparer_phone: (tenantData as { accountant_signer_phone: string | null } | null)?.accountant_signer_phone ?? null,
    preparer_email: (tenantData as { accountant_signer_email: string | null } | null)?.accountant_signer_email ?? null,
  }
  const tenantOfficeName = (tenantData as { accountant_office_name: string | null } | null)?.accountant_office_name ?? null

  // ---- Pre-generation validation ----
  const [projFullRes, accountsRes] = await Promise.all([
    svc.from('dsb_projects')
      .select('rega_license_no, land_price_sar, estimated_construction_sar, estimated_admin_marketing_sar, engineer_consultant_name, contractor_1_name, project_start_date, region_ar, city_ar, district_ar')
      .eq('id', projectId)
      .maybeSingle(),
    svc.from('dsb_project_accounts')
      .select('id, label, account_role')
      .eq('tenant_id', tenantId)
      .eq('project_id', projectId),
  ])
  const projFull = (projFullRes.data ?? {}) as {
    rega_license_no?: string | null
    land_price_sar?: number | null
    estimated_construction_sar?: number | null
    estimated_admin_marketing_sar?: number | null
    engineer_consultant_name?: string | null
    contractor_1_name?: string | null
    project_start_date?: string | null
    region_ar?: string | null; city_ar?: string | null; district_ar?: string | null
  }
  const accounts = (accountsRes.data ?? []) as Array<{ id: string; label: string; account_role: string | null }>
  const untaggedAccounts = accounts.filter((a) => !a.account_role).length

  // Quarter date range
  const qStartMonth = (quarter - 1) * 3 + 1
  const qStart = `${year}-${String(qStartMonth).padStart(2, '0')}-01`
  const qEndDate = new Date(Date.UTC(year, qStartMonth + 2, 0))
  const qEnd = `${qEndDate.getUTCFullYear()}-${String(qEndDate.getUTCMonth() + 1).padStart(2, '0')}-${String(qEndDate.getUTCDate()).padStart(2, '0')}`

  // Count cases in quarter with missing disbursement type / vendor
  const { data: qCasesData } = await svc
    .from('dsb_cases')
    .select('id, vendor_id, extracted_fields, voucher_date')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .in('status', ['signed', 'delivered'])
    .gte('voucher_date', qStart)
    .lte('voucher_date', qEnd)
  const qCases = (qCasesData ?? []) as Array<{ id: string; vendor_id: string | null; extracted_fields: { disbursement_type_code?: string | null } | null; voucher_date: string | null }>
  const casesMissingType   = qCases.filter((c) => !c.extracted_fields?.disbursement_type_code).length
  const casesMissingVendor = qCases.filter((c) => !c.vendor_id).length

  const setupUrl   = `/app/disbursements/admin/projects/${projectId}/setup`
  const accountsUrl = `/app/disbursements/admin/accounts`
  const documentsUrl = `/app/disbursements/documents?project=${projectId}`

  const validation: ValidationItem[] = [
    // ---- Project setup ----
    { ok: !!projFull.rega_license_no,             severity: 'error',   label: 'رقم رخصة المشروع (REGA)',                   hint: 'مطلوب لرأس Sheet 1', fixHref: setupUrl },
    { ok: (projFull.land_price_sar ?? 0) > 0,     severity: 'error',   label: 'سعر الأرض',                                   hint: 'يستخدم في تحليل الأرباح', fixHref: setupUrl },
    { ok: (projFull.estimated_construction_sar ?? 0) > 0, severity: 'error', label: 'التكاليف الإنشائية التقديرية',      hint: 'يقارن مع الفعلي في Sheet 5', fixHref: setupUrl },
    { ok: (projFull.estimated_admin_marketing_sar ?? 0) > 0, severity: 'error', label: 'التكاليف الإدارية والتسويقية التقديرية', hint: 'يقارن مع الفعلي في Sheet 5', fixHref: setupUrl },
    { ok: !!projFull.contractor_1_name,           severity: 'warning', label: 'اسم المقاول الرئيسي',                        hint: 'يظهر في Sheet 1', fixHref: setupUrl },
    { ok: !!projFull.engineer_consultant_name,    severity: 'warning', label: 'الاستشاري الهندسي',                          hint: 'يظهر في Sheet 5', fixHref: setupUrl },
    { ok: !!projFull.project_start_date,          severity: 'warning', label: 'تاريخ بداية المشروع',                       fixHref: setupUrl },
    { ok: !!projFull.region_ar && !!projFull.city_ar, severity: 'warning', label: 'الموقع (المنطقة / المدينة)',        hint: 'يظهر في Sheet 5', fixHref: setupUrl },
    // ---- Accounts ----
    { ok: accounts.length > 0,       severity: 'error',   label: 'حسابات الضمان مضافة',                                   hint: 'أضف حسابات المشروع', fixHref: accountsUrl },
    { ok: untaggedAccounts === 0,    severity: 'warning', label: 'كل حساب مُصنَّف (إنشاءات / إداري / حفظ / عام)',        hint: untaggedAccounts > 0 ? `${untaggedAccounts} حساب/حسابات بدون تصنيف` : undefined, fixHref: accountsUrl },
    // ---- Preparer ----
    { ok: !!tenantOfficeName,        severity: 'warning', label: 'اسم مكتب المحاسب القانوني',                             hint: 'إعدادات المستأجر' },
    { ok: !!(report?.preparer_name || tenantDefaults.preparer_name), severity: 'error', label: 'اسم معد التقرير', hint: 'اتركه فارغًا لاستخدام الافتراضي' },
    // ---- Report record ----
    { ok: !!report,                  severity: 'warning', label: 'تم حفظ التقرير لهذا الربع',                              hint: 'استخدم زر «حفظ التقرير» أدناه' },
    { ok: !report || Number(report?.opening_balance_sar ?? 0) > 0, severity: 'warning', label: 'رصيد إغلاق الربع السابق', hint: 'صفر يعني بداية المشروع أو حساب فارغ' },
    { ok: !report || Array.isArray(report?.forecast_rows) && report.forecast_rows.length > 0, severity: 'warning', label: 'العمليات المتوقعة للربع القادم', hint: 'اختياري لكن يظهر في Sheet 3' },
    { ok: !report || !!(report?.notes_sales && report.notes_sales.trim()), severity: 'warning', label: 'ملاحظات Sheet 6 مكتملة', hint: 'على الأقل قسم المبيعات' },
    // ---- Voucher data quality (in-quarter) ----
    { ok: qCases.length > 0,         severity: 'warning', label: 'وجود سندات صرف موقّعة خلال الربع',                    hint: qCases.length === 0 ? 'لا توجد سندات في نطاق التواريخ' : undefined, fixHref: documentsUrl },
    { ok: casesMissingType === 0,    severity: 'warning', label: 'كل السندات لها نوع صرف',                              hint: casesMissingType > 0 ? `${casesMissingType} سند بدون نوع صرف` : undefined, fixHref: documentsUrl },
    { ok: casesMissingVendor === 0,  severity: 'warning', label: 'كل السندات مربوطة بمورد',                             hint: casesMissingVendor > 0 ? `${casesMissingVendor} سند بدون مورد` : undefined, fixHref: documentsUrl },
  ]

  return (
    <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
      <Link
        href={`/app/disbursements/admin/projects/${projectId}`}
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        العودة إلى المشروع
      </Link>

      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-700">
          <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />
          نموذج المحاسب القانوني
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">{project.name_ar}</h1>
          <span className="font-mono text-sm text-slate-500">{project.code}</span>
          {project.rega_license_no && (
            <span className="text-sm text-slate-400 font-mono" dir="ltr">— {project.rega_license_no}</span>
          )}
        </div>
        <p className="text-sm text-slate-600">
          املأ الحقول اليدوية للربع، ثم اضغط «توليد وتنزيل» لإنشاء نموذج المحاسب
          القانوني كاملًا مع الأوراق 1–7.
        </p>
      </header>

      <ValidationCard items={validation} />

      <CpaReportEditor
        projectId={projectId}
        initialYear={year}
        initialQuarter={quarter}
        initialReport={report}
        tenantDefaults={tenantDefaults}
      />
    </div>
  )
}
