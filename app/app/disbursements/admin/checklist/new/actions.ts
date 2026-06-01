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

export interface CreateChecklistItemInput {
  code: string
  prompt_ar: string
  prompt_en: string
  order_index: number
  active: boolean
}

export type CreateChecklistItemResult =
  | { ok: true; item_id: string }
  | { ok: false; error: string }

export async function createChecklistItem(
  input: CreateChecklistItemInput,
): Promise<CreateChecklistItemResult> {
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

  // Uniqueness check within tenant.
  const { data: existing } = await svc
    .from('dsb_checklist_items')
    .select('id')
    .eq('tenant_id', caller.tenantId)
    .eq('code', code)
    .maybeSingle()
  if (existing) return { ok: false, error: 'يوجد بند بهذا الرمز للمكتب بالفعل.' }

  const { data, error } = await svc
    .from('dsb_checklist_items')
    .insert({
      tenant_id: caller.tenantId,
      code,
      prompt_ar: promptAr,
      prompt_en: promptEn,
      order_index: orderIndex,
      active,
    })
    .select('id')
    .single()

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'فشل إنشاء البند.' }
  }

  revalidatePath('/app/disbursements/admin/checklist')
  revalidatePath('/app/disbursements/admin')
  return { ok: true, item_id: data.id as string }
}
