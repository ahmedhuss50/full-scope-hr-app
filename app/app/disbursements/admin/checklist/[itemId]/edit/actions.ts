'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

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
  if (role !== 'owner') return { error: 'المدير فقط يمكنه تعديل قائمة المراجعة.' }
  return {
    tenantId: profile.tenant_id as string,
    userId: profile.id as string,
  }
}

export interface UpdateChecklistItemInput {
  item_id: string
  code: string
  prompt_ar: string
  prompt_en: string
  order_index: number
  active: boolean
  // Optional — pass a non-empty string to MOVE the item between templates.
  // Omit to leave it where it is. Same-tenant validation runs server-side.
  template_id?: string
}

export type UpdateChecklistItemResult = { ok: true } | { ok: false; error: string }

export async function updateChecklistItem(
  input: UpdateChecklistItemInput,
): Promise<UpdateChecklistItemResult> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }

  const code = (input.code ?? '').trim().toUpperCase()
  const promptAr = (input.prompt_ar ?? '').trim()
  const promptEn = (input.prompt_en ?? '').trim()
  const orderIndex = Number.isFinite(input.order_index) ? Math.trunc(input.order_index) : 0
  const active = !!input.active
  const templateIdProvided = input.template_id !== undefined
  const templateId = templateIdProvided ? (input.template_id ?? '').trim() : null

  if (!code) return { ok: false, error: 'الرمز مطلوب.' }
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) {
    return { ok: false, error: 'الرمز يجب أن يكون حروفًا كبيرة وأرقامًا وشرطات سفلية فقط.' }
  }
  if (!promptAr) return { ok: false, error: 'النص بالعربية مطلوب.' }
  if (!promptEn) return { ok: false, error: 'النص بالإنجليزية مطلوب.' }
  if (orderIndex < 0) return { ok: false, error: 'الترتيب يجب أن يكون صفرًا أو أكبر.' }
  if (templateIdProvided && !templateId) {
    return { ok: false, error: 'القائمة مطلوبة.' }
  }

  const svc = createSupabaseService()

  // Load the item. Now that everything's tenant-scoped (no more NULL-tenant
  // globals in the admin surface), block items from another tenant.
  const { data: existing } = await svc
    .from('dsb_checklist_items')
    .select('id, tenant_id, template_id')
    .eq('id', input.item_id)
    .maybeSingle()
  if (!existing) return { ok: false, error: 'البند غير موجود.' }
  const itemTenant = (existing.tenant_id as string | null) ?? null
  if (itemTenant !== null && itemTenant !== caller.tenantId) {
    return { ok: false, error: 'البند لا يخص مكتبك.' }
  }
  const isDefaultItem = itemTenant === null

  // Cross-tenant template check: if the caller is moving the item, the
  // target template must belong to caller's tenant.
  if (templateIdProvided && templateId) {
    const { data: tpl } = await svc
      .from('dsb_checklist_templates')
      .select('id, tenant_id')
      .eq('id', templateId)
      .maybeSingle()
    if (!tpl || (tpl as { tenant_id: string }).tenant_id !== caller.tenantId) {
      return { ok: false, error: 'القائمة غير موجودة أو لا تخص مكتبك.' }
    }
  }

  // Uniqueness check (excluding self) — scoped to same tenant bucket as the item.
  const clashQuery = svc
    .from('dsb_checklist_items')
    .select('id')
    .eq('code', code)
    .neq('id', input.item_id)
  const clashRes = isDefaultItem
    ? await clashQuery.is('tenant_id', null).maybeSingle()
    : await clashQuery.eq('tenant_id', caller.tenantId).maybeSingle()
  if (clashRes.data) return { ok: false, error: 'يوجد بند بهذا الرمز بالفعل.' }

  const updatePayload: Record<string, unknown> = {
    code,
    prompt_ar: promptAr,
    prompt_en: promptEn,
    order_index: orderIndex,
    active,
  }
  if (templateIdProvided && templateId) {
    updatePayload.template_id = templateId
  }

  const updateQuery = svc
    .from('dsb_checklist_items')
    .update(updatePayload)
    .eq('id', input.item_id)
  const { error } = isDefaultItem
    ? await updateQuery.is('tenant_id', null)
    : await updateQuery.eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  const prevTplId = (existing as { template_id: string | null }).template_id ?? null
  revalidatePath('/app/disbursements/admin/checklist')
  revalidatePath('/app/disbursements/admin/checklist-templates')
  if (prevTplId) {
    revalidatePath(`/app/disbursements/admin/checklist-templates/${prevTplId}`)
  }
  if (templateIdProvided && templateId && templateId !== prevTplId) {
    revalidatePath(`/app/disbursements/admin/checklist-templates/${templateId}`)
  }
  revalidatePath('/app/disbursements/admin')
  return { ok: true }
}

export async function deleteChecklistItem(
  input: { item_id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }

  const svc = createSupabaseService()
  const { data: existing } = await svc
    .from('dsb_checklist_items')
    .select('id, tenant_id, template_id')
    .eq('id', input.item_id)
    .maybeSingle()
  if (!existing) return { ok: false, error: 'البند غير موجود.' }
  const itemTenant = (existing.tenant_id as string | null) ?? null
  if (itemTenant !== null && itemTenant !== caller.tenantId) {
    return { ok: false, error: 'البند لا يخص مكتبك.' }
  }
  const isDefaultItem = itemTenant === null

  const deleteQuery = svc
    .from('dsb_checklist_items')
    .delete()
    .eq('id', input.item_id)
  const { error } = isDefaultItem
    ? await deleteQuery.is('tenant_id', null)
    : await deleteQuery.eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  const prevTplId = (existing as { template_id: string | null }).template_id ?? null
  revalidatePath('/app/disbursements/admin/checklist')
  revalidatePath('/app/disbursements/admin/checklist-templates')
  if (prevTplId) {
    revalidatePath(`/app/disbursements/admin/checklist-templates/${prevTplId}`)
  }
  revalidatePath('/app/disbursements/admin')
  return { ok: true }
}
