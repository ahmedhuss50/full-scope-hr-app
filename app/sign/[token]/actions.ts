'use server'
import { z } from 'zod'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createSupabaseService } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/resend'
import { analyzeDocument } from '@/lib/ai/analyze'
import { randomBytes } from 'crypto'

const SignSchema = z.object({
  token: z.string().min(10),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(2000).optional(),
})

/**
 * External-signer action: approve or reject the current step.
 *
 * Public path — uses service-role to bypass RLS because there is no
 * Supabase auth session for an external signer. Idempotency: if the
 * token has already been used we redirect to the done page.
 */
export async function signWorkflowStep(input: { token: string; decision: 'approve' | 'reject'; reason?: string }) {
  const parsed = SignSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.errors[0]?.message ?? 'Invalid input' }
  }
  const { token, decision, reason } = parsed.data

  const svc = createSupabaseService()
  const hdrs = headers()
  const ip = hdrs.get('x-forwarded-for') ?? hdrs.get('x-real-ip') ?? null
  const userAgent = hdrs.get('user-agent') ?? null

  // 1. Look up token + signer + step + run.
  const { data: tokenRow } = await svc
    .from('dms_workflow_signer_tokens')
    .select('id, tenant_id, signer_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle()

  if (!tokenRow) return { ok: false as const, error: 'Token not found' }

  const expired = new Date(tokenRow.expires_at).getTime() < Date.now()
  if (expired) {
    return { ok: false as const, error: 'expired', redirectTo: `/sign/${token}/expired` }
  }

  // If token already used, just redirect to done page (don't double-write signature).
  if (tokenRow.used_at) {
    return { ok: true as const, alreadySigned: true, redirectTo: `/sign/${token}/done?decision=approve` }
  }

  const tenantId = tokenRow.tenant_id as string
  const signerId = tokenRow.signer_id as string

  // 2. Load signer + step + run + document
  const { data: signer } = await svc
    .from('dms_workflow_signers')
    .select('id, run_step_id, external_name, external_email')
    .eq('id', signerId)
    .maybeSingle()
  if (!signer) return { ok: false as const, error: 'Signer not found' }

  const { data: step } = await svc
    .from('dms_workflow_run_steps')
    .select('id, run_id, order_index, kind, name')
    .eq('id', signer.run_step_id)
    .maybeSingle()
  if (!step) return { ok: false as const, error: 'Step not found' }

  const { data: run } = await svc
    .from('dms_workflow_runs')
    .select('id, document_id, client_id, template_id')
    .eq('id', step.run_id)
    .maybeSingle()
  if (!run) return { ok: false as const, error: 'Run not found' }

  // 3. Insert signature row
  await svc.from('dms_workflow_signatures').insert({
    tenant_id: tenantId,
    run_step_id: step.id,
    signer_id: signer.id,
    decision,
    reason: reason ?? null,
    signer_ip: ip,
    signer_user_agent: userAgent,
    signed_at: new Date().toISOString(),
  })

  // 4. Update current step status
  const stepStatus = decision === 'approve' ? 'approved' : 'rejected'
  await svc
    .from('dms_workflow_run_steps')
    .update({
      status: stepStatus,
      completed_at: new Date().toISOString(),
      rejected_reason: decision === 'reject' ? (reason ?? null) : null,
    })
    .eq('id', step.id)

  // 5. Audit log (signer_approved / signer_rejected)
  await svc.from('dms_workflow_audit_log').insert({
    tenant_id: tenantId,
    run_id: run.id,
    run_step_id: step.id,
    actor_kind: 'external_signer',
    actor_signer_id: signer.id,
    action: decision === 'approve' ? 'signer_approved' : 'signer_rejected',
    details: {
      step: step.kind,
      reason: reason ?? null,
      signer: signer.external_name ?? signer.external_email,
    },
    ip_address: ip,
  })

  // 6. Mark token used
  await svc
    .from('dms_workflow_signer_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenRow.id)

  // 7. Decide what's next
  if (decision === 'reject') {
    await svc
      .from('dms_workflow_runs')
      .update({ status: 'rejected', completed_at: new Date().toISOString() })
      .eq('id', run.id)

    await svc.from('dms_workflow_audit_log').insert({
      tenant_id: tenantId,
      run_id: run.id,
      actor_kind: 'system',
      action: 'workflow_rejected',
      details: { final_status: 'rejected', at_step: step.kind },
    })

    return { ok: true as const, redirectTo: `/sign/${token}/done?decision=reject` }
  }

  // Approve path — find next step
  const { data: nextStep } = await svc
    .from('dms_workflow_run_steps')
    .select('id, order_index, kind, name, signer_kind')
    .eq('tenant_id', tenantId)
    .eq('run_id', run.id)
    .gt('order_index', step.order_index)
    .order('order_index', { ascending: true })
    .limit(1)
    .maybeSingle()

  await svc.from('dms_workflow_audit_log').insert({
    tenant_id: tenantId,
    run_id: run.id,
    run_step_id: step.id,
    actor_kind: 'system',
    action: 'step_completed',
    details: { order_index: step.order_index },
  })

  if (!nextStep) {
    // Workflow complete
    await svc
      .from('dms_workflow_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', run.id)

    await svc.from('dms_workflow_audit_log').insert({
      tenant_id: tenantId,
      run_id: run.id,
      actor_kind: 'system',
      action: 'workflow_completed',
      details: { final_status: 'completed' },
    })

    return { ok: true as const, redirectTo: `/sign/${token}/done?decision=approve` }
  }

  // Activate next step
  await svc
    .from('dms_workflow_run_steps')
    .update({ status: 'awaiting', activated_at: new Date().toISOString() })
    .eq('id', nextStep.id)

  await svc
    .from('dms_workflow_runs')
    .update({
      status: nextStep.signer_kind === 'external' ? 'awaiting_signer' : 'in_progress',
      current_step_id: nextStep.id,
    })
    .eq('id', run.id)

  await svc.from('dms_workflow_audit_log').insert({
    tenant_id: tenantId,
    run_id: run.id,
    run_step_id: nextStep.id,
    actor_kind: 'system',
    action: 'step_activated',
    details: { order_index: nextStep.order_index, name: nextStep.name },
  })

  // Generate AI analysis for the next step (best-effort)
  try {
    const { data: doc } = await svc
      .from('dms_documents')
      .select('display_name, filename, doc_kind')
      .eq('id', run.document_id)
      .maybeSingle()
    const { data: client } = run.client_id
      ? await svc.from('clients').select('name').eq('id', run.client_id).maybeSingle()
      : { data: null as { name: string } | null }

    const analysis = await analyzeDocument({
      document_name: doc?.display_name ?? doc?.filename ?? 'Document',
      doc_kind: doc?.doc_kind ?? null,
      stage_kind: nextStep.kind,
      client_name: client?.name ?? undefined,
    })

    await svc.from('dms_workflow_ai_analyses').insert({
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: nextStep.id,
      prompt: null,
      model: analysis.model,
      summary: analysis.summary,
      key_points: analysis.key_points,
      risk_flags: analysis.risk_flags,
      recommendation: analysis.recommendation,
      confidence: analysis.confidence,
      raw_output: analysis.raw_output ?? null,
    })

    await svc.from('dms_workflow_audit_log').insert({
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: nextStep.id,
      actor_kind: 'system',
      action: 'ai_analysis_generated',
      details: { model: analysis.model, confidence: analysis.confidence, step: nextStep.kind },
    })
  } catch (err: unknown) {
    console.error('[signWorkflowStep] AI analysis failed', err)
  }

  // If next step is external, generate a token + send email
  if (nextStep.signer_kind === 'external') {
    try {
      const { data: nextSigner } = await svc
        .from('dms_workflow_signers')
        .select('id, external_name, external_email, external_role')
        .eq('run_step_id', nextStep.id)
        .maybeSingle()

      if (nextSigner?.external_email) {
        const newToken = randomBytes(24).toString('hex').slice(0, 40)
        await svc.from('dms_workflow_signer_tokens').insert({
          tenant_id: tenantId,
          signer_id: nextSigner.id,
          token: newToken,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })

        await svc
          .from('dms_workflow_signers')
          .update({ notify_sent_at: new Date().toISOString() })
          .eq('id', nextSigner.id)

        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
        const link = `${baseUrl}/sign/${newToken}`

        const emailRes = await sendEmail({
          to: nextSigner.external_email,
          subject: `Approval requested: ${nextStep.name}`,
          html: `<p>Hello ${nextSigner.external_name ?? ''},</p>
                 <p>You have a document awaiting your review and approval.</p>
                 <p><a href="${link}">${link}</a></p>
                 <p>This link expires in 7 days.</p>`,
          text: `You have a document awaiting your approval. ${link}`,
        })

        await svc.from('dms_workflow_audit_log').insert({
          tenant_id: tenantId,
          run_id: run.id,
          run_step_id: nextStep.id,
          actor_kind: 'system',
          actor_signer_id: nextSigner.id,
          action: emailRes.sent ? 'email_sent' : 'email_failed',
          details: {
            channel: 'resend',
            to: nextSigner.external_email,
            ok: emailRes.sent,
            reason: emailRes.reason ?? null,
          },
        })
      }
    } catch (err: unknown) {
      console.error('[signWorkflowStep] external signer email step failed', err)
    }
  } else {
    // Internal signer — best-effort notify (no-op if no email on file)
    try {
      const { data: nextSigner } = await svc
        .from('dms_workflow_signers')
        .select('id, internal_user_id, internal_user:users!internal_user_id(email, full_name)')
        .eq('run_step_id', nextStep.id)
        .maybeSingle()
      type InternalUser = { email?: string | null; full_name?: string | null }
      const iu = nextSigner?.internal_user as InternalUser | InternalUser[] | null | undefined
      const internal = Array.isArray(iu) ? iu[0] : iu
      if (internal?.email) {
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
        await sendEmail({
          to: internal.email,
          subject: `Your review is needed: ${nextStep.name}`,
          html: `<p>Hello ${internal.full_name ?? ''},</p>
                 <p>A document workflow has reached your stage and needs your review.</p>
                 <p><a href="${baseUrl}/app/dms/workflows/${run.id}">Open workflow</a></p>`,
          text: `A document workflow needs your review: ${baseUrl}/app/dms/workflows/${run.id}`,
        })
      }
    } catch (err) {
      console.error('[signWorkflowStep] internal signer notify failed', err)
    }
  }

  return { ok: true as const, redirectTo: `/sign/${token}/done?decision=approve` }
}

/**
 * Server-action wrapper used directly from <form action={...}> on the
 * signer page. Reads token + decision + reason from FormData and
 * redirects to the result page.
 */
export async function submitSignFormAction(formData: FormData) {
  const token = String(formData.get('token') ?? '')
  const decision = String(formData.get('decision') ?? '') as 'approve' | 'reject'
  const reason = (formData.get('reason') as string | null) ?? undefined

  const result = await signWorkflowStep({ token, decision, reason })
  if (!result.ok) {
    if (result.error === 'expired') redirect(`/sign/${token}/expired`)
    redirect(`/sign/${token}?err=1`)
  }
  if (result.redirectTo) redirect(result.redirectTo)
  redirect(`/sign/${token}/done?decision=${decision}`)
}
