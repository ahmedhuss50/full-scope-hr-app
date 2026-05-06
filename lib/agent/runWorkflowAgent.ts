// Server-only module — invoked from server actions, not directly from client
// components. Uses service-role Supabase + the Anthropic SDK.
/**
 * Disbursement Workflow AI Agent — orchestrates Claude across the 19-item
 * checklist for a single workflow step.
 *
 * Flow:
 *   1. Insert dms_workflow_agent_runs row (status=running).
 *   2. Load run + step + uploads + 19 checklist items + existing responses.
 *   3. For every unanswered item, ask Claude. Insert agent_actions
 *      (kind='analyze_checklist_item') with reasoning + confidence.
 *      If confidence ≥ threshold, also write a checklist_responses row
 *      and an agent_actions row (kind='fill_checklist_response').
 *   4. After all items processed, if auto_advance is on AND every required
 *      item is 'verified' (no 'issue' anywhere), call signWorkflowStep
 *      to advance the stage.
 *   5. Mark agent_runs as completed (or failed on a top-level error).
 *
 * Hard safety: never auto-advance if ANY item ends as 'issue', regardless
 * of confidence settings.
 */
import { createSupabaseService } from '@/lib/supabase/server'
import { analyzeChecklistItem, CLAUDE_MODEL } from '@/lib/ai/analyze'
import { calcSonnet45CostUsd, isClaudeConfigured } from '@/lib/ai/claude'
import { fireN8nEvent } from '@/lib/integrations/n8n'

type AgentChecklistStatus =
  | 'verified'
  | 'issue'
  | 'not_mentioned'
  | 'not_attached'
  | 'pending'

export interface RunAgentInput {
  run_id: string
  step_id: string
  user_id: string
  confidence_threshold?: number
  auto_advance?: boolean
}

export interface RunAgentResult {
  ok: boolean
  agent_run_id?: string
  error?: string
  filled?: number
  flagged?: number
  advanced?: boolean
}

export async function runDisbursementAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const svc = createSupabaseService()
  const threshold = input.confidence_threshold ?? 0.85
  const autoAdvance = input.auto_advance ?? false

  // 0. Resolve tenant from the run (we trust the caller validated session).
  const { data: run } = await svc
    .from('dms_workflow_runs')
    .select('id, tenant_id, document_id, client_id, template_id, current_step_id')
    .eq('id', input.run_id)
    .maybeSingle()
  if (!run) return { ok: false, error: 'Workflow run not found' }
  const tenantId = run.tenant_id as string

  // 1. Create agent_run row.
  const { data: agentRunRow, error: createErr } = await svc
    .from('dms_workflow_agent_runs')
    .insert({
      tenant_id: tenantId,
      run_id: input.run_id,
      run_step_id: input.step_id,
      invoked_by_user_id: input.user_id,
      status: 'running',
      model: CLAUDE_MODEL,
      confidence_threshold: threshold,
      auto_advance: autoAdvance,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (createErr || !agentRunRow) {
    return { ok: false, error: createErr?.message ?? 'Could not create agent run' }
  }
  const agentRunId = agentRunRow.id as string
  let actionOrder = 0

  async function logAction(action: {
    kind: string
    status?: 'success' | 'failure' | 'skipped'
    target_kind?: string
    target_id?: string
    input_summary?: string
    output_summary?: string
    confidence?: number | null
    reasoning?: string
    prompt_tokens?: number
    completion_tokens?: number
    duration_ms?: number
  }) {
    actionOrder += 1
    await svc.from('dms_workflow_agent_actions').insert({
      tenant_id: tenantId,
      agent_run_id: agentRunId,
      order_index: actionOrder,
      kind: action.kind,
      status: action.status ?? 'success',
      target_kind: action.target_kind ?? null,
      target_id: action.target_id ?? null,
      input_summary: action.input_summary ?? null,
      output_summary: action.output_summary ?? null,
      confidence: action.confidence ?? null,
      reasoning: action.reasoning ?? null,
      prompt_tokens: action.prompt_tokens ?? null,
      completion_tokens: action.completion_tokens ?? null,
      duration_ms: action.duration_ms ?? null,
    })
  }

  // Fire start event (best-effort).
  fireN8nEvent('agent.started', {
    agent_run_id: agentRunId,
    run_id: input.run_id,
    step_id: input.step_id,
    threshold,
    auto_advance: autoAdvance,
  }).catch((e) => console.error('[agent] n8n start event failed', e))

  let totalIn = 0
  let totalOut = 0
  let filled = 0
  let flagged = 0

  try {
    if (!isClaudeConfigured()) {
      await logAction({
        kind: 'log_observation',
        status: 'skipped',
        output_summary:
          'ANTHROPIC_API_KEY not configured — falling back to mock suggestions for this run.',
      })
    }

    // 2. Load context.
    const [itemsRes, responsesRes, uploadsRes] = await Promise.all([
      svc
        .from('dms_workflow_checklist_items')
        .select('id, order_index, code, prompt_en, prompt_ar, required')
        .eq('tenant_id', tenantId)
        .eq('template_id', run.template_id)
        .order('order_index', { ascending: true }),
      svc
        .from('dms_workflow_checklist_responses')
        .select('id, checklist_item_id, status')
        .eq('tenant_id', tenantId)
        .eq('run_step_id', input.step_id),
      svc
        .from('dms_workflow_uploads')
        .select('id, filename, display_name, upload_kind, file_size_bytes')
        .eq('tenant_id', tenantId)
        .eq('run_id', input.run_id)
        .order('uploaded_at', { ascending: true }),
    ])

    const items = itemsRes.data ?? []
    const existing = responsesRes.data ?? []
    const uploads = uploadsRes.data ?? []

    await logAction({
      kind: 'read_document',
      target_kind: 'document',
      target_id: run.document_id ?? undefined,
      input_summary: `Loaded ${items.length} checklist items + ${uploads.length} uploaded documents`,
      output_summary: uploads.map((u) => u.display_name ?? u.filename).join(', '),
    })

    const existingByItem = new Map<string, AgentChecklistStatus>()
    for (const r of existing) {
      existingByItem.set(r.checklist_item_id as string, r.status as AgentChecklistStatus)
    }

    // 3. For each unanswered item, ask Claude.
    for (const item of items) {
      const itemId = item.id as string
      const code = (item.code ?? '') as string
      const existingStatus = existingByItem.get(itemId)
      if (existingStatus && existingStatus !== 'pending') {
        await logAction({
          kind: 'analyze_checklist_item',
          status: 'skipped',
          target_kind: 'checklist_item',
          target_id: itemId,
          input_summary: `Item ${item.order_index} (${code})`,
          output_summary: `Already answered: ${existingStatus} — skipping.`,
        })
        continue
      }

      const startMs = Date.now()
      try {
        const suggestion = await analyzeChecklistItem({
          code,
          prompt_en: item.prompt_en ?? undefined,
          prompt_ar: item.prompt_ar ?? undefined,
          run_id: input.run_id,
          documents: uploads.map((u) => ({
            filename: u.filename as string,
            display_name: u.display_name as string | null,
            upload_kind: u.upload_kind as string | null,
            file_size_bytes: u.file_size_bytes as number | null,
          })),
        })
        const durationMs = Date.now() - startMs

        // We don't get token counts from analyzeChecklistItem itself; estimate
        // by length to keep the running counter useful for the UI.
        const estIn = Math.ceil((item.prompt_en?.length ?? 0) / 4) + 200
        const estOut = Math.ceil(suggestion.notes.length / 4) + 30
        totalIn += estIn
        totalOut += estOut

        await logAction({
          kind: 'analyze_checklist_item',
          status: 'success',
          target_kind: 'checklist_item',
          target_id: itemId,
          input_summary: `Item ${item.order_index} (${code})`,
          output_summary: `Status=${suggestion.status} · conf=${Math.round(suggestion.confidence * 100)}%`,
          confidence: suggestion.confidence,
          reasoning: suggestion.notes,
          prompt_tokens: estIn,
          completion_tokens: estOut,
          duration_ms: durationMs,
        })

        if (suggestion.status === 'issue') flagged += 1
        else if (suggestion.confidence < threshold) flagged += 1

        if (suggestion.confidence >= threshold && suggestion.status !== 'pending') {
          // Auto-fill the response (upsert pattern matches checklist-actions.ts).
          const { data: existingRow } = await svc
            .from('dms_workflow_checklist_responses')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('run_step_id', input.step_id)
            .eq('checklist_item_id', itemId)
            .maybeSingle()

          if (existingRow) {
            await svc
              .from('dms_workflow_checklist_responses')
              .update({
                status: suggestion.status,
                notes: suggestion.notes,
                ai_suggested_status: suggestion.status,
                ai_suggested_notes: suggestion.notes,
                ai_confidence: suggestion.confidence,
                responded_by: input.user_id,
                responded_at: new Date().toISOString(),
              })
              .eq('id', existingRow.id)
          } else {
            await svc.from('dms_workflow_checklist_responses').insert({
              tenant_id: tenantId,
              run_step_id: input.step_id,
              checklist_item_id: itemId,
              status: suggestion.status,
              notes: suggestion.notes,
              ai_suggested_status: suggestion.status,
              ai_suggested_notes: suggestion.notes,
              ai_confidence: suggestion.confidence,
              responded_by: input.user_id,
              responded_at: new Date().toISOString(),
            })
          }

          await logAction({
            kind: 'fill_checklist_response',
            target_kind: 'checklist_item',
            target_id: itemId,
            input_summary: `Item ${item.order_index} (${code})`,
            output_summary: `Auto-filled with status=${suggestion.status} (conf ${Math.round(suggestion.confidence * 100)}% ≥ ${Math.round(threshold * 100)}%)`,
            confidence: suggestion.confidence,
          })
          filled += 1

          fireN8nEvent('agent.item_filled', {
            agent_run_id: agentRunId,
            run_id: input.run_id,
            step_id: input.step_id,
            checklist_item_id: itemId,
            status: suggestion.status,
            confidence: suggestion.confidence,
          }).catch(() => {})
        } else {
          await logAction({
            kind: 'log_observation',
            target_kind: 'checklist_item',
            target_id: itemId,
            input_summary: `Item ${item.order_index} (${code})`,
            output_summary: `Confidence ${Math.round(suggestion.confidence * 100)}% < ${Math.round(threshold * 100)}% threshold — flagged for human review.`,
            confidence: suggestion.confidence,
          })
        }

        // Update running cost / tokens on the agent_run.
        await svc
          .from('dms_workflow_agent_runs')
          .update({
            total_tokens_in: totalIn,
            total_tokens_out: totalOut,
            cost_usd: calcSonnet45CostUsd(totalIn, totalOut),
          })
          .eq('id', agentRunId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await logAction({
          kind: 'analyze_checklist_item',
          status: 'failure',
          target_kind: 'checklist_item',
          target_id: itemId,
          input_summary: `Item ${item.order_index} (${code})`,
          output_summary: `Claude call failed: ${msg.slice(0, 240)}`,
        })
        // continue with the next item
      }
    }

    // 4. Decide whether to auto-advance.
    let advanced = false
    if (autoAdvance) {
      // Re-load responses to get the post-fill picture.
      const { data: finalResponses } = await svc
        .from('dms_workflow_checklist_responses')
        .select('checklist_item_id, status')
        .eq('tenant_id', tenantId)
        .eq('run_step_id', input.step_id)
      const respByItem = new Map<string, AgentChecklistStatus>()
      for (const r of finalResponses ?? []) {
        respByItem.set(r.checklist_item_id as string, r.status as AgentChecklistStatus)
      }

      const requiredItems = items.filter((it) => it.required !== false)
      const allVerified = requiredItems.every(
        (it) => respByItem.get(it.id as string) === 'verified',
      )
      const anyIssue = (finalResponses ?? []).some((r) => r.status === 'issue')

      if (anyIssue) {
        await logAction({
          kind: 'log_observation',
          status: 'skipped',
          output_summary:
            "Will not auto-advance: at least one item is marked 'issue'. Human review required.",
        })
      } else if (!allVerified) {
        await logAction({
          kind: 'log_observation',
          status: 'skipped',
          output_summary: 'Will not auto-advance: not all required items are verified.',
        })
      } else {
        // Use the same advance-step logic by hand — we don't have a signer
        // token (this is the agent acting on behalf of the user). Mark step
        // approved + activate the next step + audit + n8n.
        await advanceStepAsAgent(svc, {
          tenantId,
          runId: input.run_id,
          stepId: input.step_id,
          userId: input.user_id,
        })
        advanced = true
        await logAction({
          kind: 'advance_stage',
          target_kind: 'step',
          target_id: input.step_id,
          output_summary: 'Stage approved by agent and next stage activated.',
        })
        fireN8nEvent('agent.stage_advanced', {
          agent_run_id: agentRunId,
          run_id: input.run_id,
          step_id: input.step_id,
        }).catch(() => {})
      }
    } else {
      await logAction({
        kind: 'log_observation',
        output_summary: 'Auto-advance disabled by user — leaving stage for human sign-off.',
      })
    }

    // 5. Mark complete.
    await svc
      .from('dms_workflow_agent_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        total_tokens_in: totalIn,
        total_tokens_out: totalOut,
        cost_usd: calcSonnet45CostUsd(totalIn, totalOut),
      })
      .eq('id', agentRunId)

    fireN8nEvent('agent.completed', {
      agent_run_id: agentRunId,
      run_id: input.run_id,
      step_id: input.step_id,
      filled,
      flagged,
      advanced,
      cost_usd: calcSonnet45CostUsd(totalIn, totalOut),
    }).catch(() => {})

    return { ok: true, agent_run_id: agentRunId, filled, flagged, advanced }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await svc
      .from('dms_workflow_agent_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: msg.slice(0, 1000),
      })
      .eq('id', agentRunId)
    fireN8nEvent('agent.failed', {
      agent_run_id: agentRunId,
      run_id: input.run_id,
      error: msg,
    }).catch(() => {})
    return { ok: false, agent_run_id: agentRunId, error: msg }
  }
}

/**
 * Mark a step approved on behalf of the agent + activate the next one.
 * Mirrors signWorkflowStep but bypasses the token / signer flow because
 * the agent is acting as an internal user.
 */
async function advanceStepAsAgent(
  svc: ReturnType<typeof createSupabaseService>,
  params: { tenantId: string; runId: string; stepId: string; userId: string },
) {
  const { tenantId, runId, stepId, userId } = params

  const { data: step } = await svc
    .from('dms_workflow_run_steps')
    .select('id, run_id, order_index, kind, name')
    .eq('id', stepId)
    .maybeSingle()
  if (!step) return

  // 1. Mark step approved.
  await svc
    .from('dms_workflow_run_steps')
    .update({
      status: 'approved',
      completed_at: new Date().toISOString(),
    })
    .eq('id', stepId)

  // 2. Find signer for this step (internal_user expected).
  const { data: signer } = await svc
    .from('dms_workflow_signers')
    .select('id')
    .eq('run_step_id', stepId)
    .maybeSingle()

  // 3. Insert signature row (decision=approve, by AI agent).
  if (signer) {
    await svc.from('dms_workflow_signatures').insert({
      tenant_id: tenantId,
      run_step_id: stepId,
      signer_id: signer.id,
      decision: 'approve',
      reason: 'Auto-approved by AI agent — all 19 items verified above confidence threshold.',
      signed_at: new Date().toISOString(),
    })
  }

  // 4. Audit log.
  await svc.from('dms_workflow_audit_log').insert({
    tenant_id: tenantId,
    run_id: runId,
    run_step_id: stepId,
    actor_kind: 'system',
    actor_user_id: userId,
    action: 'agent_approved_step',
    details: { step: step.kind, name: step.name, by: 'ai_agent' },
  })

  // 5. Find + activate next step.
  const { data: nextStep } = await svc
    .from('dms_workflow_run_steps')
    .select('id, order_index, kind, name, signer_kind')
    .eq('tenant_id', tenantId)
    .eq('run_id', runId)
    .gt('order_index', step.order_index)
    .order('order_index', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!nextStep) {
    await svc
      .from('dms_workflow_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', runId)
    await svc.from('dms_workflow_audit_log').insert({
      tenant_id: tenantId,
      run_id: runId,
      actor_kind: 'system',
      action: 'workflow_completed',
      details: { final_status: 'completed', by: 'ai_agent' },
    })
    return
  }

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
    .eq('id', runId)

  await svc.from('dms_workflow_audit_log').insert({
    tenant_id: tenantId,
    run_id: runId,
    run_step_id: nextStep.id,
    actor_kind: 'system',
    action: 'step_activated',
    details: { order_index: nextStep.order_index, name: nextStep.name, by: 'ai_agent' },
  })
}
