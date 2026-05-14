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
import { CLAUDE_MODEL } from '@/lib/ai/analyze'
import {
  callClaude,
  callClaudeWithDocuments,
  parseClaudeJson,
  calcSonnet45CostUsd,
  isClaudeConfigured,
  type DocumentAttachment,
} from '@/lib/ai/claude'
import { fireN8nEvent } from '@/lib/integrations/n8n'

// Storage bucket where developer uploads land (see app/upload/[token]/actions.ts).
const STORAGE_BUCKET = 'Document submission'

// Batch-analyze all 19 checklist items in ONE Claude call. Much faster + cheaper
// than the per-item loop (well under Vercel's 60-sec function timeout).
interface BatchSuggestion {
  code: string
  status: 'verified' | 'issue' | 'not_mentioned' | 'not_attached' | 'pending'
  notes: string
  confidence: number
  /** Exact phrase/value from the document supporting the verdict, if any. */
  evidence?: string
}

async function batchAnalyzeAllItems(args: {
  items: Array<{ code: string; prompt_en: string | null; prompt_ar: string | null; order_index: number }>
  documents: Array<{ filename: string; display_name: string | null; upload_kind: string | null; file_size_bytes: number | null }>
  /** Optional PDF byte buffers; when present the agent will actually READ them. */
  attachments?: DocumentAttachment[]
}): Promise<{ suggestions: BatchSuggestion[]; tokensIn: number; tokensOut: number; durationMs: number }> {
  if (!isClaudeConfigured() || args.items.length === 0) {
    return { suggestions: [], tokensIn: 0, tokensOut: 0, durationMs: 0 }
  }

  const docList = args.documents
    .map((d, i) => `  ${i + 1}. ${d.display_name ?? d.filename} (${d.upload_kind ?? 'other'}, ${d.file_size_bytes ?? 0} bytes)`)
    .join('\n')

  const itemList = args.items
    .map((it) => `${it.order_index}. [${it.code}] ${it.prompt_en ?? it.prompt_ar ?? ''}`)
    .join('\n')

  const hasAttachments = (args.attachments?.length ?? 0) > 0

  const attachmentBlurb = hasAttachments
    ? `Attached are the developer's uploaded documents (PDF). Read them carefully — quote the exact text or numbers that prove (or disprove) each checklist item.`
    : `Only document metadata is available — no PDF bytes were attached. Be conservative: prefer "not_mentioned" over fabrication.`

  const prompt = `You are a senior accountant at a Saudi accounting firm reviewing a disbursement document.
A real estate developer has submitted these supporting documents:
${docList}

${attachmentBlurb}

For each of the following ${args.items.length} review checklist items, return:
- status: "verified" | "issue" | "not_mentioned" | "not_attached"
- notes:  brief reasoning (<40 words). When status="verified", quote the specific text/number from the document.
- confidence: number between 0 and 1
- evidence: the exact phrase/value from the document that proves the verdict, or "" if not available

Status options:
- "verified": item passes (you have evidence it's correct)
- "issue": item fails or is suspicious
- "not_mentioned": item not addressed in the documents
- "not_attached": supporting document for this item is not attached

Checklist:
${itemList}

Respond with ONLY a JSON object in this exact shape (no extra text, no markdown):
{
  "suggestions": [
    { "code": "DOC_SEQUENCE", "status": "verified", "notes": "Document sequence number is ST0026.", "evidence": "رقم الوثيقة: ST0026", "confidence": 0.95 },
    ...one entry per checklist code, in order...
  ]
}`

  const systemPrompt =
    'You are a precise compliance reviewer. Always return valid JSON only. ' +
    'When a PDF is attached, ground every verdict in the actual document text — quote it in the "evidence" field. ' +
    'Be conservative: when in doubt, mark items as not_mentioned with low confidence rather than fabricating verification.'

  const resp = hasAttachments
    ? await callClaudeWithDocuments(prompt, args.attachments!, {
        maxTokens: 4096,
        temperature: 0.2,
        systemPrompt,
      })
    : await callClaude(prompt, {
        maxTokens: 4096,
        temperature: 0.2,
        systemPrompt,
      })

  const parsed = parseClaudeJson<{ suggestions: BatchSuggestion[] }>(resp.text)
  return {
    suggestions: parsed.suggestions ?? [],
    tokensIn: resp.inputTokens,
    tokensOut: resp.outputTokens,
    durationMs: resp.durationMs,
  }
}

/**
 * Fetch each upload's PDF bytes from Supabase Storage. Failures are tolerated
 * and logged — when ALL fail we fall back to metadata-only analysis.
 */
async function fetchUploadAttachments(
  svc: ReturnType<typeof createSupabaseService>,
  uploads: Array<{
    id: string
    filename: string
    display_name: string | null
    upload_kind: string | null
    storage_path: string | null
    storage_bucket: string | null
    mime_type: string | null
  }>,
  logFailure: (filename: string, reason: string) => Promise<void>,
  logSuccess: (filename: string, bytes: number) => Promise<void>,
): Promise<DocumentAttachment[]> {
  const out: DocumentAttachment[] = []
  for (const u of uploads) {
    const filename = u.display_name ?? u.filename
    if (!u.storage_path) {
      await logFailure(filename, 'storage_path is null — file was never uploaded to storage')
      continue
    }
    const bucket = u.storage_bucket ?? STORAGE_BUCKET
    try {
      const { data, error } = await svc.storage.from(bucket).download(u.storage_path)
      if (error || !data) {
        await logFailure(filename, error?.message ?? 'empty download response')
        continue
      }
      const arrayBuf = await data.arrayBuffer()
      const buf = Buffer.from(arrayBuf)
      // PDFs only — silently skip non-PDFs (Claude only supports PDFs + images here).
      const mime = u.mime_type ?? 'application/pdf'
      if (!mime.includes('pdf')) {
        await logFailure(filename, `unsupported mime_type ${mime} — only PDFs are sent to Claude`)
        continue
      }
      await logSuccess(filename, buf.length)
      out.push({ data: buf, filename, mediaType: 'application/pdf' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await logFailure(filename, msg)
    }
  }
  return out
}

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
        .select('id, filename, display_name, upload_kind, file_size_bytes, storage_path, storage_bucket, mime_type')
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

    // 2b. Attempt to download each upload's PDF bytes so Claude can READ them.
    //     When storage_path is null (seed data) or the file is missing we fall
    //     back to metadata-only analysis.
    let attachments: DocumentAttachment[] = []
    if (isClaudeConfigured() && uploads.length > 0) {
      attachments = await fetchUploadAttachments(
        svc,
        uploads.map((u) => ({
          id: u.id as string,
          filename: u.filename as string,
          display_name: (u.display_name ?? null) as string | null,
          upload_kind: (u.upload_kind ?? null) as string | null,
          storage_path: (u.storage_path ?? null) as string | null,
          storage_bucket: (u.storage_bucket ?? null) as string | null,
          mime_type: (u.mime_type ?? null) as string | null,
        })),
        async (filename, reason) => {
          await logAction({
            kind: 'read_document',
            status: 'failure',
            target_kind: 'upload',
            input_summary: `Download: ${filename}`,
            output_summary: `File not in storage — analyzing metadata only. (${reason.slice(0, 200)})`,
          })
        },
        async (filename, bytes) => {
          await logAction({
            kind: 'read_document',
            status: 'success',
            target_kind: 'upload',
            input_summary: `Download: ${filename}`,
            output_summary: `Loaded ${bytes} bytes from storage; will send to Claude as PDF attachment.`,
          })
        },
      )

      if (attachments.length === 0 && uploads.length > 0) {
        await logAction({
          kind: 'log_observation',
          status: 'skipped',
          output_summary:
            'No PDFs could be loaded from storage for this run. Falling back to filename-only analysis.',
        })
      } else if (attachments.length > 0) {
        await logAction({
          kind: 'log_observation',
          output_summary: `Attached ${attachments.length} of ${uploads.length} PDFs to the Claude call.`,
        })
      }
    }

    const existingByItem = new Map<string, AgentChecklistStatus>()
    for (const r of existing) {
      existingByItem.set(r.checklist_item_id as string, r.status as AgentChecklistStatus)
    }

    // 3. Filter to items that need analysis (skip already-answered ones).
    const itemsToAnalyze = items.filter((item) => {
      const existing = existingByItem.get(item.id as string)
      return !existing || existing === 'pending'
    })

    // Log skipped items for transparency.
    for (const item of items) {
      const existing = existingByItem.get(item.id as string)
      if (existing && existing !== 'pending') {
        await logAction({
          kind: 'analyze_checklist_item',
          status: 'skipped',
          target_kind: 'checklist_item',
          target_id: item.id as string,
          input_summary: `Item ${item.order_index} (${item.code ?? ''})`,
          output_summary: `Already answered: ${existing} — skipping.`,
        })
      }
    }

    // 3a. ONE batched Claude call for all unanswered items. ~5-10 sec total.
    let suggestionsByCode = new Map<string, BatchSuggestion>()
    if (itemsToAnalyze.length > 0) {
      try {
        const batchStart = Date.now()
        const batch = await batchAnalyzeAllItems({
          items: itemsToAnalyze.map((it) => ({
            code: (it.code ?? '') as string,
            prompt_en: (it.prompt_en ?? null) as string | null,
            prompt_ar: (it.prompt_ar ?? null) as string | null,
            order_index: it.order_index as number,
          })),
          documents: uploads.map((u) => ({
            filename: u.filename as string,
            display_name: u.display_name as string | null,
            upload_kind: u.upload_kind as string | null,
            file_size_bytes: u.file_size_bytes as number | null,
          })),
          attachments: attachments.length > 0 ? attachments : undefined,
        })
        for (const s of batch.suggestions) suggestionsByCode.set(s.code, s)
        totalIn += batch.tokensIn
        totalOut += batch.tokensOut

        await logAction({
          kind: 'log_observation',
          input_summary: `Batched Claude call for ${itemsToAnalyze.length} items`,
          output_summary: `Returned ${batch.suggestions.length} suggestions in ${batch.durationMs}ms (${batch.tokensIn} in / ${batch.tokensOut} out)`,
          duration_ms: batch.durationMs,
          prompt_tokens: batch.tokensIn,
          completion_tokens: batch.tokensOut,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await logAction({
          kind: 'log_observation',
          status: 'failure',
          input_summary: 'Batched Claude call',
          output_summary: `Claude call failed: ${msg.slice(0, 240)}. Falling back to mock suggestions per item.`,
        })
        // suggestionsByCode stays empty — per-item handling below treats as no suggestion
      }
    }

    // 3b. Process each item — write response if confidence high enough.
    for (const item of itemsToAnalyze) {
      const itemId = item.id as string
      const code = (item.code ?? '') as string
      const suggestion = suggestionsByCode.get(code)

      // If Claude didn't return this code (failure or empty), fall back to a "needs review" placeholder.
      const status = suggestion?.status ?? 'not_mentioned'
      const baseReasoning =
        suggestion?.notes ?? 'AI could not analyze this item — flagged for human review.'
      const evidence = (suggestion?.evidence ?? '').trim()
      // Combine reasoning + evidence in the notes column so the ChecklistTable
      // UI can render the evidence block. Format is stable: a blank line then
      // "Evidence: <quote>". The UI parses on this prefix.
      const notes = evidence
        ? `${baseReasoning}\n\nEvidence: ${evidence}`
        : baseReasoning
      const confidence = suggestion?.confidence ?? 0.3

      await logAction({
        kind: 'analyze_checklist_item',
        status: 'success',
        target_kind: 'checklist_item',
        target_id: itemId,
        input_summary: `Item ${item.order_index} (${code})`,
        output_summary: `Status=${status} · conf=${Math.round(confidence * 100)}%`,
        confidence,
        reasoning: notes,
      })

      if (status === 'issue') flagged += 1
      else if (confidence < threshold) flagged += 1

      if (confidence >= threshold && status !== 'pending') {
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
              status,
              notes,
              ai_suggested_status: status,
              ai_suggested_notes: notes,
              ai_confidence: confidence,
              responded_by: input.user_id,
              responded_at: new Date().toISOString(),
            })
            .eq('id', existingRow.id)
        } else {
          await svc.from('dms_workflow_checklist_responses').insert({
            tenant_id: tenantId,
            run_step_id: input.step_id,
            checklist_item_id: itemId,
            status,
            notes,
            ai_suggested_status: status,
            ai_suggested_notes: notes,
            ai_confidence: confidence,
            responded_by: input.user_id,
            responded_at: new Date().toISOString(),
          })
        }

        await logAction({
          kind: 'fill_checklist_response',
          target_kind: 'checklist_item',
          target_id: itemId,
          input_summary: `Item ${item.order_index} (${code})`,
          output_summary: `Auto-filled with status=${status} (conf ${Math.round(confidence * 100)}% ≥ ${Math.round(threshold * 100)}%)`,
          confidence,
        })
        filled += 1

        fireN8nEvent('agent.item_filled', {
          agent_run_id: agentRunId,
          run_id: input.run_id,
          step_id: input.step_id,
          checklist_item_id: itemId,
          status,
          confidence,
        }).catch(() => {})
      } else {
        await logAction({
          kind: 'log_observation',
          target_kind: 'checklist_item',
          target_id: itemId,
          input_summary: `Item ${item.order_index} (${code})`,
          output_summary: `Confidence ${Math.round(confidence * 100)}% < ${Math.round(threshold * 100)}% threshold — flagged for human review.`,
          confidence,
        })
      }
    }

    // Update running cost / tokens on the agent_run (single update at end of batch).
    await svc
      .from('dms_workflow_agent_runs')
      .update({
        total_tokens_in: totalIn,
        total_tokens_out: totalOut,
        cost_usd: calcSonnet45CostUsd(totalIn, totalOut),
      })
      .eq('id', agentRunId)

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
