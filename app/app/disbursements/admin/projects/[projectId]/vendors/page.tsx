/**
 * الموردون ومقدمو الخدمات — per-project vendor directory.
 *
 * Read gate: any dsb_role that can view the project
 * (owner / supervisor / employee / viewer / deliverer). Scoped users must be
 * assigned to the project; otherwise notFound() so the URL is opaque.
 *
 * The list is server-rendered. Editing / adding is done via inline client
 * components; delete buttons are shown to owners only.
 */
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { assignedProjectIds, canAccessProject } from '@/lib/dsb/access'
import { ArrowRight, Briefcase, Plus } from 'lucide-react'
import { AddVendorForm } from './AddVendorForm'
import { EditVendorRow } from './EditVendorRow'
import { VendorContractsList } from './VendorContractsList'
import { DeleteRowButton } from '../_shared/DeleteRowButton'
import { deleteVendor } from './actions'

export const dynamic = 'force-dynamic'

export type VendorRow = {
  id: string
  name_ar: string
  service_category: string | null
  tax_number: string | null
  commercial_registration: string | null
  phone: string | null
  email: string | null
  iban: string | null
  references_text: string | null
  contact_person_name: string | null
  contact_person_phone: string | null
  notes: string | null
}

export type VendorContractRow = {
  id: string
  vendor_id: string
  contract_number: string | null
  work_type: string | null
  start_date: string | null
  end_date: string | null
  total_amount_sar: number | null
  status: string
  storage_bucket: string | null
  storage_path: string | null
  filename: string | null
  file_size_bytes: number | null
  notes: string | null
}

export default async function ProjectVendorsPage({
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
  if (
    !dsbRole ||
    !['employee', 'supervisor', 'owner', 'viewer', 'deliverer'].includes(dsbRole)
  ) {
    redirect('/app/disbursements')
  }

  const tenantId = profile.tenant_id as string
  const projectId = params.projectId

  const { data: projectData } = await svc
    .from('dsb_projects')
    .select('id, tenant_id, code, name_ar')
    .eq('id', projectId)
    .maybeSingle()
  if (!projectData || (projectData as { tenant_id: string }).tenant_id !== tenantId) {
    notFound()
  }
  const project = projectData as { id: string; code: string; name_ar: string }

  // Scoped users must be assigned; otherwise 404 (URL stays opaque).
  const allowed = await assignedProjectIds({
    svc,
    tenantId,
    userId: profile.id as string,
    dsbRole,
  })
  if (!canAccessProject(allowed, projectId)) {
    notFound()
  }

  // Vendors for this project.
  const { data: vendorsData } = await svc
    .from('dsb_vendors')
    .select(
      'id, name_ar, service_category, tax_number, commercial_registration, phone, email, iban, references_text, contact_person_name, contact_person_phone, notes',
    )
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .order('name_ar', { ascending: true })
  const vendors = (vendorsData ?? []) as VendorRow[]

  // Contracts for those vendors (one round-trip, then bucket client-side).
  const vendorIds = vendors.map((v) => v.id)
  const contractsByVendorId = new Map<string, VendorContractRow[]>()
  if (vendorIds.length > 0) {
    const { data: contractsData } = await svc
      .from('dsb_vendor_contracts')
      .select(
        'id, vendor_id, contract_number, work_type, start_date, end_date, total_amount_sar, status, storage_bucket, storage_path, filename, file_size_bytes, notes',
      )
      .eq('tenant_id', tenantId)
      .in('vendor_id', vendorIds)
      .order('start_date', { ascending: false, nullsFirst: false })
    for (const c of (contractsData ?? []) as VendorContractRow[]) {
      const arr = contractsByVendorId.get(c.vendor_id) ?? []
      arr.push(c)
      contractsByVendorId.set(c.vendor_id, arr)
    }
  }

  const canOwner = dsbRole === 'owner'
  const canWrite = ['employee', 'supervisor', 'owner'].includes(dsbRole)

  return (
    <div className="max-w-6xl mx-auto space-y-6" dir="rtl">
      <Link
        href={`/app/disbursements/admin/projects/${projectId}`}
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        العودة إلى المشروع
      </Link>

      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-700">
          <Briefcase className="w-4 h-4" aria-hidden="true" />
          الموردون ومقدمو الخدمات
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
            {project.name_ar}
          </h1>
          <span className="font-mono text-sm text-slate-500">{project.code}</span>
          <span className="text-sm text-slate-400 font-mono">({vendors.length})</span>
        </div>
        <p className="text-sm text-slate-600">
          دليل الشركات والمقاولين ومقدمي الخدمات العاملين في هذا المشروع، مع
          العقود المرفقة (PDF) لكل مورد.
        </p>
      </header>

      {/* Add vendor — collapsible client form. */}
      {canWrite && <AddVendorForm projectId={projectId} />}

      {vendors.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500 shadow-sm">
          {canWrite
            ? 'لم يُضَف موردون لهذا المشروع بعد. ابدأ بإضافة أول مورد أعلاه.'
            : 'لا يوجد موردون لعرضهم في هذا المشروع.'}
        </div>
      ) : (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-right">
                  <Th>الاسم</Th>
                  <Th>فئة الخدمة</Th>
                  <Th>جوال</Th>
                  <Th>إيميل</Th>
                  <Th># العقود</Th>
                  <Th>الإجراءات</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vendors.map((v) => {
                  const contracts = contractsByVendorId.get(v.id) ?? []
                  return (
                    <tr key={v.id} className="align-top hover:bg-slate-50/70">
                      <Td>
                        <EditVendorRow
                          vendor={v}
                          canEdit={canWrite}
                          renderView={() => (
                            <div className="leading-tight">
                              <div className="font-semibold text-slate-900">{v.name_ar}</div>
                              {(v.contact_person_name || v.contact_person_phone) && (
                                <div className="text-[11px] text-slate-500 mt-0.5">
                                  {v.contact_person_name}
                                  {v.contact_person_name && v.contact_person_phone && ' · '}
                                  {v.contact_person_phone && (
                                    <span className="font-mono" dir="ltr">
                                      {v.contact_person_phone}
                                    </span>
                                  )}
                                </div>
                              )}
                              {(v.tax_number || v.commercial_registration) && (
                                <div className="text-[10px] text-slate-500 mt-0.5 flex flex-wrap gap-x-1.5">
                                  {v.tax_number && (
                                    <span>
                                      ض.: <span className="font-mono" dir="ltr">{v.tax_number}</span>
                                    </span>
                                  )}
                                  {v.commercial_registration && (
                                    <span>
                                      س.ت: <span className="font-mono" dir="ltr">{v.commercial_registration}</span>
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        />
                      </Td>
                      <Td>{v.service_category ?? '—'}</Td>
                      <Td>
                        {v.phone ? (
                          <span className="font-mono text-xs" dir="ltr">{v.phone}</span>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>
                        {v.email ? (
                          <span className="font-mono text-xs" dir="ltr">{v.email}</span>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-slate-100 text-slate-700">
                          {contracts.length}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <VendorContractsList
                            vendorId={v.id}
                            vendorName={v.name_ar}
                            initialContracts={contracts}
                            canEdit={canWrite}
                            canDelete={canOwner}
                          />
                          {canOwner && (
                            <DeleteRowButton
                              id={v.id}
                              itemLabel={v.name_ar}
                              action={deleteVendor}
                            />
                          )}
                        </div>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {canWrite && vendors.length > 0 && (
        <div className="text-[11px] text-slate-400 text-center">
          <span className="inline-flex items-center gap-1">
            <Plus className="w-3 h-3" aria-hidden="true" />
            استخدم زر «إضافة مورد» أعلى الصفحة لتسجيل مورد جديد.
          </span>
        </div>
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  )
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2.5 text-sm text-slate-700 align-top">{children}</td>
}
