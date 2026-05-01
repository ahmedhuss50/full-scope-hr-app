'use server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'

const Schema = z.object({
  interview_id: z.string().uuid(),
  slot_id: z.string().uuid(),
})

export async function confirmSlot(input: z.infer<typeof Schema>) {
  const parsed = Schema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: 'Invalid input' }
  const { interview_id, slot_id } = parsed.data

  const svc = createSupabaseService()

  // Fetch the slot + interview
  const { data: slot, error: slotErr } = await svc
    .from('interview_slots')
    .select('id, slot_start, slot_end, interview_id, interviews!inner(tenant_id, application_id, status)')
    .eq('id', slot_id)
    .eq('interview_id', interview_id)
    .maybeSingle()
  if (slotErr || !slot) return { ok: false as const, error: 'Slot not found' }

  const intv = Array.isArray(slot.interviews) ? slot.interviews[0] : slot.interviews
  if (intv?.status !== 'slots_proposed') {
    return { ok: false as const, error: 'This interview is no longer accepting responses.' }
  }
  const tenantId = intv.tenant_id as string
  const applicationId = intv.application_id as string

  // Mark this slot selected, others declined
  await svc.from('interview_slots').update({ declined: true }).eq('interview_id', interview_id)
  await svc.from('interview_slots').update({ selected: true, declined: false }).eq('id', slot_id)

  // Update interview row
  const { error: intvErr } = await svc
    .from('interviews')
    .update({
      status: 'scheduled',
      scheduled_start: slot.slot_start,
      scheduled_end: slot.slot_end,
    })
    .eq('id', interview_id)
  if (intvErr) return { ok: false as const, error: intvErr.message }

  // Advance application status
  await svc
    .from('applications')
    .update({ status: 'interview_scheduled' })
    .eq('id', applicationId)
    .eq('tenant_id', tenantId)

  await svc.from('application_status_history').insert({
    application_id: applicationId,
    tenant_id: tenantId,
    from_status: 'interview_pending',
    to_status: 'interview_scheduled',
    reason_code: 'candidate_picked_slot',
  })

  await svc.from('audit_log').insert({
    tenant_id: tenantId,
    actor_user_id: null,
    entity_kind: 'interview',
    entity_id: interview_id,
    action: 'scheduled',
    after_state: { slot_id, slot_start: slot.slot_start },
  })

  return { ok: true as const }
}
