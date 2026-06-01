import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { FolderKanban, FileText, Plus } from 'lucide-react'
import { DeleteProjectButton } from '../../EntityDeleteButtons'

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
  { key: 'with_owner',             title: 'بانتظار التوقيع',         headCls: 'bg-amber-50 text-amber-800 border-amber-200' },
  { key: 'signed',                 title: 'موقّعة',                  headCls: 'bg-green-50 text-green-800 border-green-200' },
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
    .select('id, tenant_id, code, name_ar, status, notes, developer_id, assigned_employee_id')
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

  let assignedEmployeeName: string | null = null
  if (project.assigned_employee_id) {
    const { data: empRow } = await svc
      .from('users')
      .select('full_name')
      .eq('id', project.assigned_employee_id)
      .maybeSingle()
    assignedEmployeeName = (empRow?.full_name as string | null) ?? null
  }

  // Fetch cases for this project.
  const { data: casesData } = await svc
    .from('dsb_cases')
    .select('id, case_number, voucher_number_text, amount_sar, status, submitted_at, created_at')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  const cases = (casesData ?? []) as CaseRow[]

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
            <div className="text-xs text-slate-500 mb-0.5">الموظف المسؤول</div>
            <div className="font-semibold text-slate-900">{assignedEmployeeName ?? '—'}</div>
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
