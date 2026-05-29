import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ArrowRight, Plus, Settings, Users, FolderKanban } from 'lucide-react'

export const dynamic = 'force-dynamic'

type StaffRole = 'employee' | 'supervisor' | 'owner'

type ClientRow = {
  id: string
  company_name_ar: string
  contact_name: string | null
  contact_email: string | null
  user_id: string | null
  status: string | null
}

type ProjectRow = {
  id: string
  code: string
  name_ar: string
  assigned_employee_id: string | null
  status: string | null
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

export default async function DisbursementsAdminPage({
  searchParams,
}: {
  searchParams?: { created?: string }
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

  // Fetch clients (dsb_developers).
  const { data: clientsData } = await svc
    .from('dsb_developers')
    .select('id, company_name_ar, contact_name, contact_email, user_id, status')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  const clients = (clientsData ?? []) as ClientRow[]

  // Fetch projects.
  const { data: projectsData } = await svc
    .from('dsb_projects')
    .select('id, code, name_ar, assigned_employee_id, status')
    .eq('tenant_id', tenantId)
    .order('code', { ascending: true })
  const projects = (projectsData ?? []) as ProjectRow[]

  // Fetch user names for assigned employees.
  const employeeIds = Array.from(
    new Set(projects.map((p) => p.assigned_employee_id).filter((id): id is string => !!id))
  )
  const employeeNameById = new Map<string, string>()
  if (employeeIds.length > 0) {
    const { data: empRows } = await svc
      .from('users')
      .select('id, full_name')
      .in('id', employeeIds)
    for (const row of (empRows ?? []) as { id: string; full_name: string | null }[]) {
      employeeNameById.set(row.id, row.full_name ?? '—')
    }
  }

  // Counts per project.
  const projectCaseCounts = new Map<string, number>()
  if (projects.length > 0) {
    const { data: caseRows } = await svc
      .from('dsb_cases')
      .select('project_id')
      .eq('tenant_id', tenantId)
      .in('project_id', projects.map((p) => p.id))
    for (const row of (caseRows ?? []) as { project_id: string }[]) {
      projectCaseCounts.set(row.project_id, (projectCaseCounts.get(row.project_id) ?? 0) + 1)
    }
  }

  const created = searchParams?.created ?? null

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      <header className="space-y-2">
        <Link
          href="/app/disbursements"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          <ArrowRight className="w-3.5 h-3.5 ms-1 rotate-180" aria-hidden="true" />
          صندوق الصرفيات
        </Link>
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <Settings className="w-4 h-4" aria-hidden="true" />
          إدارة الصرفيات
        </div>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">إدارة الصرفيات</h1>
        <p className="text-sm text-slate-600">إدارة العملاء والمشاريع.</p>
      </header>

      {created === 'client' && (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          تم إنشاء العميل بنجاح.
        </div>
      )}
      {created === 'project' && (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          تم إنشاء المشروع بنجاح.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Clients section */}
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
            <div className="inline-flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-500" aria-hidden="true" />
              <h2 className="serif font-bold text-lg text-slate-900">العملاء</h2>
              <span className="text-xs text-slate-400 font-mono">({clients.length})</span>
            </div>
            <Link
              href="/app/disbursements/admin/clients/new"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              عميل جديد
            </Link>
          </div>

          {clients.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">لا يوجد عملاء بعد.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {clients.map((c) => {
                const pill = statusPill(c.status)
                const hasLogin = !!c.user_id
                return (
                  <li key={c.id}>
                    <Link
                      href={`/app/disbursements/admin/clients/${c.id}`}
                      className="block px-5 py-3 hover:bg-slate-50 transition"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900 truncate">
                            {c.company_name_ar}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 truncate">
                            {c.contact_name ? `${c.contact_name} · ` : ''}
                            {c.contact_email ?? '—'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${
                              hasLogin
                                ? 'bg-teal-50 text-teal-700 ring-teal-200'
                                : 'bg-slate-100 text-slate-500 ring-slate-200'
                            }`}
                          >
                            {hasLogin ? 'لديه حساب' : 'بدون حساب'}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${pill.cls}`}
                          >
                            {pill.label}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-400 rotate-180" aria-hidden="true" />
                        </div>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Projects section */}
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
            <div className="inline-flex items-center gap-2">
              <FolderKanban className="w-4 h-4 text-slate-500" aria-hidden="true" />
              <h2 className="serif font-bold text-lg text-slate-900">المشاريع</h2>
              <span className="text-xs text-slate-400 font-mono">({projects.length})</span>
            </div>
            <Link
              href="/app/disbursements/admin/projects/new"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              مشروع جديد
            </Link>
          </div>

          {projects.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">لا توجد مشاريع بعد.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {projects.map((p) => {
                const pill = statusPill(p.status)
                const empName = p.assigned_employee_id ? employeeNameById.get(p.assigned_employee_id) ?? '—' : '—'
                const count = projectCaseCounts.get(p.id) ?? 0
                return (
                  <li key={p.id} className="px-5 py-3 hover:bg-slate-50 transition">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-mono text-xs text-slate-500">{p.code}</span>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs text-slate-500">{count} سند</span>
                        </div>
                        <div className="text-sm font-semibold text-slate-900 truncate">{p.name_ar}</div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">الموظف المسؤول: {empName}</div>
                      </div>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${pill.cls}`}
                      >
                        {pill.label}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
