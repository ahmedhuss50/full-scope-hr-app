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
    .select('accountant_signer_name, accountant_signer_phone, accountant_signer_email')
    .eq('id', tenantId)
    .maybeSingle()
  const tenantDefaults = {
    preparer_name:  (tenantData as { accountant_signer_name: string | null } | null)?.accountant_signer_name  ?? null,
    preparer_phone: (tenantData as { accountant_signer_phone: string | null } | null)?.accountant_signer_phone ?? null,
    preparer_email: (tenantData as { accountant_signer_email: string | null } | null)?.accountant_signer_email ?? null,
  }

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
