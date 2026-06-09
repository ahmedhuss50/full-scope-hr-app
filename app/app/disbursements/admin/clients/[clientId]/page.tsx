import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { ArrowRight, Plus, Users, FolderKanban, FileText, Mail } from 'lucide-react'
import { ShareUploadLinkButton } from './ShareUploadLinkButton'
import { ClientPortalCard } from './ClientPortalCard'
import { DeleteClientButton } from '../../EntityDeleteButtons'
import { EditClientInfo } from './EditClientInfo'

export const dynamic = 'force-dynamic'

type ClientRow = {
  id: string
  company_name_ar: string
  contact_name: string | null
  contact_email: string | null
  user_id: string | null
  status: string | null
  notes: string | null
  bank_name: string | null
  bank_account: string | null
  bank_iban: string | null
}

type ProjectRow = {
  id: string
  code: string
  name_ar: string
  assigned_employee_id: string | null
  status: string | null
}

type CaseRow = {
  id: string
  case_number: string
  project_id: string
  voucher_number_text: string | null
  amount_sar: number | null
  status: string
  submitted_at: string | null
}

function fmtSar(amount: number | null): string {
  if (amount == null) return '—'
  try {
    return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${amount} ر.س`
  }
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Intl.DateTimeFormat('ar-SA', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(s))
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

function casePill(status: string): { cls: string; label: string } {
  switch (status) {
    case 'with_employee':           return { cls: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'بانتظار الموظف' }
    case 'with_supervisor':         return { cls: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'بانتظار المشرف' }
    case 'with_owner':              return { cls: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'بانتظار التوقيع' }
    case 'sent_back_to_developer':  return { cls: 'bg-red-50 text-red-700 ring-red-200',       label: 'أُعيدت إلى المطوّر' }
    case 'signed':                  return { cls: 'bg-green-50 text-green-700 ring-green-200', label: 'موقَّعة' }
    case 'cancelled':               return { cls: 'bg-slate-100 text-slate-500 ring-slate-200', label: 'ملغاة' }
    case 'draft':                   return { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: 'مسودة' }
    default:                        return { cls: 'bg-slate-100 text-slate-700 ring-slate-200', label: status }
  }
}

export default async function ClientDetailPage({
  params,
}: {
  params: { clientId: string }
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
  const clientId = params.clientId

  // Fetch the client — must belong to this tenant or 404.
  const { data: clientData } = await svc
    .from('dsb_developers')
    .select('id, company_name_ar, contact_name, contact_email, user_id, status, notes, bank_name, bank_account, bank_iban, tenant_id')
    .eq('id', clientId)
    .maybeSingle()
  if (!clientData || (clientData as { tenant_id: string }).tenant_id !== tenantId) {
    notFound()
  }
  const client = clientData as unknown as ClientRow & { tenant_id: string }

  // Fetch all projects for this developer.
  const { data: projectsData } = await svc
    .from('dsb_projects')
    .select('id, code, name_ar, assigned_employee_id, status')
    .eq('tenant_id', tenantId)
    .eq('developer_id', clientId)
    .order('code', { ascending: true })
  const projects = (projectsData ?? []) as ProjectRow[]

  // Lookup names for assigned employees.
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

  // Cases for this developer.
  const { data: casesData } = await svc
    .from('dsb_cases')
    .select('id, case_number, project_id, voucher_number_text, amount_sar, status, submitted_at')
    .eq('tenant_id', tenantId)
    .eq('developer_id', clientId)
    .order('created_at', { ascending: false })
  const cases = (casesData ?? []) as CaseRow[]

  // Per-project case counts (derived from the cases we already pulled).
  const projectCaseCounts = new Map<string, number>()
  for (const c of cases) {
    projectCaseCounts.set(c.project_id, (projectCaseCounts.get(c.project_id) ?? 0) + 1)
  }

  // Project name lookup for cases list (cases may reference a project not in
  // `projects` if that project is not yet tied to this developer — fall back
  // to a separate fetch).
  const projectNameById = new Map<string, { code: string; name_ar: string }>()
  for (const p of projects) projectNameById.set(p.id, { code: p.code, name_ar: p.name_ar })
  const missingProjectIds = Array.from(
    new Set(cases.map((c) => c.project_id).filter((id) => !projectNameById.has(id)))
  )
  if (missingProjectIds.length > 0) {
    const { data: extraProjects } = await svc
      .from('dsb_projects')
      .select('id, code, name_ar')
      .in('id', missingProjectIds)
    for (const p of (extraProjects ?? []) as { id: string; code: string; name_ar: string }[]) {
      projectNameById.set(p.id, { code: p.code, name_ar: p.name_ar })
    }
  }

  const pill = statusPill(client.status)
  const hasLogin = !!client.user_id
  const portalUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.fullscope.sa') + '/login'

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      <header className="space-y-3">
        <Link
          href="/app/disbursements/admin"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          <ArrowRight className="w-3.5 h-3.5 ms-1 rotate-180" aria-hidden="true" />
          العودة إلى العملاء
        </Link>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
              <Users className="w-4 h-4" aria-hidden="true" />
              عميل
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
                {client.company_name_ar}
              </h1>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${pill.cls}`}
              >
                {pill.label}
              </span>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2 flex-wrap">
            <ShareUploadLinkButton
              client={{
                id: client.id,
                company_name_ar: client.company_name_ar,
                contact_name: client.contact_name,
                contact_email: client.contact_email,
              }}
              projects={projects.map((p) => ({ id: p.id, code: p.code, name_ar: p.name_ar }))}
            />
            <Link
              href={`/app/disbursements/admin/projects/new?client=${encodeURIComponent(client.id)}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              مشروع جديد
            </Link>
            <EditClientInfo
              client={{
                id: client.id,
                company_name_ar: client.company_name_ar,
                contact_name: client.contact_name,
                contact_email: client.contact_email ?? '',
                notes: client.notes,
                status: client.status,
                bank_name: client.bank_name,
                bank_account: client.bank_account,
                bank_iban: client.bank_iban,
              }}
            />
            {dsbRole === 'owner' && (
              <DeleteClientButton
                clientId={client.id}
                clientName={client.company_name_ar}
                size="sm"
              />
            )}
          </div>
        </div>
      </header>

      {/* Client info card */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-slate-500 mb-0.5">جهة الاتصال</div>
            <div className="font-semibold text-slate-900">{client.contact_name ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">البريد الإلكتروني</div>
            <div className="font-mono text-slate-900 truncate inline-flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
              {client.contact_email ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">حساب الدخول</div>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${
                hasLogin
                  ? 'bg-teal-50 text-teal-700 ring-teal-200'
                  : 'bg-slate-100 text-slate-500 ring-slate-200'
              }`}
            >
              {hasLogin ? 'لديه حساب دخول' : 'بدون حساب دخول'}
            </span>
          </div>
        </div>
        {client.notes && (
          <div className="pt-3 border-t border-slate-100">
            <div className="text-xs text-slate-500 mb-1">ملاحظات</div>
            <div className="text-sm text-slate-700 whitespace-pre-wrap">{client.notes}</div>
          </div>
        )}
        {(client.bank_name || client.bank_account || client.bank_iban) && (
          <div className="pt-3 border-t border-slate-100 space-y-2">
            <div className="text-xs font-semibold text-slate-500">بنك المطور (الجهة الدافعة)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {client.bank_name && (
                <div>
                  <div className="text-xs text-slate-500 mb-0.5">اسم البنك</div>
                  <div className="font-semibold text-slate-900">{client.bank_name}</div>
                </div>
              )}
              {client.bank_account && (
                <div>
                  <div className="text-xs text-slate-500 mb-0.5">رقم الحساب</div>
                  <div className="font-mono text-slate-900" dir="ltr">{client.bank_account}</div>
                </div>
              )}
              {client.bank_iban && (
                <div className="sm:col-span-2">
                  <div className="text-xs text-slate-500 mb-0.5">الآيبان</div>
                  <div className="font-mono text-slate-900" dir="ltr">{client.bank_iban}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Client portal sign-in card */}
      <ClientPortalCard
        clientId={client.id}
        recipientName={client.contact_name ?? client.company_name_ar}
        recipientEmail={client.contact_email}
        hasLogin={hasLogin}
        portalUrl={portalUrl}
      />

      {/* Projects section */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="inline-flex items-center gap-2">
            <FolderKanban className="w-4 h-4 text-slate-500" aria-hidden="true" />
            <h2 className="serif font-bold text-lg text-slate-900">مشاريع العميل</h2>
            <span className="text-xs text-slate-400 font-mono">({projects.length})</span>
          </div>
          <Link
            href={`/app/disbursements/admin/projects/new?client=${encodeURIComponent(client.id)}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            مشروع جديد
          </Link>
        </div>

        {projects.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">لا توجد مشاريع لهذا العميل.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {projects.map((p) => {
              const pPill = statusPill(p.status)
              const empName = p.assigned_employee_id
                ? employeeNameById.get(p.assigned_employee_id) ?? '—'
                : '—'
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
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${pPill.cls}`}
                        >
                          {pPill.label}
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

      {/* Cases section */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="inline-flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-500" aria-hidden="true" />
            <h2 className="serif font-bold text-lg text-slate-900">كل سندات الصرف</h2>
            <span className="text-xs text-slate-400 font-mono">({cases.length})</span>
          </div>
        </div>

        {cases.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">لا توجد سندات صرف لهذا العميل.</div>
        ) : (
          <ul className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
            {cases.map((c) => {
              const cPill = casePill(c.status)
              const proj = projectNameById.get(c.project_id)
              return (
                <li key={c.id}>
                  <Link
                    href={`/app/disbursements/${c.id}`}
                    className="block px-5 py-3 hover:bg-slate-50 transition"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-mono text-xs text-slate-500">{c.case_number}</span>
                          {c.voucher_number_text && (
                            <>
                              <span className="text-xs text-slate-400">·</span>
                              <span className="text-xs text-slate-500">سند {c.voucher_number_text}</span>
                            </>
                          )}
                        </div>
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {proj ? `${proj.code} — ${proj.name_ar}` : '—'}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {fmtSar(c.amount_sar)} · {fmtDate(c.submitted_at)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${cPill.cls}`}
                        >
                          {cPill.label}
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
  )
}
