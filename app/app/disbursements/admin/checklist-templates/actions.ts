'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

// ----------------------------------------------------------------------------
// Owner-only CRUD for checklist templates.
//
// A template is a NAMED grouping of dsb_checklist_items. Each tenant has many
// templates; at most one is flagged is_default = true (enforced by partial
// unique index in migration 053). Projects and clients can pick a template
// via `checklist_template_id`; the case page falls back to the default.
// ----------------------------------------------------------------------------

type StaffRole = 'employee' | 'supervisor' | 'owner'

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
  const role = (profile.dsb_role as StaffRole | null) ?? null
  if (role !== 'owner') return { error: 'المدير فقط يمكنه تعديل قوائم المراجعة.' }
  return {
    tenantId: profile.tenant_id as string,
    userId: profile.id as string,
  }
}

function revalidateTemplatePages(templateId?: string) {
  revalidatePath('/app/disbursements/admin/checklist')
  revalidatePath('/app/disbursements/admin/checklist-templates')
  if (templateId) {
    revalidatePath(`/app/disbursements/admin/checklist-templates/${templateId}`)
  }
  revalidatePath('/app/disbursements/admin')
}

// ---------------------------------------------------------------------------
// createTemplate
// ---------------------------------------------------------------------------

export interface CreateTemplateInput {
  name: string
  is_default?: boolean
}

export type CreateTemplateResult =
  | { ok: true; template_id: string }
  | { ok: false; error: string }

export async function createTemplate(
  input: CreateTemplateInput,
): Promise<CreateTemplateResult> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }

  const name = (input.name ?? '').trim()
  if (!name) return { ok: false, error: 'اسم القائمة مطلوب.' }
  if (name.length > 100) return { ok: false, error: 'اسم القائمة طويل جدًا.' }
  const wantsDefault = !!input.is_default

  const svc = createSupabaseService()

  // If the caller wants this to be the default, clear any other default first.
  // The partial unique index would reject a second default row, so the two
  // statements must run in this order. Worst case on a partial failure: no
  // default for the tenant — which the resolver handles gracefully.
  if (wantsDefault) {
    const { error: unsetErr } = await svc
      .from('dsb_checklist_templates')
      .update({ is_default: false })
      .eq('tenant_id', caller.tenantId)
      .eq('is_default', true)
    if (unsetErr) return { ok: false, error: unsetErr.message }
  }

  const { data, error } = await svc
    .from('dsb_checklist_templates')
    .insert({
      tenant_id: caller.tenantId,
      name,
      is_default: wantsDefault,
    })
    .select('id')
    .single()
  if (error || !data) {
    return { ok: false, error: error?.message ?? 'تعذّر إنشاء القائمة.' }
  }

  revalidateTemplatePages(data.id as string)
  return { ok: true, template_id: data.id as string }
}

// ---------------------------------------------------------------------------
// renameTemplate
// ---------------------------------------------------------------------------

export interface RenameTemplateInput {
  id: string
  name: string
}

export async function renameTemplate(
  input: RenameTemplateInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }

  const id = (input.id ?? '').trim()
  const name = (input.name ?? '').trim()
  if (!id) return { ok: false, error: 'بيانات ناقصة.' }
  if (!name) return { ok: false, error: 'اسم القائمة مطلوب.' }
  if (name.length > 100) return { ok: false, error: 'اسم القائمة طويل جدًا.' }

  const svc = createSupabaseService()

  // Tenant check.
  const { data: existing } = await svc
    .from('dsb_checklist_templates')
    .select('id, tenant_id')
    .eq('id', id)
    .maybeSingle()
  if (!existing || (existing as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'القائمة غير موجودة.' }
  }

  const { error } = await svc
    .from('dsb_checklist_templates')
    .update({ name })
    .eq('id', id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidateTemplatePages(id)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// setDefaultTemplate
// ---------------------------------------------------------------------------

export interface SetDefaultTemplateInput {
  id: string
}

export async function setDefaultTemplate(
  input: SetDefaultTemplateInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }

  const id = (input.id ?? '').trim()
  if (!id) return { ok: false, error: 'بيانات ناقصة.' }

  const svc = createSupabaseService()
  const { data: existing } = await svc
    .from('dsb_checklist_templates')
    .select('id, tenant_id, is_default')
    .eq('id', id)
    .maybeSingle()
  if (!existing || (existing as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'القائمة غير موجودة.' }
  }
  if ((existing as { is_default: boolean }).is_default) {
    // Already the default — nothing to do.
    return { ok: true }
  }

  // Two-step: unset the previous default, then set the new one. The partial
  // unique index would reject doing both in a single update.
  const { error: unsetErr } = await svc
    .from('dsb_checklist_templates')
    .update({ is_default: false })
    .eq('tenant_id', caller.tenantId)
    .eq('is_default', true)
  if (unsetErr) return { ok: false, error: unsetErr.message }

  const { error: setErr } = await svc
    .from('dsb_checklist_templates')
    .update({ is_default: true })
    .eq('id', id)
    .eq('tenant_id', caller.tenantId)
  if (setErr) return { ok: false, error: setErr.message }

  revalidateTemplatePages(id)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// deleteTemplate
// ---------------------------------------------------------------------------
//
// Safety checks:
//   - Cannot delete the default template (would leave the tenant defaultless).
//     Promote another template first, then delete.
//   - Cannot delete a template that owns items (would orphan them — the FK
//     is ON DELETE CASCADE so they'd actually disappear silently, which we
//     consider too destructive without confirmation).
//   - Cannot delete a template that any project or client points to (their
//     FK is ON DELETE SET NULL, so it wouldn't error, but the caller almost
//     certainly meant to reassign those projects/clients first).

export interface DeleteTemplateInput {
  id: string
}

export async function deleteTemplate(
  input: DeleteTemplateInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }

  const id = (input.id ?? '').trim()
  if (!id) return { ok: false, error: 'بيانات ناقصة.' }

  const svc = createSupabaseService()
  const { data: existing } = await svc
    .from('dsb_checklist_templates')
    .select('id, tenant_id, is_default')
    .eq('id', id)
    .maybeSingle()
  if (!existing || (existing as { tenant_id: string }).tenant_id !== caller.tenantId) {
    return { ok: false, error: 'القائمة غير موجودة.' }
  }
  if ((existing as { is_default: boolean }).is_default) {
    return { ok: false, error: 'لا يمكن حذف القائمة الافتراضية. عيّن قائمة أخرى كافتراضية أولًا.' }
  }

  // Items?
  const { count: itemCount } = await svc
    .from('dsb_checklist_items')
    .select('id', { count: 'exact', head: true })
    .eq('template_id', id)
  if ((itemCount ?? 0) > 0) {
    return { ok: false, error: 'تحتوي هذه القائمة على بنود. احذف البنود أولًا.' }
  }

  // Projects pointing at it?
  const { count: projCount } = await svc
    .from('dsb_projects')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', caller.tenantId)
    .eq('checklist_template_id', id)
  if ((projCount ?? 0) > 0) {
    return { ok: false, error: 'يوجد مشاريع تستخدم هذه القائمة. غيّر قائمتها أولًا.' }
  }

  // Clients pointing at it?
  const { count: devCount } = await svc
    .from('dsb_developers')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', caller.tenantId)
    .eq('checklist_template_id', id)
  if ((devCount ?? 0) > 0) {
    return { ok: false, error: 'يوجد عملاء يستخدمون هذه القائمة. غيّر قائمتهم أولًا.' }
  }

  const { error } = await svc
    .from('dsb_checklist_templates')
    .delete()
    .eq('id', id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidateTemplatePages()
  return { ok: true }
}
