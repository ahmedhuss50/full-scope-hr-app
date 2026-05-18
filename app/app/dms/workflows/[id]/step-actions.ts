'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { randomBytes } from 'crypto'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { fireN8nEvent } from '@/lib/integrations/n8n'

const ApproveSchema = z.object({
  step_id: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(2000).optional().or(z.literal('')),
})

export type ApproveStepResult = {
  ok: boolean
  next_step_id?: string
  workflow_completed?: boolean
  error?: string
}

/**
 * Internal-staff action to approve or reject the currently active step on a
 * workflow run. Mirrors the stage-transition logic from
 * `signWorkflowStep` (external) and `advanceStepAsAgent` (AI agent), but is
 * scoped to internal_review / final_approval steps that require a human
 * sign-off from a firm user (not an external signer).
 *
 * Uses the service-role client because we need to write to multiple tables
 * (signatures, run_steps, runs, signer_tokens, audit_log) atomically.
 */
export async function approveStepAsInternal(
  input: z.infer<typeof ApproveSchema>,
): Promise<ApproveStepResult> {
  const parsed = ApproveSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' }
  }
  const { step_id, decision, reason } = parsed.data
  const reasonText = reason && reason.length > 0 ? reason : null

  // 1. Auth check — must be a signed-in firm user.
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const svc = createSupabaseService()

  // 2. Resolve user's tenant + user.id.
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, full_name')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) return { ok: false, error: 'User profile not found' }

  const tenantId = profile.tenant_id as string
  const userId = profile.id as string
  const userFullName = (profile.full_name as string | null) ?? null

  // 3. Load the step (scoped by tenant) + run.
  const { data: step } = await svc
    .from('dms_workflow_run_steps')
    .select('id, run_id, order_index, kind, name, signer_kind, status')
    .eq('tenant_id', tenantId)
    .eq('id', step_id)
    .maybeSingle()
  if (!step) return { ok: false, error: 'Step not found' }

  // 4. Verify step is ready for an internal decision.
  if (step.status !== 'awaiting') {
    return { ok: false, error: 'Step is not awaiting a decision' }
  }
  if (step.kind !== 'internal_review' && step.kind !== 'final_approval') {
    return {
      ok: false,
      error: 'Only internal_review and final_approval steps can be approved here',
    }
  }
  if (step.signer_kind !== 'internal_user') {
    return {
      ok: false,
      error: 'This step is assigned to an external signer — use the signer link instead',
    }
  }

  const { data: run } = await svc
    .from('dms_workflow_runs')
    .select('id, document_id, client_id, template_id, tenant_id')
    .eq('tenant_id', tenantId)
    .eq('id', step.run_id)
    .maybeSingle()
  if (!run) return { ok: false, error: 'Run not found' }

  // 5. Optional signer assignment (used to attribute the signature row).
  const { data: signer } = await svc
    .from('dms_workflow_signers')
    .select('id, internal_user_id')
    .eq('tenant_id', tenantId)
    .eq('run_step_id', step.id)
    .maybeSingle()

  const nowIso = new Date().toISOString()

  // 6. Insert signature row.
  await svc.from('dms_workflow_signatures').insert({
    tenant_id: tenantId,
    run_step_id: step.id,
    signer_id: signer?.id ?? null,
    decision,
    reason: reasonText,
    signed_at: nowIso,
  })

  // 7. Update step status.
  const stepStatus = decision === 'approve' ? 'approved' : 'rejected'
  await svc
    .from('dms_workflow_run_steps')
    .update({
      status: stepStatus,
      completed_at: nowIso,
      rejected_reason: decision === 'reject' ? reasonText : null,
    })
    .eq('id', step.id)

  // 8. Audit log — internal decision + step completion.
  await svc.from('dms_workflow_audit_log').insert([
    {
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: step.id,
      actor_kind: 'user',
      actor_user_id: userId,
      action: decision === 'approve' ? 'internal_approved' : 'internal_rejected',
      details: {
        step: step.kind,
        name: step.name,
        reason: reasonText,
        by: userFullName,
      },
    },
    {
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: step.id,
      actor_kind: 'system',
      action: 'step_completed',
      details: { order_index: step.order_index, status: stepStatus },
    },
  ])

  // 9. Reject path — close out the run entirely.
  if (decision === 'reject') {
    await svc
      .from('dms_workflow_runs')
      .update({ status: 'rejected', completed_at: nowIso })
      .eq('id', run.id)

    await svc.from('dms_workflow_audit_log').insert({
      tenant_id: tenantId,
      run_id: run.id,
      actor_kind: 'system',
      action: 'workflow_rejected',
      details: { final_status: 'rejected', at_step: step.kind, by: userFullName },
    })

    fireN8nEvent('workflow.signer_rejected', {
      run_id: run.id,
      run_step_id: step.id,
      step_kind: step.kind,
      document_id: run.document_id,
      decision: 'reject',
      by: 'internal_user',
    }).catch((err) => console.error('[approveStepAsInternal] n8n reject event failed', err))

    revalidatePath(`/app/dms/workflows/${run.id}`)
    return { ok: true }
  }

  // 10. Approve path — find next step.
  const { data: nextStep } = await svc
    .from('dms_workflow_run_steps')
    .select('id, order_index, kind, name, signer_kind')
    .eq('tenant_id', tenantId)
    .eq('run_id', run.id)
    .gt('order_index', step.order_index)
    .order('order_index', { ascending: true })
    .limit(1)
    .maybeSingle()

  // Best-effort: fire the matching n8n event for the approve.
  try {
    const eventName =
      step.kind === 'final_approval'
        ? 'disbursement.approved'
        : step.kind === 'internal_review'
          ? 'disbursement.audit_completed'
          : 'disbursement.checklist_completed'
    await fireN8nEvent(eventName, {
      run_id: run.id,
      run_step_id: step.id,
      step_kind: step.kind,
      document_id: run.document_id,
      decision: 'approve',
      by: 'internal_user',
    })
  } catch (err) {
    console.error('[approveStepAsInternal] n8n event failed', err)
  }

  // 10b. No next step — workflow is complete.
  if (!nextStep) {
    await svc
      .from('dms_workflow_runs')
      .update({ status: 'completed', completed_at: nowIso })
      .eq('id', run.id)

    await svc.from('dms_workflow_audit_log').insert({
      tenant_id: tenantId,
      run_id: run.id,
      actor_kind: 'system',
      action: 'workflow_completed',
      details: { final_status: 'completed', by: userFullName },
    })

    revalidatePath(`/app/dms/workflows/${run.id}`)
    return { ok: true, workflow_completed: true }
  }

  // 11. Activate next step.
  await svc
    .from('dms_workflow_run_steps')
    .update({ status: 'awaiting', activated_at: nowIso })
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

  // 12. If next step is external + has a signer, mint a fresh upload/sign token.
  if (nextStep.signer_kind === 'external') {
    try {
      const { data: nextSigner } = await svc
        .from('dms_workflow_signers')
        .select('id, external_email')
        .eq('tenant_id', tenantId)
        .eq('run_step_id', nextStep.id)
        .maybeSingle()

      if (nextSigner) {
        const newToken = randomBytes(30).toString('base64url').slice(0, 40)
        await svc.from('dms_workflow_signer_tokens').insert({
          tenant_id: tenantId,
          signer_id: nextSigner.id,
          token: newToken,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          token_kind: 'sign',
        })
      }
    } catch (err) {
      console.error('[approveStepAsInternal] failed to mint token for next external signer', err)
    }
  }

  revalidatePath(`/app/dms/workflows/${run.id}`)
  return { ok: true, next_step_id: nextStep.id }
}
