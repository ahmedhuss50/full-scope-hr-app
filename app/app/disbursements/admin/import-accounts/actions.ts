'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

// ----------------------------------------------------------------------------
// Tenant-wide bulk import of project payment accounts.
//
// Owner-only. The client parses an Excel file that may contain rows for
// MANY projects, auto-matches each row to a project (by developer + project
// name), lets the user override mismatches, then sends the final mapping
// here. We re-verify that every project_id belongs to the caller's tenant
// before any insert.
//
// We deliberately do a single bulk .insert() — no per-row uniqueness check.
// dsb_project_accounts has no unique constraint (see migration 048), so
// duplicates are allowed; the existing per-project UI handles cleanup if
// needed.
// ----------------------------------------------------------------------------

export interface BulkImportAccountsRow {
  project_id: string
  label: string
  account_number?: string | null
  bank_name?: string | null
  iban?: string | null
}

export async function bulkImportProjectAccounts(
  input: { rows: BulkImportAccountsRow[] },
): Promise<{ ok: true; inserted: number } | { ok: false; error: string }> {
  // Inline owner resolution — keeps this action file self-contained.
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, error: 'لم يتم تسجيل الدخول.' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) return { ok: false, error: 'حسابك غير مرتبط بمستأجر.' }
  const role = (profile.dsb_role as string | null) ?? null
  if (role !== 'owner') {
    return { ok: false, error: 'الاستيراد الجماعي متاح للمدير فقط.' }
  }
  const tenantId = profile.tenant_id as string
  const userId = profile.id as string

  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return { ok: false, error: 'لا توجد صفوف للاستيراد.' }
  }

  // Normalize + validate per-row shape. Reject any row missing project_id or
  // label up front (the client filters skipped rows already, but we don't
  // trust client input).
  const badIndices: number[] = []
  const normalized = input.rows.map((r, i) => {
    const projectId = (r.project_id ?? '').trim()
    const label = (r.label ?? '').trim()
    if (!projectId || !label) {
      badIndices.push(i + 1) // 1-based for human reporting
    }
    return {
      project_id: projectId,
      label,
      account_number: (r.account_number ?? '').trim() || null,
      bank_name: (r.bank_name ?? '').trim() || null,
      iban: (r.iban ?? '').trim().toUpperCase() || null,
    }
  })
  if (badIndices.length > 0) {
    return {
      ok: false,
      error: `صفوف ناقصة (مشروع أو اسم حساب فارغ) في المواضع: ${badIndices.join(', ')}`,
    }
  }

  // Tenant-isolation check: one query for ALL referenced projects.
  const uniqueProjectIds = Array.from(new Set(normalized.map((r) => r.project_id)))
  const { data: projRows, error: projErr } = await svc
    .from('dsb_projects')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('id', uniqueProjectIds)
  if (projErr) return { ok: false, error: projErr.message }

  const validProjectIds = new Set(
    ((projRows ?? []) as { id: string }[]).map((r) => r.id),
  )
  // Find rows whose project_id was NOT in the tenant.
  const mismatched: number[] = []
  normalized.forEach((r, i) => {
    if (!validProjectIds.has(r.project_id)) mismatched.push(i + 1)
  })
  if (mismatched.length > 0) {
    return {
      ok: false,
      error: `بعض الصفوف تشير إلى مشاريع لا تنتمي لمؤسستك (المواضع: ${mismatched.join(', ')}).`,
    }
  }

  // Build insert payload.
  const insertRows = normalized.map((r) => ({
    tenant_id: tenantId,
    project_id: r.project_id,
    label: r.label,
    account_number: r.account_number,
    bank_name: r.bank_name,
    iban: r.iban,
    created_by_user_id: userId,
  }))

  const { error: insErr } = await svc
    .from('dsb_project_accounts')
    .insert(insertRows)
  if (insErr) return { ok: false, error: insErr.message }

  // Revalidate the admin index plus every touched project page.
  revalidatePath('/app/disbursements/admin')
  for (const pid of uniqueProjectIds) {
    revalidatePath(`/app/disbursements/admin/projects/${pid}`)
  }

  return { ok: true, inserted: insertRows.length }
}
