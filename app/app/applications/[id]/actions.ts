'use server'
import { z } from 'zod'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { sendEmail } from '@/lib/email/resend'
import { renderInterviewProposed } from '@/lib/email/templates/interviewProposed'
import type { Locale } from '@/lib/i18n/translations'

const Schema = z.object({
  application_id: z.string().uuid(),
  candidate_id: z.string().uuid(),
  interviewer_user_id: z.string().uuid(),
  slots: z.array(z.string().datetime()).min(1).max(5),
})

/**
 * Will-interview flow:
 *   1. Update application.status → interview_pending
 *   2. Append application_status_history
 *   3. Create an interview row in status='slots_proposed'
 *   4. Insert one interview_slots row per proposed slot
 *   5. Send the candidate an email via Resend with a link to the public slot picker
 */
export async function proposeInterview(input: z.infer<typeof Schema>) {
  const parsed = Schema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: parsed.error.errors[0]?.message ?? 'Invalid input' }
  const data = parsed.data

  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Not authenticated' }

  const svc = createSupabaseService()
  const { data: profile } = await svc.from('users').select('id, tenant_id').eq('email', user.email!).maybeSingle()
  if (!profile) return { ok: false as const, error: 'No tenant mapping' }
  const tenantId = profile.tenant_id as string
  const actorUserId = profile.id as string

  // 1 + 2: status change
  const { error: updErr } = await svc
    .from('applications')
    .update({ status: 'interview_pending' })
    .eq('id', data.application_id)
    .eq('tenant_id', tenantId)
  if (updErr) return { ok: false as const, error: updErr.message }

  await svc.from('application_status_history').insert({
    application_id: data.application_id,
    tenant_id: tenantId,
    from_status: 'applied',
    to_status: 'interview_pending',
    actor_user_id: actorUserId,
    reason_code: 'will_interview',
  })

  // 3: interview row
  const { data: interview, error: intvErr } = await svc
    .from('interviews')
    .insert({
      tenant_id: tenantId,
      application_id: data.application_id,
      interviewer_user_id: data.interviewer_user_id,
      interview_type: 'in_person',
      status: 'slots_proposed',
    })
    .select('id')
    .single()
  if (intvErr || !interview) return { ok: false as const, error: intvErr?.message ?? 'Interview insert failed' }

  // 4: slots
  const slotRows = data.slots.map(iso => ({
    tenant_id: tenantId,
    interview_id: interview.id,
    slot_start: iso,
    slot_end: new Date(new Date(iso).getTime() + 45 * 60000).toISOString(),
  }))
  const { error: slotErr } = await svc.from('interview_slots').insert(slotRows)
  if (slotErr) return { ok: false as const, error: slotErr.message }

  // 5: send email (best-effort)
  let emailResult: { sent: boolean; reason?: string; messageId?: string } = { sent: false, reason: 'not attempted' }
  try {
    const { data: candidate } = await svc
      .from('candidates')
      .select('legal_first_name, primary_email, locale')
      .eq('id', data.candidate_id)
      .maybeSingle()

    const { data: appData } = await svc
      .from('applications')
      .select('job_requisitions(title)')
      .eq('id', data.application_id)
      .maybeSingle()

    const { data: tenantData } = await svc
      .from('tenants')
      .select('name, slug')
      .eq('id', tenantId)
      .maybeSingle()

    const { data: interviewer } = await svc
      .from('users')
      .select('full_name')
      .eq('id', data.interviewer_user_id)
      .maybeSingle()

    if (candidate?.primary_email && tenantData) {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
      const jr = Array.isArray(appData?.job_requisitions) ? appData.job_requisitions[0] : appData?.job_requisitions
      const candidateLocale = (candidate.locale as Locale) ?? 'ar'

      // Format slots in the candidate's locale.
      const slotLabels = data.slots.map(iso => ({
        label: new Date(iso).toLocaleString(candidateLocale === 'ar' ? 'ar-SA' : 'en-US', {
          weekday: 'short', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit', hour12: candidateLocale === 'en',
        }),
      }))

      const rendered = renderInterviewProposed({
        candidateFirstName: candidate.legal_first_name,
        firmName: tenantData.name,
        roleTitle: (jr as { title?: string } | undefined)?.title ?? null,
        schedulePickerUrl: `${baseUrl}/schedule/${interview.id}`,
        slots: slotLabels,
        interviewerName: interviewer?.full_name ?? null,
        durationMinutes: 30,
        locale: candidateLocale,
      })

      emailResult = await sendEmail({
        to: candidate.primary_email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        locale: candidateLocale,
      })
    } else {
      emailResult = { sent: false, reason: 'no candidate email on file' }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'email step failed'
    console.error('[interview] email step threw', err)
    emailResult = { sent: false, reason: message }
  }

  // 6: audit
  await svc.from('audit_log').insert({
    tenant_id: tenantId,
    actor_user_id: actorUserId,
    entity_kind: 'application',
    entity_id: data.application_id,
    action: 'propose_interview',
    after_state: { interview_id: interview.id, slots: data.slots, email: emailResult },
  })

  revalidatePath(`/app/applications/${data.candidate_id}`)
  return { ok: true as const, interview_id: interview.id, email: emailResult }
}
