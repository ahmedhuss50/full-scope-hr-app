'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

// ----------------------------------------------------------------------------
// Owner-only DELETE actions for the Document Review module.
//
// Scope: cascading deletes for client / project / case, plus a "remove staff
// from the module" delete for employees. All actions:
//   - Require caller's dsb_role === 'owner'
//   - Scope to the caller's tenant_id
//   - Cascade through related tables in dependency order (so FKs are happy
//     even where ON DELETE CASCADE isn't set on the schema).
//
// PDFs in Supabase Storage are NOT removed here — the SQL layer can't reach
// the Storage API. Orphaned objects can be swept later from the bucket UI.
// ----------------------------------------------------------------------------

type DsbRole = 'employee' | 'supervisor' | 'owner'

async function resolveOwner(): Promise<
  | { tenantId: string; userId: string }
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
  const role = (profile.dsb_role as DsbRole | null) ?? null
  if (role !== 'owner') return { error: 'الحذف متاح للمدير فقط.' }
  return {
    tenantId: profile.tenant_id as string,
    userId: profile.id as string,
  }
}

/**
 * Cascade-delete a single case and everything that hangs off it:
 *   audit log, notes, checklist responses, breakdown items, uploads,
 *   upload tokens. The case row itself is deleted last.
 * Storage objects are NOT removed (clean up the bucket separately).
 */
async function cascadeDeleteCases(
  svc: ReturnType<typeof createSupabaseService>,
  tenantId: string,
  caseIds: string[],
): Promise<void> {
  if (caseIds.length === 0) return

  await svc.from('dsb_audit_log').delete().eq('tenant_id', tenantId).in('case_id', caseIds)
  await svc.from('dsb_notes').delete().eq('tenant_id', tenantId).in('case_id', caseIds)
  await svc.from('dsb_case_checklist_responses').delete().eq('tenant_id', tenantId).in('case_id', caseIds)
  await svc.from('dsb_breakdown_items').delete().eq('tenant_id', tenantId).in('case_id', caseIds)
  await svc.from('dsb_uploads').delete().eq('tenant_id', tenantId).in('case_id', caseIds)
  await svc.from('dsb_upload_tokens').delete().eq('tenant_id', tenantId).in('case_id', caseIds)
  await svc.from('dsb_cases').delete().eq('tenant_id', tenantId).in('id', caseIds)
}

// ---------------------------------------------------------------------------
// Delete a single case + its children.
// ---------------------------------------------------------------------------

export async function deleteCase(
  input: { case_id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!input.case_id) return { ok: false, error: 'بيانات ناقصة.' }

  const svc = createSupabaseService()
  const { data: kase } = await svc
    .from('dsb_cases')
    .select('id, tenant_id')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.case_id)
    .maybeSingle()
  if (!kase) return { ok: false, error: 'الطلب غير موجود.' }

  try {
    await cascadeDeleteCases(svc, caller.tenantId, [input.case_id])
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشل الحذف.'
    return { ok: false, error: message }
  }

  revalidatePath('/app/disbursements')
  revalidatePath('/app/disbursements/board')
  revalidatePath('/app/disbursements/documents')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Delete a project + all its cases (and their children).
// ---------------------------------------------------------------------------

export async function deleteProject(
  input: { project_id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!input.project_id) return { ok: false, error: 'بيانات ناقصة.' }

  const svc = createSupabaseService()
  const { data: project } = await svc
    .from('dsb_projects')
    .select('id, tenant_id')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.project_id)
    .maybeSingle()
  if (!project) return { ok: false, error: 'المشروع غير موجود.' }

  // Collect all case IDs for the project so we can cascade-delete them.
  const { data: caseRows } = await svc
    .from('dsb_cases')
    .select('id')
    .eq('tenant_id', caller.tenantId)
    .eq('project_id', input.project_id)
  const caseIds = ((caseRows ?? []) as { id: string }[]).map((r) => r.id)

  try {
    await cascadeDeleteCases(svc, caller.tenantId, caseIds)
    const { error } = await svc
      .from('dsb_projects')
      .delete()
      .eq('tenant_id', caller.tenantId)
      .eq('id', input.project_id)
    if (error) throw new Error(error.message)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشل الحذف.'
    return { ok: false, error: message }
  }

  revalidatePath('/app/disbursements/admin')
  revalidatePath('/app/disbursements/board')
  revalidatePath('/app/disbursements')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Delete a client (dsb_developer) + all its projects + their cases.
// ---------------------------------------------------------------------------

export async function deleteClient(
  input: { client_id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!input.client_id) return { ok: false, error: 'بيانات ناقصة.' }

  const svc = createSupabaseService()
  const { data: client } = await svc
    .from('dsb_developers')
    .select('id, tenant_id')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.client_id)
    .maybeSingle()
  if (!client) return { ok: false, error: 'العميل غير موجود.' }

  // Find all projects under this client.
  const { data: projectRows } = await svc
    .from('dsb_projects')
    .select('id')
    .eq('tenant_id', caller.tenantId)
    .eq('developer_id', input.client_id)
  const projectIds = ((projectRows ?? []) as { id: string }[]).map((r) => r.id)

  // Find all cases under this client (covers cases under those projects AND
  // any cases that might point directly at the developer_id without a project,
  // since the schema allows that).
  const { data: caseRows } = await svc
    .from('dsb_cases')
    .select('id')
    .eq('tenant_id', caller.tenantId)
    .eq('developer_id', input.client_id)
  const caseIds = ((caseRows ?? []) as { id: string }[]).map((r) => r.id)

  try {
    await cascadeDeleteCases(svc, caller.tenantId, caseIds)
    if (projectIds.length > 0) {
      const { error: projErr } = await svc
        .from('dsb_projects')
        .delete()
        .eq('tenant_id', caller.tenantId)
        .in('id', projectIds)
      if (projErr) throw new Error(projErr.message)
    }
    const { error } = await svc
      .from('dsb_developers')
      .delete()
      .eq('tenant_id', caller.tenantId)
      .eq('id', input.client_id)
    if (error) throw new Error(error.message)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشل الحذف.'
    return { ok: false, error: message }
  }

  revalidatePath('/app/disbursements/admin')
  revalidatePath('/app/disbursements/board')
  revalidatePath('/app/disbursements')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Remove an employee from the module.
//
// Behavior:
//   - Null out assigned_employee_id on any projects pointing at them so the
//     projects survive (they just lose their assignee, ready to be reassigned).
//   - Delete the row from public.users.
//   - DO NOT touch auth.users — that's controlled centrally and we don't want
//     to break their other access (if any).
//   - Self-protection: caller cannot delete themselves (avoids accidental
//     account lockout). To remove yourself, ask another owner.
// ---------------------------------------------------------------------------

export async function deleteEmployee(
  input: { user_id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }
  if (!input.user_id) return { ok: false, error: 'بيانات ناقصة.' }
  if (input.user_id === caller.userId) {
    return { ok: false, error: 'لا يمكنك حذف حسابك الخاص.' }
  }

  const svc = createSupabaseService()
  const { data: target } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('tenant_id', caller.tenantId)
    .eq('id', input.user_id)
    .maybeSingle()
  if (!target) return { ok: false, error: 'الموظف غير موجود.' }

  try {
    // Null out every FK pointing at this user before removing the row.
    // Otherwise Postgres rejects the DELETE with a constraint violation.
    //
    // 1) Projects: assigned_employee_id → projects survive, just unassigned.
    const { error: unassignErr } = await svc
      .from('dsb_projects')
      .update({ assigned_employee_id: null })
      .eq('tenant_id', caller.tenantId)
      .eq('assigned_employee_id', input.user_id)
    if (unassignErr) throw new Error(unassignErr.message)

    // 2) Developers (clients): user_id link, set when a client signs in.
    //    Nulling this leaves the client record intact but disconnects their
    //    login. They can be re-linked later by issuing a fresh portal invite.
    const { error: devUnlinkErr } = await svc
      .from('dsb_developers')
      .update({ user_id: null })
      .eq('tenant_id', caller.tenantId)
      .eq('user_id', input.user_id)
    if (devUnlinkErr) throw new Error(devUnlinkErr.message)

    // 3) Signed-by audit trail on cases. Cases that this user personally
    //    signed get their signer pointer nulled so the case row survives.
    //    signed_at + status are preserved so the audit history stays intact.
    const { error: signedByErr } = await svc
      .from('dsb_cases')
      .update({ signed_by_user_id: null })
      .eq('tenant_id', caller.tenantId)
      .eq('signed_by_user_id', input.user_id)
    if (signedByErr) throw new Error(signedByErr.message)

    // 4) Audit log actor_user_id. Same treatment — preserve the events,
    //    just disconnect the actor pointer.
    const { error: auditActorErr } = await svc
      .from('dsb_audit_log')
      .update({ actor_user_id: null })
      .eq('tenant_id', caller.tenantId)
      .eq('actor_user_id', input.user_id)
    if (auditActorErr) throw new Error(auditActorErr.message)

    const { error } = await svc
      .from('users')
      .delete()
      .eq('tenant_id', caller.tenantId)
      .eq('id', input.user_id)
    if (error) throw new Error(error.message)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشل الحذف.'
    return { ok: false, error: message }
  }

  revalidatePath('/app/disbursements/admin')
  return { ok: true }
}
