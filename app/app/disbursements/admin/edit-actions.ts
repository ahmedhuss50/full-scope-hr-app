'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { assignedProjectIds, canAccessProject } from '@/lib/dsb/access'

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
// changeEmployeeRole — owner-only. Promote / demote any staff member among
// the three staff roles (employee / supervisor / owner).
//
// Safety rails:
//   - Caller must be an owner.
//   - Caller cannot change their own role (avoids accidental self-lockout).
//   - We refuse to demote the LAST owner — otherwise nobody could ever
//     re-promote anyone. There must always be at least one owner per tenant.
//   - Target user must belong to the same tenant.
// ---------------------------------------------------------------------------

type StaffOnlyRole = 'employee' | 'supervisor' | 'owner' | 'viewer' | 'deliverer'

export interface ChangeEmployeeRoleInput {
  user_id: string
  new_role: StaffOnlyRole
}

export async function changeEmployeeRole(
  input: ChangeEmployeeRoleInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveStaff()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (caller.dsbRole !== 'owner') {
    return { ok: false, error: 'تغيير الأدوار متاح للمدير فقط.' }
  }
  if (!input.user_id) return { ok: false, error: 'بيانات ناقصة.' }
  if (input.user_id === caller.userId) {
    return { ok: false, error: 'لا يمكنك تغيير دورك الخاص.' }
  }
  if (!['employee', 'supervisor', 'owner', 'viewer', 'deliverer'].includes(input.new_role)) {
    return { ok: false, error: 'دور غير صالح.' }
  }

  const svc = createSupabaseService()
  const { data: target } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.user_id)
    .maybeSingle()
  if (!target) return { ok: false, error: 'الموظف غير موجود.' }
  const currentRole = (target.dsb_role as StaffOnlyRole | null) ?? null
  if (currentRole === input.new_role) {
    return { ok: false, error: 'الدور الحالي مطابق للدور الجديد.' }
  }

  // Don't allow demoting the last owner in the tenant — otherwise nobody can
  // re-promote anyone afterwards.
  if (currentRole === 'owner' && input.new_role !== 'owner') {
    const { count } = await svc
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', caller.tenantId)
      .eq('dsb_role', 'owner')
    if ((count ?? 0) <= 1) {
      return { ok: false, error: 'لا يمكن تغيير دور آخر مدير في النظام.' }
    }
  }

  const { error } = await svc
    .from('users')
    .update({ dsb_role: input.new_role })
    .eq('id', input.user_id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin')
  return { ok: true }
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
  // Payer-side banking — what bank the developer pays FROM. Null clears.
  bank_name?: string | null
  bank_account?: string | null
  bank_iban?: string | null
  // Which named checklist template this client uses by default. null = fall
  // back to the tenant's default template. undefined = leave alone.
  checklist_template_id?: string | null
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

  // Validate the picked template belongs to the same tenant. undefined = no
  // change; null = explicit clear (fall back to tenant default).
  let templatePatch: { checklist_template_id: string | null } | Record<string, never> = {}
  if (input.checklist_template_id !== undefined) {
    const tplId = input.checklist_template_id
    if (tplId !== null) {
      const { data: tpl } = await svc
        .from('dsb_checklist_templates')
        .select('id, tenant_id')
        .eq('id', tplId)
        .maybeSingle()
      if (!tpl || (tpl as { tenant_id: string }).tenant_id !== caller.tenantId) {
        return { ok: false, error: 'القائمة المختارة غير صحيحة.' }
      }
    }
    templatePatch = { checklist_template_id: tplId }
  }

  const { error } = await svc
    .from('dsb_developers')
    .update({
      company_name_ar: companyName,
      contact_name: (input.contact_name ?? '').trim() || null,
      contact_email: contactEmail,
      notes: (input.notes ?? '').trim() || null,
      bank_name: (input.bank_name ?? '').trim() || null,
      bank_account: (input.bank_account ?? '').trim() || null,
      bank_iban: (input.bank_iban ?? '').trim().toUpperCase() || null,
      ...(input.status ? { status: input.status } : {}),
      ...templatePatch,
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
  // Project-level bank (حساب المشروع / حساب الضمان).
  bank_name?: string | null
  bank_account?: string | null
  bank_iban?: string | null
  // Which named checklist template this project uses. null = fall back to
  // the client's template, then to the tenant default. undefined = leave alone.
  checklist_template_id?: string | null
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

  // Validate the picked template belongs to the same tenant. undefined = no
  // change; null = explicit clear (fall back to client/tenant default).
  let templatePatch: { checklist_template_id: string | null } | Record<string, never> = {}
  if (input.checklist_template_id !== undefined) {
    const tplId = input.checklist_template_id
    if (tplId !== null) {
      const { data: tpl } = await svc
        .from('dsb_checklist_templates')
        .select('id, tenant_id')
        .eq('id', tplId)
        .maybeSingle()
      if (!tpl || (tpl as { tenant_id: string }).tenant_id !== caller.tenantId) {
        return { ok: false, error: 'القائمة المختارة غير صحيحة.' }
      }
    }
    templatePatch = { checklist_template_id: tplId }
  }

  const { error } = await svc
    .from('dsb_projects')
    .update({
      code,
      name_ar: nameAr,
      developer_id: developerId,
      assigned_employee_id: assignedId,
      notes: (input.notes ?? '').trim() || null,
      bank_name: (input.bank_name ?? '').trim() || null,
      bank_account: (input.bank_account ?? '').trim() || null,
      bank_iban: (input.bank_iban ?? '').trim().toUpperCase() || null,
      ...(input.status ? { status: input.status } : {}),
      ...templatePatch,
    })
    .eq('id', input.project_id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${input.project_id}`)
  revalidatePath('/app/disbursements/admin')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Project payment accounts
// ---------------------------------------------------------------------------
//
// Each project owns a list of payment accounts that disbursements come out
// of. When a case is delivered, the owner/staff record which of these
// accounts the money came from.
//
// Auth model (Aug 2026 — task #185):
//   - ADD (single + bulk) → any staff role, but ONLY for projects the caller
//     is assigned to. Owners see every project so they're unrestricted.
//   - UPDATE + DELETE     → owner-only (kept in `resolveOwner`). Rationale:
//     editing an account can silently retarget every historical case that
//     references it, so we keep it a manager decision.
// ---------------------------------------------------------------------------

async function resolveOwner(): Promise<
  | { tenantId: string; userId: string }
  | { error: string }
> {
  const caller = await resolveStaff()
  if ('error' in caller) return { error: caller.error }
  if (caller.dsbRole !== 'owner') {
    return { error: 'هذا الإجراء متاح للمدير فقط.' }
  }
  return { tenantId: caller.tenantId, userId: caller.userId }
}

/**
 * Resolve caller and confirm they can act on `projectId`.
 *   - owner → always allowed (bypasses the assigned-project lookup)
 *   - supervisor / employee → must have the project in their assignments
 *   - viewer / deliverer / anything else → rejected (read-only roles can't
 *     add accounts even for projects they can see)
 * Used by the add + bulk-add flows below.
 */
async function resolveStaffOnProject(
  projectId: string,
): Promise<
  | { tenantId: string; userId: string; dsbRole: StaffRole }
  | { error: string }
> {
  const caller = await resolveStaff()
  if ('error' in caller) return { error: caller.error }
  if (!['employee', 'supervisor', 'owner'].includes(caller.dsbRole)) {
    return { error: 'لا تملك صلاحية الإضافة.' }
  }
  if (caller.dsbRole !== 'owner') {
    const svc = createSupabaseService()
    const allowed = await assignedProjectIds({
      svc,
      tenantId: caller.tenantId,
      userId: caller.userId,
      dsbRole: caller.dsbRole,
    })
    if (!canAccessProject(allowed, projectId)) {
      return { error: 'ليست لديك صلاحية على هذا المشروع.' }
    }
  }
  return caller
}

async function ensureProjectInTenant(
  svc: ReturnType<typeof createSupabaseService>,
  tenantId: string,
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: project } = await svc
    .from('dsb_projects')
    .select('id, tenant_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project || (project as { tenant_id: string }).tenant_id !== tenantId) {
    return { ok: false, error: 'المشروع غير موجود.' }
  }
  return { ok: true }
}

// Migration 063: `account_role` picks which of the four escrow-mandated
// slots this account fills (general / construction / admin_marketing /
// escrow). NULL means "ordinary account, no role" — the majority of rows.
// Only accounts flagged 'general' trigger the buyer-deposit split.
const ALLOWED_ACCOUNT_ROLES = ['general', 'construction', 'admin_marketing', 'escrow'] as const
export type AccountRole = (typeof ALLOWED_ACCOUNT_ROLES)[number]

function normalizeAccountRole(v: string | null | undefined): AccountRole | null | { error: string } {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  if (s === '') return null
  if (!(ALLOWED_ACCOUNT_ROLES as readonly string[]).includes(s)) {
    return { error: 'دور الحساب غير معتمد.' }
  }
  return s as AccountRole
}

export interface AddProjectAccountInput {
  project_id: string
  label: string
  account_number?: string | null
  bank_name?: string | null
  iban?: string | null
  account_role?: AccountRole | null
}

export async function addProjectAccount(
  input: AddProjectAccountInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const projectId = (input.project_id ?? '').trim()
  const label = (input.label ?? '').trim()
  if (!projectId) return { ok: false, error: 'المشروع مطلوب.' }
  if (!label) return { ok: false, error: 'اسم الحساب مطلوب.' }
  // Open to any staff member assigned to the target project (task #185).
  const caller = await resolveStaffOnProject(projectId)
  if ('error' in caller) return { ok: false, error: caller.error }

  const svc = createSupabaseService()
  const check = await ensureProjectInTenant(svc, caller.tenantId, projectId)
  if (!check.ok) return check

  const roleParsed = normalizeAccountRole(input.account_role ?? null)
  if (typeof roleParsed === 'object' && roleParsed !== null && 'error' in roleParsed) {
    return { ok: false, error: roleParsed.error }
  }

  const { data, error } = await svc
    .from('dsb_project_accounts')
    .insert({
      tenant_id: caller.tenantId,
      project_id: projectId,
      label,
      account_number: (input.account_number ?? '').trim() || null,
      bank_name: (input.bank_name ?? '').trim() || null,
      iban: (input.iban ?? '').trim().toUpperCase() || null,
      account_role: roleParsed as AccountRole | null,
      created_by_user_id: caller.userId,
    })
    .select('id')
    .single()
  if (error || !data) {
    return { ok: false, error: error?.message ?? 'تعذّر إضافة الحساب.' }
  }

  revalidatePath(`/app/disbursements/admin/projects/${projectId}`)
  return { ok: true, id: data.id as string }
}

export interface DeleteProjectAccountInput {
  id: string
}

export async function deleteProjectAccount(
  input: DeleteProjectAccountInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }
  const id = (input.id ?? '').trim()
  if (!id) return { ok: false, error: 'بيانات ناقصة.' }

  const svc = createSupabaseService()
  // Look up the account to confirm tenant ownership AND to know which
  // project page to revalidate.
  const { data: account } = await svc
    .from('dsb_project_accounts')
    .select('id, tenant_id, project_id')
    .eq('id', id)
    .maybeSingle()
  if (!account || (account as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'الحساب غير موجود.' }
  }

  // The FK on dsb_cases.paid_from_account_id is ON DELETE SET NULL, so any
  // cases that referenced this account simply lose the back-reference.
  const { error } = await svc
    .from('dsb_project_accounts')
    .delete()
    .eq('id', id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${(account as { project_id: string }).project_id}`)
  revalidatePath('/app/disbursements/admin/accounts')
  return { ok: true }
}

// ----------------------------------------------------------------------------
// updateProjectAccount — owner only. Lets the owner re-assign an account to
// a different project (changing the client by extension, since the project
// belongs to a developer), or tweak its label / number / bank / iban. Used
// by the tenant-wide accounts list at /admin/accounts.
//
// Note: if the project changes, any cases that currently reference this
// account via dsb_cases.paid_from_account_id will still reference it — they
// just become "this case was paid out of an account that's now associated
// with a different project." We don't try to migrate paid_from_account_id;
// the owner is editing the account's true metadata.
// ----------------------------------------------------------------------------

export interface UpdateProjectAccountInput {
  id: string
  // Any subset of these can be sent. undefined = leave alone. null on the
  // text fields = clear. project_id is required-on-send (can't be cleared).
  project_id?: string
  label?: string
  account_number?: string | null
  bank_name?: string | null
  iban?: string | null
  // Migration 063 — see AccountRole. `null` clears the role.
  account_role?: AccountRole | null
}

export async function updateProjectAccount(
  input: UpdateProjectAccountInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }
  const id = (input.id ?? '').trim()
  if (!id) return { ok: false, error: 'بيانات ناقصة.' }

  const svc = createSupabaseService()
  const { data: existing } = await svc
    .from('dsb_project_accounts')
    .select('id, tenant_id, project_id')
    .eq('id', id)
    .maybeSingle()
  if (!existing || (existing as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'الحساب غير موجود.' }
  }
  const oldProjectId = (existing as { project_id: string }).project_id

  // Build the patch, validating each field as we go.
  const patch: Record<string, string | null> = {}
  if (input.project_id !== undefined) {
    const newProjectId = input.project_id.trim()
    if (!newProjectId) return { ok: false, error: 'المشروع مطلوب.' }
    // Validate the new project belongs to the same tenant.
    const { data: proj } = await svc
      .from('dsb_projects')
      .select('id, tenant_id')
      .eq('id', newProjectId)
      .maybeSingle()
    if (!proj || (proj as { tenant_id: string }).tenant_id !== caller.tenantId) {
      return { ok: false, error: 'المشروع المختار لا ينتمي لمؤسستك.' }
    }
    patch.project_id = newProjectId
  }
  if (input.label !== undefined) {
    const v = input.label.trim()
    if (!v) return { ok: false, error: 'اسم الحساب مطلوب.' }
    patch.label = v
  }
  if (input.account_number !== undefined) {
    patch.account_number = (input.account_number ?? '').trim() || null
  }
  if (input.bank_name !== undefined) {
    patch.bank_name = (input.bank_name ?? '').trim() || null
  }
  if (input.iban !== undefined) {
    patch.iban = (input.iban ?? '').trim().toUpperCase() || null
  }
  if (input.account_role !== undefined) {
    const roleParsed = normalizeAccountRole(input.account_role)
    if (typeof roleParsed === 'object' && roleParsed !== null && 'error' in roleParsed) {
      return { ok: false, error: roleParsed.error }
    }
    patch.account_role = roleParsed as AccountRole | null
  }
  if (Object.keys(patch).length === 0) return { ok: true } // nothing to do

  const { error } = await svc
    .from('dsb_project_accounts')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/accounts')
  revalidatePath(`/app/disbursements/admin/projects/${oldProjectId}`)
  if (patch.project_id && patch.project_id !== oldProjectId) {
    revalidatePath(`/app/disbursements/admin/projects/${patch.project_id}`)
  }
  return { ok: true }
}

export interface BulkUploadProjectAccountsInput {
  project_id: string
  accounts: Array<{
    label: string
    account_number?: string | null
    bank_name?: string | null
    iban?: string | null
  }>
}

export async function bulkUploadProjectAccounts(
  input: BulkUploadProjectAccountsInput,
): Promise<{ ok: true; inserted: number } | { ok: false; error: string }> {
  const projectId = (input.project_id ?? '').trim()
  if (!projectId) return { ok: false, error: 'المشروع مطلوب.' }
  if (!Array.isArray(input.accounts) || input.accounts.length === 0) {
    return { ok: false, error: 'لا توجد صفوف للرفع.' }
  }
  // Open to any staff member assigned to the target project (task #185).
  const caller = await resolveStaffOnProject(projectId)
  if ('error' in caller) return { ok: false, error: caller.error }

  const svc = createSupabaseService()
  const check = await ensureProjectInTenant(svc, caller.tenantId, projectId)
  if (!check.ok) return check

  // Skip blank-label rows defensively — the client also filters, but we
  // don't trust client input.
  const rows = input.accounts
    .map((r) => ({
      label: (r.label ?? '').trim(),
      account_number: (r.account_number ?? '').trim() || null,
      bank_name: (r.bank_name ?? '').trim() || null,
      iban: (r.iban ?? '').trim().toUpperCase() || null,
    }))
    .filter((r) => r.label.length > 0)
    .map((r) => ({
      tenant_id: caller.tenantId,
      project_id: projectId,
      created_by_user_id: caller.userId,
      ...r,
    }))

  if (rows.length === 0) {
    return { ok: false, error: 'جميع الصفوف فارغة (اسم الحساب مطلوب).' }
  }

  const { error } = await svc
    .from('dsb_project_accounts')
    .insert(rows)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${projectId}`)
  return { ok: true, inserted: rows.length }
}

// ---------------------------------------------------------------------------
// setCasePaidFromAccount — write roles + deliverer.
//
// This is the ONE action in this file that isn't owner-only. Setting which
// account a delivery came out of is a delivery-time bookkeeping operation,
// same permission surface as the archive edits (employee / supervisor /
// owner / deliverer).
// ---------------------------------------------------------------------------

const PAID_FROM_EDIT_ROLES = ['employee', 'supervisor', 'owner', 'deliverer'] as const

export interface SetCasePaidFromAccountInput {
  case_id: string
  account_id: string | null
}

export async function setCasePaidFromAccount(
  input: SetCasePaidFromAccountInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Inline resolver — resolveStaff() only accepts write roles, but this
  // action is also open to the deliverer role.
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, error: 'لم يتم تسجيل الدخول.' }
  const svc0 = createSupabaseService()
  const { data: profile } = await svc0
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) return { ok: false, error: 'حسابك غير مرتبط بمستأجر.' }
  const role = (profile.dsb_role as string | null) ?? null
  if (!role || !(PAID_FROM_EDIT_ROLES as readonly string[]).includes(role)) {
    return { ok: false, error: 'لا تملك صلاحية.' }
  }
  const caller = {
    tenantId: profile.tenant_id as string,
    userId: profile.id as string,
  }
  const caseId = (input.case_id ?? '').trim()
  if (!caseId) return { ok: false, error: 'بيانات ناقصة.' }

  const svc = createSupabaseService()
  // Fetch the case so we know its project_id (needed to validate that the
  // chosen account belongs to the same project).
  const { data: kase } = await svc
    .from('dsb_cases')
    .select('id, tenant_id, project_id, paid_from_account_id')
    .eq('id', caseId)
    .maybeSingle()
  if (!kase || (kase as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'الطلب غير موجود.' }
  }

  let newLabel: string | null = null
  if (input.account_id) {
    const { data: account } = await svc
      .from('dsb_project_accounts')
      .select('id, tenant_id, project_id, label')
      .eq('id', input.account_id)
      .maybeSingle()
    if (!account || (account as { tenant_id: string }).tenant_id !== caller.tenantId) {
      return { ok: false, error: 'الحساب غير موجود.' }
    }
    // Defense against tampering: the picked account must belong to the
    // case's project, not some other project the caller can see.
    if ((account as { project_id: string }).project_id !== (kase as { project_id: string }).project_id) {
      return { ok: false, error: 'الحساب المختار لا ينتمي إلى مشروع هذا الطلب.' }
    }
    newLabel = (account as { label: string }).label
  }

  const { error } = await svc
    .from('dsb_cases')
    .update({ paid_from_account_id: input.account_id ?? null })
    .eq('id', caseId)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  await svc.from('dsb_audit_log').insert({
    tenant_id: caller.tenantId,
    case_id: caseId,
    event: 'paid_from_account_set',
    actor_user_id: caller.userId,
    notes: newLabel
      ? `تحديد حساب الدفع: ${newLabel}`
      : 'إزالة حساب الدفع',
    occurred_at: new Date().toISOString(),
  })

  revalidatePath('/app/disbursements/archive')
  revalidatePath(`/app/disbursements/${caseId}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Project ↔ employee junction management (owner-only).
//
// These two actions are the canonical entry points for writing to
// dsb_project_employees. Both follow the same "replace the whole list"
// model — the caller sends the desired final state and we diff against
// what's there. This avoids fiddly add/remove APIs from the client.
//
// We also keep dsb_projects.assigned_employee_id in sync (best-effort) so
// any legacy code paths that still read the single-pointer column continue
// to resolve a sensible value: it becomes "the first assignee" (or the
// sole one, where that's true).
// ---------------------------------------------------------------------------

const STAFF_ROLES_FOR_ASSIGNMENT = ['employee', 'supervisor', 'viewer', 'deliverer'] as const

export interface SetProjectEmployeesInput {
  project_id: string
  user_ids: string[]
}

export async function setProjectEmployees(
  input: SetProjectEmployeesInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }

  const projectId = (input.project_id ?? '').trim()
  if (!projectId) return { ok: false, error: 'بيانات ناقصة.' }

  // De-dupe + drop blanks defensively.
  const userIds = Array.from(
    new Set(
      (input.user_ids ?? [])
        .map((id) => (id ?? '').trim())
        .filter((id) => id.length > 0),
    ),
  )

  const svc = createSupabaseService()

  // Confirm the project belongs to this tenant.
  const { data: project } = await svc
    .from('dsb_projects')
    .select('id, tenant_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project || (project as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'المشروع غير موجود.' }
  }

  // If non-empty, validate every user_id belongs to the same tenant AND
  // carries an internal staff role (employee/supervisor/viewer/deliverer).
  // Owners are excluded from junction rows: they see everything anyway,
  // and tying them to a project would just be confusing.
  if (userIds.length > 0) {
    const { data: usersRows } = await svc
      .from('users')
      .select('id, tenant_id, dsb_role')
      .in('id', userIds)
    const rows = (usersRows ?? []) as { id: string; tenant_id: string; dsb_role: string | null }[]
    if (rows.length !== userIds.length) {
      return { ok: false, error: 'بعض الموظفين المختارين غير موجودين.' }
    }
    for (const r of rows) {
      if (r.tenant_id !== caller.tenantId) {
        return { ok: false, error: 'بعض الموظفين المختارين لا ينتمون لمؤسستك.' }
      }
      // Owners filtered out silently — but if the only thing the caller
      // sent was an owner, reject so they don't think it saved.
      if (r.dsb_role && !(STAFF_ROLES_FOR_ASSIGNMENT as readonly string[]).includes(r.dsb_role)) {
        return { ok: false, error: 'لا يمكن إسناد المدير لمشروع بعينه — المدير يرى كل المشاريع.' }
      }
    }
  }

  // Replace strategy: delete the existing set, insert the new set. We do
  // this in two statements (no transaction available from the JS client),
  // which is fine — both operations are scoped to a single project_id and
  // the worst case on a partial failure is "junction temporarily empty",
  // which the action layer's fallback to assigned_employee_id covers.
  const { error: delErr } = await svc
    .from('dsb_project_employees')
    .delete()
    .eq('project_id', projectId)
    .eq('tenant_id', caller.tenantId)
  if (delErr) return { ok: false, error: delErr.message }

  if (userIds.length > 0) {
    const rows = userIds.map((uid) => ({
      project_id: projectId,
      user_id: uid,
      tenant_id: caller.tenantId,
      added_by_user_id: caller.userId,
    }))
    const { error: insErr } = await svc.from('dsb_project_employees').insert(rows)
    if (insErr) return { ok: false, error: insErr.message }
  }

  // Keep the legacy single-pointer column pointed at the first assignee
  // (or null if cleared). Old code paths that still read it stay sane.
  const primary = userIds[0] ?? null
  const { error: updErr } = await svc
    .from('dsb_projects')
    .update({ assigned_employee_id: primary })
    .eq('id', projectId)
    .eq('tenant_id', caller.tenantId)
  if (updErr) return { ok: false, error: updErr.message }

  // Audit (best-effort; do not block the response on log failures).
  try {
    await svc.from('dsb_audit_log').insert({
      tenant_id: caller.tenantId,
      event: 'project_employees_set',
      actor_user_id: caller.userId,
      notes: `تعيين موظفي المشروع: ${userIds.length} موظف`,
      occurred_at: new Date().toISOString(),
    })
  } catch (e) {
    console.warn('[dsb.setProjectEmployees] audit insert failed', e)
  }

  revalidatePath(`/app/disbursements/admin/projects/${projectId}`)
  revalidatePath('/app/disbursements/admin')
  return { ok: true }
}

export interface SetEmployeeProjectsInput {
  user_id: string
  project_ids: string[]
}

export async function setEmployeeProjects(
  input: SetEmployeeProjectsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }

  const userId = (input.user_id ?? '').trim()
  if (!userId) return { ok: false, error: 'بيانات ناقصة.' }

  const projectIds = Array.from(
    new Set(
      (input.project_ids ?? [])
        .map((id) => (id ?? '').trim())
        .filter((id) => id.length > 0),
    ),
  )

  const svc = createSupabaseService()

  // Confirm the user belongs to this tenant and is a staff role that can
  // be assigned. Owners are not assignable (they see everything).
  const { data: target } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('id', userId)
    .maybeSingle()
  if (!target || (target as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'الموظف غير موجود.' }
  }
  const targetRole = (target as { dsb_role: string | null }).dsb_role
  if (!targetRole || !(STAFF_ROLES_FOR_ASSIGNMENT as readonly string[]).includes(targetRole)) {
    return { ok: false, error: 'لا يمكن إسناد المدير لمشاريع — المدير يرى كل المشاريع.' }
  }

  if (projectIds.length > 0) {
    const { data: projRows } = await svc
      .from('dsb_projects')
      .select('id, tenant_id')
      .in('id', projectIds)
    const rows = (projRows ?? []) as { id: string; tenant_id: string }[]
    if (rows.length !== projectIds.length) {
      return { ok: false, error: 'بعض المشاريع المختارة غير موجودة.' }
    }
    for (const r of rows) {
      if (r.tenant_id !== caller.tenantId) {
        return { ok: false, error: 'بعض المشاريع المختارة لا تنتمي لمؤسستك.' }
      }
    }
  }

  // Replace strategy, scoped to (user_id, tenant_id).
  const { error: delErr } = await svc
    .from('dsb_project_employees')
    .delete()
    .eq('user_id', userId)
    .eq('tenant_id', caller.tenantId)
  if (delErr) return { ok: false, error: delErr.message }

  if (projectIds.length > 0) {
    const rows = projectIds.map((pid) => ({
      project_id: pid,
      user_id: userId,
      tenant_id: caller.tenantId,
      added_by_user_id: caller.userId,
    }))
    const { error: insErr } = await svc.from('dsb_project_employees').insert(rows)
    if (insErr) return { ok: false, error: insErr.message }
  }

  // Keep dsb_projects.assigned_employee_id sensible:
  //   - For each project where this user is now the SOLE assignee, point
  //     the legacy column at this user.
  //   - For each project this user was JUST REMOVED from, if the legacy
  //     column was pointing at them, repoint to whoever's left (or null).
  // This is best-effort; if it fails we still return ok — the junction is
  // the source of truth.
  try {
    if (projectIds.length > 0) {
      // Count assignees per project to spot solo cases.
      const { data: counts } = await svc
        .from('dsb_project_employees')
        .select('project_id, user_id')
        .in('project_id', projectIds)
        .eq('tenant_id', caller.tenantId)
      const byProject = new Map<string, string[]>()
      for (const row of (counts ?? []) as { project_id: string; user_id: string }[]) {
        const arr = byProject.get(row.project_id) ?? []
        arr.push(row.user_id)
        byProject.set(row.project_id, arr)
      }
      for (const [pid, members] of byProject) {
        if (members.length === 1 && members[0] === userId) {
          await svc
            .from('dsb_projects')
            .update({ assigned_employee_id: userId })
            .eq('id', pid)
            .eq('tenant_id', caller.tenantId)
        }
      }
    }

    // Repoint orphan legacy pointers: projects where assigned_employee_id
    // is this user but the user is no longer in the junction.
    const { data: legacyHits } = await svc
      .from('dsb_projects')
      .select('id')
      .eq('tenant_id', caller.tenantId)
      .eq('assigned_employee_id', userId)
    for (const lh of (legacyHits ?? []) as { id: string }[]) {
      // Is the user still in the junction for this project?
      const { data: stillIn } = await svc
        .from('dsb_project_employees')
        .select('user_id')
        .eq('project_id', lh.id)
        .eq('user_id', userId)
        .maybeSingle()
      if (!stillIn) {
        // Pick a replacement: any remaining assignee, else null.
        const { data: anyOther } = await svc
          .from('dsb_project_employees')
          .select('user_id')
          .eq('project_id', lh.id)
          .eq('tenant_id', caller.tenantId)
          .limit(1)
          .maybeSingle()
        await svc
          .from('dsb_projects')
          .update({ assigned_employee_id: (anyOther?.user_id as string | undefined) ?? null })
          .eq('id', lh.id)
          .eq('tenant_id', caller.tenantId)
      }
    }
  } catch (e) {
    console.warn('[dsb.setEmployeeProjects] legacy pointer sync failed', e)
  }

  try {
    await svc.from('dsb_audit_log').insert({
      tenant_id: caller.tenantId,
      event: 'employee_projects_set',
      actor_user_id: caller.userId,
      notes: `تعيين مشاريع الموظف: ${projectIds.length} مشروع`,
      occurred_at: new Date().toISOString(),
    })
  } catch (e) {
    console.warn('[dsb.setEmployeeProjects] audit insert failed', e)
  }

  revalidatePath('/app/disbursements/admin')
  return { ok: true }
}
