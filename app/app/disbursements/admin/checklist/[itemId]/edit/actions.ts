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
  if (role !== 'owner') return { error: 'صاحب القرار فقط يمكنه تعديل قائمة المراجعة.' }
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

  if (!code) return { ok: false, error: 'الرمز مطلوب.' }
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) {
    return { ok: false, error: 'الرمز يجب أن يكون حروفًا كبيرة وأرقامًا وشرطات سفلية فقط.' }
  }
  if (!promptAr) return { ok: false, error: 'النص بالعربية مطلوب.' }
  if (!promptEn) return { ok: false, error: 'النص بالإنجليزية مطلوب.' }
  if (orderIndex < 0) return { ok: false, error: 'الترتيب يجب أن يكون صفرًا أو أكبر.' }

  const svc = createSupabaseService()

  // Load the item & verify it belongs to caller's tenant (cannot edit defaults).
  const { data: existing } = await svc
    .from('dsb_checklist_items')
    .select('id, tenant_id')
    .eq('id', input.item_id)
    .maybeSingle()
  if (!existing) return { ok: false, error: 'البند غير موجود.' }
  const itemTenant = (existing.tenant_id as string | null) ?? null
  if (itemTenant === null) return { ok: false, error: 'لا يمكن تعديل البنود الافتراضية.' }
  if (itemTenant !== caller.tenantId) return { ok: false, error: 'البند لا يخص مكتبك.' }

  // Uniqueness check (excluding self).
  const { data: clash } = await svc
    .from('dsb_checklist_items')
    .select('id')
    .eq('tenant_id', caller.tenantId)
    .eq('code', code)
    .neq('id', input.item_id)
    .maybeSingle()
  if (clash) return { ok: false, error: 'يوجد بند بهذا الرمز للمكتب بالفعل.' }

  const { error } = await svc
    .from('dsb_checklist_items')
    .update({
      code,
      prompt_ar: promptAr,
      prompt_en: promptEn,
      order_index: orderIndex,
      active,
    })
    .eq('id', input.item_id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/checklist')
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
    .select('id, tenant_id')
    .eq('id', input.item_id)
    .maybeSingle()
  if (!existing) return { ok: false, error: 'البند غير موجود.' }
  const itemTenant = (existing.tenant_id as string | null) ?? null
  if (itemTenant === null) return { ok: false, error: 'لا يمكن حذف البنود الافتراضية.' }
  if (itemTenant !== caller.tenantId) return { ok: false, error: 'البند لا يخص مكتبك.' }

  const { error } = await svc
    .from('dsb_checklist_items')
    .delete()
    .eq('id', input.item_id)
    .eq('tenant_id', caller.tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/checklist')
  revalidatePath('/app/disbursements/admin')
  return { ok: true }
}
