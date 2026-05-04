'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

const Schema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional().or(z.literal('')),
  department_id: z.string().uuid().optional().or(z.literal('')),
  practice_area_id: z.string().uuid().optional().or(z.literal('')),
  work_location_id: z.string().uuid().optional().or(z.literal('')),
  classification: z.enum(['W-2', '1099']),
  pay_type: z.enum(['Hourly', 'Salary', 'Commission', 'Retainer']).optional().or(z.literal('')),
  pay_rate_min: z.string().optional().or(z.literal('')),
  pay_rate_max: z.string().optional().or(z.literal('')),
  pay_currency: z.string().max(4).optional().or(z.literal('')),
  openings_count: z.string().optional().or(z.literal('')),
  status: z.enum(['open', 'on_hold', 'filled', 'closed']),
})

export async function createJob(formData: FormData): Promise<{ error?: string; id?: string }> {
  // Authenticate the caller and resolve their tenant.
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in.' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) return { error: 'No tenant mapping for this user.' }

  // Validate the form payload.
  const raw = Object.fromEntries(formData.entries())
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  }
  const v = parsed.data

  const toNumberOrNull = (s: string | undefined) => {
    if (!s || s === '') return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }

  // Insert via service role (bypasses RLS — same pattern as the rest of the app).
  const { data, error } = await svc
    .from('job_requisitions')
    .insert({
      tenant_id: profile.tenant_id,
      title: v.title,
      description: v.description || null,
      department_id: v.department_id || null,
      practice_area_id: v.practice_area_id || null,
      work_location_id: v.work_location_id || null,
      classification: v.classification,
      pay_type: v.pay_type || null,
      pay_rate_min: toNumberOrNull(v.pay_rate_min),
      pay_rate_max: toNumberOrNull(v.pay_rate_max),
      pay_currency: v.pay_currency || 'SAR',
      openings_count: toNumberOrNull(v.openings_count) ?? 1,
      status: v.status,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createJob]', error)
    return { error: error.message }
  }

  // Audit log (best-effort, append-only).
  await svc.from('audit_log').insert({
    tenant_id: profile.tenant_id,
    actor_user_id: profile.id,
    entity_kind: 'job_requisition',
    entity_id: data.id,
    action: 'create',
    after_state: { title: v.title, status: v.status, classification: v.classification },
  })

  revalidatePath('/app/hr/jobs')
  revalidatePath('/app/hr')
  return { id: data.id }
}
