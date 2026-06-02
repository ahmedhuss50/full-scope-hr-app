'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

// ----------------------------------------------------------------------------
// Edit actions — open to ALL staff (employee / supervisor / owner).
// Mirrors the auth model for the create-* actions: anyone who can create
// can also edit. Owner-only operations (delete, sign, manage employees)
// stay in their dedicated action files.
// ----------------------------------------------------------------------------

type StaffRole = 'employee' | 'supervisor' | 'owner'

async function resolveStaff(): Promise<
  | { tenantId: string; userId: string; dsbRole: StaffRole }
  | { error: string }
> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: 'لم يتم تسجيل الدخول.' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) return { error: 'حسابك غير مرتبط بمستأجر.' }
  const role = (profile.dsb_role as string | null) ?? null
  if (!role || !['employee', 'supervisor', 'owner'].includes(role)) {
    return { error: 'لا تملك صلاحية.' }
  }
  return {
    tenantId: profile.tenant_id as string,
    userId: profile.id as string,
    dsbRole: role as StaffRole,
  }
}

// ---------------------------------------------------------------------------
// updateClient
// ---------------------------------------------------------------------------

export interface UpdateClientInput {
  client_id: string
  company_name_ar: string
  contact_name?: string | null
  contact_email: string
  notes?: string | null
  status?: 'active' | 'archived' | 'inactive'
}

export async function updateClient(
  input: UpdateClientInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveStaff()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!input.client_id) return { ok: false, error: 'بيانات ناقصة.' }

  const companyName = (input.company_name_ar ?? '').trim()
  const contactEmail = (input.contact_email ?? '').trim().toLowerCase()
  if (!companyName) return { ok: false, error: 'اسم الشركة مطلوب.' }
  if (!contactEmail) return { ok: false, error: 'البريد الإلكتروني مطلوب.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return { ok: false, error: 'صيغة البريد الإلكتروني غير صحيحة.' }
  }

  const svc = createSupabaseService()
  const { error } = await svc
    .from('dsb_developers')
    .update({
      company_name_ar: companyName,
      contact_name: (input.contact_name ?? '').trim() || null,
      contact_email: contactEmail,
      notes: (input.notes ?? '').trim() || null,
      ...(input.status ? { status: input.status } : {}),
    })
    .eq('id', input.client_id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/clients/${input.client_id}`)
  revalidatePath('/app/disbursements/admin')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// updateProject
// ---------------------------------------------------------------------------

export interface UpdateProjectInput {
  project_id: string
  code: string
  name_ar: string
  developer_id: string
  assigned_employee_id?: string | null
  notes?: string | null
  status?: 'active' | 'archived' | 'inactive'
}

export async function updateProject(
  input: UpdateProjectInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveStaff()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!input.project_id) return { ok: false, error: 'بيانات ناقصة.' }

  const code = (input.code ?? '').trim()
  const nameAr = (input.name_ar ?? '').trim()
  const developerId = (input.developer_id ?? '').trim()
  const assignedId = (input.assigned_employee_id ?? '')?.trim() || null
  if (!code) return { ok: false, error: 'رمز المشروع مطلوب.' }
  if (!nameAr) return { ok: false, error: 'اسم المشروع مطلوب.' }
  if (!developerId) return { ok: false, error: 'العميل مطلوب.' }

  const svc = createSupabaseService()

  // Verify developer belongs to caller's tenant.
  const { data: dev } = await svc
    .from('dsb_developers')
    .select('id, tenant_id')
    .eq('id', developerId)
    .maybeSingle()
  if (!dev || dev.tenant_id !== caller.tenantId) {
    return { ok: false, error: 'العميل المختار غير صحيح.' }
  }

  // Verify assignee (if any) belongs to the same tenant.
  if (assignedId) {
    const { data: emp } = await svc
      .from('users')
      .select('id, tenant_id')
      .eq('id', assignedId)
      .maybeSingle()
    if (!emp || emp.tenant_id !== caller.tenantId) {
      return { ok: false, error: 'الموظف المختار غير صحيح.' }
    }
  }

  const { error } = await svc
    .from('dsb_projects')
    .update({
      code,
      name_ar: nameAr,
      developer_id: developerId,
      assigned_employee_id: assignedId,
      notes: (input.notes ?? '').trim() || null,
      ...(input.status ? { status: input.status } : {}),
    })
    .eq('id', input.project_id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${input.project_id}`)
  revalidatePath('/app/disbursements/admin')
  return { ok: true }
}
