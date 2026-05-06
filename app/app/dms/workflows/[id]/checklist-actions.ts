'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { fireN8nEvent } from '@/lib/integrations/n8n'

const ResponseSchema = z.object({
  run_id: z.string().uuid(),
  run_step_id: z.string().uuid(),
  checklist_item_id: z.string().uuid(),
  status: z.enum(['verified', 'issue', 'not_mentioned', 'not_attached', 'pending']),
  notes: z.string().max(2000).optional().nullable(),
})

/**
 * Save (insert-or-upsert) a single checklist response. Called from the
 * inline editor on the workflow detail page when an internal user marks
 * an item ✓ / ✗ / not_mentioned / not_attached.
 *
 * Auth: requires a Supabase session. Tenant isolation enforced via service
 * role + explicit tenant_id filter against the user's profile.
 */
export async function saveChecklistResponse(input: z.infer<typeof ResponseSchema>) {
  const parsed = ResponseSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.errors[0]?.message ?? 'Invalid input' }
  }

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Not authenticated' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) return { ok: false as const, error: 'Profile not found' }

  const tenantId = profile.tenant_id as string

  // Confirm step belongs to tenant
  const { data: step } = await svc
    .from('dms_workflow_run_steps')
    .select('id, run_id, tenant_id, kind')
    .eq('id', parsed.data.run_step_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!step) return { ok: false as const, error: 'Step not found' }

  // Upsert by (run_step_id, checklist_item_id)
  const { data: existing } = await svc
    .from('dms_workflow_checklist_responses')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('run_step_id', parsed.data.run_step_id)
    .eq('checklist_item_id', parsed.data.checklist_item_id)
    .maybeSingle()

  if (existing) {
    await svc
      .from('dms_workflow_checklist_responses')
      .update({
        status: parsed.data.status,
        notes: parsed.data.notes ?? null,
        responded_by: profile.id as string,
        responded_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
  } else {
    await svc.from('dms_workflow_checklist_responses').insert({
      tenant_id: tenantId,
      run_step_id: parsed.data.run_step_id,
      checklist_item_id: parsed.data.checklist_item_id,
      status: parsed.data.status,
      notes: parsed.data.notes ?? null,
      responded_by: profile.id as string,
      responded_at: new Date().toISOString(),
    })
  }

  // Audit log
  await svc.from('dms_workflow_audit_log').insert({
    tenant_id: tenantId,
    run_id: parsed.data.run_id,
    run_step_id: parsed.data.run_step_id,
    actor_kind: 'user',
    actor_user_id: profile.id as string,
    action: 'checklist_response',
    details: {
      checklist_item_id: parsed.data.checklist_item_id,
      status: parsed.data.status,
      step: step.kind,
    },
  })

  // Best-effort n8n webhook
  try {
    await fireN8nEvent('disbursement.checklist_item_answered', {
      run_id: parsed.data.run_id,
      run_step_id: parsed.data.run_step_id,
      checklist_item_id: parsed.data.checklist_item_id,
      status: parsed.data.status,
    })
  } catch (err) {
    console.error('[saveChecklistResponse] n8n event failed', err)
  }

  revalidatePath(`/app/dms/workflows/${parsed.data.run_id}`)

  return { ok: true as const }
}
