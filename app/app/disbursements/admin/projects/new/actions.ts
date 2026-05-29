'use server'

import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

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

export interface CreateProjectInput {
  code: string
  name_ar: string
  assigned_employee_id?: string | null
  notes?: string | null
}

export type CreateProjectResult =
  | { ok: true; project_id: string }
  | { ok: false; error: string }

export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
  const caller = await resolveStaff()
  if ('error' in caller) return { ok: false, error: caller.error }

  const code = input.code?.trim() ?? ''
  const nameAr = input.name_ar?.trim() ?? ''
  const assignedId = input.assigned_employee_id?.trim() || null
  const notes = input.notes?.trim() || null

  if (!code) return { ok: false, error: 'رمز المشروع مطلوب.' }
  if (!nameAr) return { ok: false, error: 'اسم المشروع مطلوب.' }

  const svc = createSupabaseService()

  // If an assigned employee is provided, verify they belong to this tenant.
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

  const { data: row, error } = await svc
    .from('dsb_projects')
    .insert({
      tenant_id: caller.tenantId,
      code,
      name_ar: nameAr,
      assigned_employee_id: assignedId,
      notes,
      status: 'active',
    })
    .select('id')
    .single()
  if (error || !row) {
    console.error('[dsb.createProject] insert failed', error)
    return { ok: false, error: error?.message ?? 'فشل إنشاء المشروع.' }
  }

  return { ok: true, project_id: row.id as string }
}
