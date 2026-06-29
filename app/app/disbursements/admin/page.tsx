import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ArrowRight, Plus, Settings, Users, FolderKanban, UserCog, ListChecks } from 'lucide-react'
import { DeleteEmployeeButton } from './EntityDeleteButtons'
import {
  SendWelcomeToUserButton,
  SendWelcomeToAllStaffButton,
} from './WelcomeEmailButtons'
import { ChangeRoleButton } from './ChangeRoleButton'
import { EmployeeProjectsEditor, type ProjectPickerOption } from './EmployeeProjectsEditor'

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

type EmployeeRow = {
  id: string
  full_name: string | null
  email: string | null
  // Broadened: viewer (مشاهد) + deliverer (مسلِّم) joined the role list.
  dsb_role: 'employee' | 'supervisor' | 'owner' | 'viewer' | 'deliverer' | null
}

function roleLabel(role: string | null): { cls: string; label: string } {
  switch (role) {
    case 'owner':
      return { cls: 'bg-violet-50 text-violet-700 ring-violet-200', label: 'مدير' }
    case 'supervisor':
      return { cls: 'bg-amber-50 text-amber-800 ring-amber-200', label: 'مشرف' }
    case 'employee':
      return { cls: 'bg-teal-50 text-teal-700 ring-teal-200', label: 'موظف' }
    case 'viewer':
      return { cls: 'bg-slate-50 text-slate-700 ring-slate-200', label: 'مشاهد' }
    case 'deliverer':
      return { cls: 'bg-blue-50 text-blue-700 ring-blue-200', label: 'مسلِّم' }
    default:
      return { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: role ?? '—' }
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
  const isOwner = dsbRole === 'owner'

  const tenantId = profile.tenant_id as string

  // Fetch staff — all internal roles (including viewer / deliverer added later).
  // Without 'viewer' and 'deliverer' here, users assigned those roles disappear
  // from the admin list, leaving no way to undo the change from the UI.
  const { data: employeesData } = await svc
    .from('users')
    .select('id, full_name, email, dsb_role')
    .eq('tenant_id', tenantId)
    .in('dsb_role', ['employee', 'supervisor', 'owner', 'viewer', 'deliverer'])
    .order('full_name', { ascending: true })
  const employees = (employeesData ?? []) as EmployeeRow[]

  // Fetch clients (dsb_developers).
  const { data: clientsData } = await svc
    .from('dsb_developers')
    .select('id, company_name_ar, contact_name, contact_email, user_id, status')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  const clients = (clientsData ?? []) as ClientRow[]

  // Fetch projects (now also includes developer_id so the "edit projects"
  // picker can group by client).
  const { data: projectsData } = await svc
    .from('dsb_projects')
    .select('id, code, name_ar, assigned_employee_id, status, developer_id')
    .eq('tenant_id', tenantId)
    .order('code', { ascending: true })
  const projects = (projectsData ?? []) as Array<ProjectRow & { developer_id: string | null }>

  // Developer names for the project picker grouping.
  const { data: developersForPicker } = await svc
    .from('dsb_developers')
    .select('id, company_name_ar')
    .eq('tenant_id', tenantId)
  const developerNameById = new Map<string, string>()
  for (const d of (developersForPicker ?? []) as { id: string; company_name_ar: string }[]) {
    developerNameById.set(d.id, d.company_name_ar)
  }
  const projectPickerOptions: ProjectPickerOption[] = projects.map((p) => ({
    id: p.id,
    code: p.code,
    name_ar: p.name_ar,
    developer_id: p.developer_id,
    developer_name: p.developer_id ? developerNameById.get(p.developer_id) ?? null : null,
  }))

  // Bulk-load the junction so each employee row can show its current
  // assignment count and pre-check the editor. One round-trip beats per-row
  // queries by the staff count.
  const { data: junctionRows } = await svc
    .from('dsb_project_employees')
    .select('user_id, project_id')
    .eq('tenant_id', tenantId)
  const projectIdsByUserId = new Map<string, string[]>()
  for (const row of (junctionRows ?? []) as { user_id: string; project_id: string }[]) {
    const arr = projectIdsByUserId.get(row.user_id) ?? []
    arr.push(row.project_id)
    projectIdsByUserId.set(row.user_id, arr)
  }

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

  // Count active checklist items (global defaults + tenant-specific).
  const { data: checklistData } = await svc
    .from('dsb_checklist_items')
    .select('id, active')
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
  const checklistActiveCount = ((checklistData ?? []) as { id: string; active: boolean }[])
    .filter((r) => r.active).length

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
      {created === 'employee' && (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          تم إنشاء الموظف بنجاح.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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

        {/* Employees section */}
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
            <div className="inline-flex items-center gap-2">
              <UserCog className="w-4 h-4 text-slate-500" aria-hidden="true" />
              <h2 className="serif font-bold text-lg text-slate-900">الموظفون</h2>
              <span className="text-xs text-slate-400 font-mono">({employees.length})</span>
            </div>
            {isOwner && (
              <div className="flex items-center gap-2 flex-wrap">
                <SendWelcomeToAllStaffButton />
                <Link
                  href="/app/disbursements/admin/employees/new"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  موظف جديد
                </Link>
              </div>
            )}
          </div>

          {employees.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">لا يوجد موظفون بعد.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {employees.map((e) => {
                const rp = roleLabel(e.dsb_role)
                // Owner cannot delete themselves; everyone else is fair game.
                const canDelete = isOwner && e.id !== profile.id
                return (
                  <li key={e.id} className="px-5 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {e.full_name ?? '—'}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate font-mono" dir="ltr">
                          {e.email ?? '—'}
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset shrink-0 ${rp.cls}`}
                      >
                        {rp.label}
                      </span>
                    </div>
                    {isOwner && (
                      <div className="pt-1 flex items-center gap-2 flex-wrap">
                        <SendWelcomeToUserButton
                          userId={e.id}
                          fullName={e.full_name ?? e.email ?? '—'}
                        />
                        {canDelete && e.dsb_role && (
                          <ChangeRoleButton
                            userId={e.id}
                            fullName={e.full_name ?? e.email ?? '—'}
                            currentRole={e.dsb_role}
                          />
                        )}
                        {/* Project-assignment editor: owner-only, hidden
                            for owner targets (they see everything) and for
                            the owner editing themselves. */}
                        {canDelete && e.dsb_role && e.dsb_role !== 'owner' && (
                          <EmployeeProjectsEditor
                            userId={e.id}
                            fullName={e.full_name ?? e.email ?? '—'}
                            initialProjectIds={projectIdsByUserId.get(e.id) ?? []}
                            projects={projectPickerOptions}
                          />
                        )}
                        {canDelete && (
                          <DeleteEmployeeButton
                            userId={e.id}
                            fullName={e.full_name ?? e.email ?? '—'}
                          />
                        )}
                      </div>
                    )}
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
                  <li key={p.id}>
                    <Link
                      href={`/app/disbursements/admin/projects/${p.id}`}
                      className="block px-5 py-3 hover:bg-slate-50 transition"
                    >
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
                        <div className="flex items-center gap-2 shrink-0">
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
      </div>

      {/* Checklist section */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div className="inline-flex items-center gap-2 min-w-0">
            <ListChecks className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
            <h2 className="serif font-bold text-lg text-slate-900">قائمة المراجعة</h2>
            <span className="text-xs text-slate-400 font-mono">({checklistActiveCount} نشط)</span>
          </div>
          <Link
            href="/app/disbursements/admin/checklist"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
          >
            إدارة
            <ArrowRight className="w-3.5 h-3.5 rotate-180" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* Accounts management — owner-only. Import bulk + manage existing. */}
      {isOwner && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-3">
          <div className="space-y-1">
            <h2 className="serif font-bold text-lg text-slate-900">
              حسابات الدفع
            </h2>
            <p className="text-xs text-slate-600 max-w-2xl">
              استيراد حسابات الدفع من ملف Excel، أو إدارة القائمة الكاملة وتعديل
              المشروع/العميل لكل حساب.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/app/disbursements/admin/import-accounts"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
            >
              فتح أداة الاستيراد
              <ArrowRight className="w-3.5 h-3.5 rotate-180" aria-hidden="true" />
            </Link>
            <Link
              href="/app/disbursements/admin/accounts"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              إدارة الحسابات
              <ArrowRight className="w-3.5 h-3.5 rotate-180" aria-hidden="true" />
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}
