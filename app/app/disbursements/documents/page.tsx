import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { FileText, Download } from 'lucide-react'
import { fmtDateTime } from '@/lib/dsb/datetime'
import { CaseFiltersBar } from '../CaseFiltersBar'

export const dynamic = 'force-dynamic'

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

type ProjectLite = { id: string; code: string; name_ar: string }
type DeveloperLite = { id: string; company_name_ar: string }

type SignedCaseRow = {
  id: string
  case_number: string
  voucher_number_text: string | null
  amount_sar: number | null
  signed_at: string | null
  signed_by_user_id: string | null
  project: ProjectLite | ProjectLite[] | null
  developer: DeveloperLite | DeveloperLite[] | null
}

function single<T>(maybe: T | T[] | null | undefined): T | null {
  if (!maybe) return null
  return Array.isArray(maybe) ? (maybe[0] ?? null) : maybe
}

export default async function DeliveryDocumentsRegisterPage({
  searchParams,
}: {
  searchParams?: {
    client?: string
    project?: string
    employee?: string
    status?: string
    from?: string
    to?: string
    q?: string
  }
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
  // Read-access only — viewer + deliverer can see the signed-docs register.
  // The register's whole purpose for the deliverer is finding the next case
  // they need to deliver.
  if (!dsbRole || !['employee', 'supervisor', 'owner', 'viewer', 'deliverer'].includes(dsbRole)) {
    redirect('/app/disbursements')
  }

  const tenantId = profile.tenant_id as string

  // ---------- Filters from URL ----------
  const f = searchParams ?? {}
  const fClient   = (f.client   ?? '').trim() || null
  const fProject  = (f.project  ?? '').trim() || null
  const fEmployee = (f.employee ?? '').trim() || null
  const fFrom     = (f.from     ?? '').trim() || null
  const fTo       = (f.to       ?? '').trim() || null
  const fQ        = (f.q        ?? '').trim() || null

  // If filtering by employee, resolve their assigned projects first.
  let projectIdsForEmployee: string[] | null = null
  if (fEmployee) {
    const { data: empProjects } = await svc
      .from('dsb_projects')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('assigned_employee_id', fEmployee)
    projectIdsForEmployee = ((empProjects ?? []) as { id: string }[]).map((p) => p.id)
  }

  // ---------- Dropdown options for the filter bar ----------
  const [clientOptsRes, projectOptsRes, employeeOptsRes] = await Promise.all([
    svc
      .from('dsb_developers')
      .select('id, company_name_ar')
      .eq('tenant_id', tenantId)
      .order('company_name_ar', { ascending: true }),
    svc
      .from('dsb_projects')
      .select('id, code, name_ar, developer_id')
      .eq('tenant_id', tenantId)
      .order('code', { ascending: true }),
    svc
      .from('users')
      .select('id, full_name')
      .eq('tenant_id', tenantId)
      .in('dsb_role', ['employee', 'supervisor', 'owner', 'deliverer'])
      .order('full_name', { ascending: true }),
  ])
  const clientOptions = ((clientOptsRes.data ?? []) as Array<{ id: string; company_name_ar: string }>)
    .map((c) => ({ id: c.id, label: c.company_name_ar }))
  const projectOptions = ((projectOptsRes.data ?? []) as Array<{ id: string; code: string; name_ar: string; developer_id: string | null }>)
    .map((p) => ({ id: p.id, label: `${p.code} — ${p.name_ar}`, developer_id: p.developer_id }))
  const employeeOptions = ((employeeOptsRes.data ?? []) as Array<{ id: string; full_name: string | null }>)
    .map((u) => ({ id: u.id, label: u.full_name ?? '—' }))

  // ---------- Build the cases query with filters applied ----------
  let casesQuery = svc
    .from('dsb_cases')
    .select(
      `id, case_number, voucher_number_text, amount_sar, signed_at, signed_by_user_id,
       project:dsb_projects!dsb_cases_project_id_fkey(id, code, name_ar),
       developer:dsb_developers!dsb_cases_developer_id_fkey(id, company_name_ar)`,
    )
    .eq('tenant_id', tenantId)
    .eq('status', 'signed')
  if (fClient) casesQuery = casesQuery.eq('developer_id', fClient)
  if (fProject) casesQuery = casesQuery.eq('project_id', fProject)
  // The register is signed-only; "from" / "to" here filter by signed_at.
  if (fFrom) casesQuery = casesQuery.gte('signed_at', `${fFrom}T00:00:00+03`)
  if (fTo) casesQuery = casesQuery.lte('signed_at', `${fTo}T23:59:59+03`)
  if (fQ) casesQuery = casesQuery.or(`case_number.ilike.%${fQ}%,voucher_number_text.ilike.%${fQ}%`)
  // Employee filter: if they have zero projects, force a no-match by using
  // an impossible UUID list. Supabase's .in() with an empty array returns
  // everything, which would be the wrong semantic here.
  if (projectIdsForEmployee !== null) {
    const projectFilterIds =
      projectIdsForEmployee.length === 0
        ? ['00000000-0000-0000-0000-000000000000']
        : projectIdsForEmployee
    casesQuery = casesQuery.in('project_id', projectFilterIds)
  }
  const { data: casesData } = await casesQuery.order('signed_at', { ascending: false })
  const cases = (casesData ?? []) as SignedCaseRow[]

  // Resolve signer names in bulk.
  const signerIds = Array.from(
    new Set(cases.map((c) => c.signed_by_user_id).filter((x): x is string => !!x)),
  )
  const signerNameById = new Map<string, string>()
  if (signerIds.length > 0) {
    const { data: users } = await svc
      .from('users')
      .select('id, full_name')
      .in('id', signerIds)
    for (const u of (users ?? []) as { id: string; full_name: string | null }[]) {
      signerNameById.set(u.id, u.full_name ?? '—')
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      <header className="space-y-2">
        <Link
          href="/app/disbursements"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          ← العودة إلى صندوق الصرفيات
        </Link>
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <FileText className="w-4 h-4" aria-hidden="true" />
          وثائق التسليم
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            سجل وثائق التسليم
          </h1>
          <span className="text-sm text-slate-400 font-mono">({cases.length})</span>
        </div>
        <p className="text-sm text-slate-600">
          كل الطلبات الجاهزة للتسليم — جاهزة لإصدار وثيقة التسليم.
        </p>
      </header>

      <CaseFiltersBar
        clients={clientOptions}
        projects={projectOptions}
        employees={employeeOptions}
      />

      {cases.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500 shadow-sm">
          لم تُصدَر أي وثائق تسليم بعد.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-right">
                  <Th>رقم الطلب</Th>
                  <Th>المشروع</Th>
                  <Th>العميل</Th>
                  <Th>رقم السند</Th>
                  <Th>المبلغ</Th>
                  <Th>تاريخ التوقيع</Th>
                  <Th>وقّع</Th>
                  <Th>الإجراء</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cases.map((c) => {
                  const project = single(c.project)
                  const developer = single(c.developer)
                  const signer = c.signed_by_user_id
                    ? signerNameById.get(c.signed_by_user_id) ?? '—'
                    : '—'
                  return (
                    <tr key={c.id} className="hover:bg-slate-50 transition">
                      <Td>
                        <Link
                          href={`/app/disbursements/${c.id}`}
                          className="font-mono text-xs font-semibold text-teal-700 hover:text-teal-900"
                        >
                          {c.case_number}
                        </Link>
                      </Td>
                      <Td>
                        {project ? (
                          <span>
                            <span className="font-mono text-xs text-slate-500">{project.code}</span>
                            <span className="text-slate-400 mx-1">·</span>
                            <span className="text-slate-900">{project.name_ar}</span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>{developer?.company_name_ar ?? '—'}</Td>
                      <Td>
                        <span className="font-mono text-xs">{c.voucher_number_text ?? '—'}</span>
                      </Td>
                      <Td>
                        <span className="font-mono">{fmtSar(c.amount_sar)}</span>
                      </Td>
                      <Td>{fmtDateTime(c.signed_at)}</Td>
                      <Td>{signer}</Td>
                      <Td>
                        <Link
                          href={`/app/disbursements/${c.id}/delivery-document`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-teal-200 bg-white text-teal-700 text-xs font-semibold hover:bg-teal-50 transition"
                        >
                          <Download className="w-3.5 h-3.5" aria-hidden="true" />
                          تنزيل
                        </Link>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 text-sm text-slate-700 align-top">{children}</td>
}
