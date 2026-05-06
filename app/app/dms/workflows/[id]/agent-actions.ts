'use server'
/**
 * Server actions backing the AgentPanel client component.
 *
 *   startAgentRun       — kicks off the synchronous agent run on a step.
 *                         (This server action can take 30+ seconds because it
 *                          calls Claude per checklist item; pages that import
 *                          it should set `export const maxDuration = 60`.)
 *   getAgentRunStatus   — read the latest snapshot of an agent_run + actions
 *                         (used by the panel's polling loop).
 *   listRecentAgentRuns — last 3 runs for a workflow run (history panel).
 */
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { runDisbursementAgent } from '@/lib/agent/runWorkflowAgent'

const StartSchema = z.object({
  run_id: z.string().uuid(),
  step_id: z.string().uuid(),
  confidence_threshold: z.number().min(0).max(1).optional(),
  auto_advance: z.boolean().optional(),
})

export async function startAgentRun(input: z.infer<typeof StartSchema>) {
  const parsed = StartSchema.safeParse(input)
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

  const result = await runDisbursementAgent({
    run_id: parsed.data.run_id,
    step_id: parsed.data.step_id,
    user_id: profile.id as string,
    confidence_threshold: parsed.data.confidence_threshold,
    auto_advance: parsed.data.auto_advance,
  })

  revalidatePath(`/app/dms/workflows/${parsed.data.run_id}`)
  return result.ok
    ? {
        ok: true as const,
        agent_run_id: result.agent_run_id!,
        filled: result.filled ?? 0,
        flagged: result.flagged ?? 0,
        advanced: result.advanced ?? false,
      }
    : { ok: false as const, error: result.error ?? 'Agent failed', agent_run_id: result.agent_run_id }
}

export interface AgentActionView {
  id: string
  order_index: number
  kind: string
  status: string
  target_kind: string | null
  target_id: string | null
  input_summary: string | null
  output_summary: string | null
  confidence: number | null
  reasoning: string | null
  occurred_at: string
}

export interface AgentRunView {
  id: string
  status: string
  model: string | null
  confidence_threshold: number | null
  auto_advance: boolean
  total_tokens_in: number | null
  total_tokens_out: number | null
  cost_usd: number | null
  started_at: string | null
  completed_at: string | null
  error_message: string | null
}

export async function getAgentRunStatus(agent_run_id: string): Promise<{
  ok: boolean
  run?: AgentRunView
  actions?: AgentActionView[]
  error?: string
}> {
  if (!agent_run_id) return { ok: false, error: 'Missing agent_run_id' }
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) return { ok: false, error: 'Profile not found' }
  const tenantId = profile.tenant_id as string

  const [runRes, actionsRes] = await Promise.all([
    svc
      .from('dms_workflow_agent_runs')
      .select(
        'id, status, model, confidence_threshold, auto_advance, total_tokens_in, total_tokens_out, cost_usd, started_at, completed_at, error_message',
      )
      .eq('tenant_id', tenantId)
      .eq('id', agent_run_id)
      .maybeSingle(),
    svc
      .from('dms_workflow_agent_actions')
      .select(
        'id, order_index, kind, status, target_kind, target_id, input_summary, output_summary, confidence, reasoning, occurred_at',
      )
      .eq('tenant_id', tenantId)
      .eq('agent_run_id', agent_run_id)
      .order('order_index', { ascending: true }),
  ])

  if (!runRes.data) return { ok: false, error: 'Agent run not found' }
  return {
    ok: true,
    run: runRes.data as AgentRunView,
    actions: (actionsRes.data ?? []) as AgentActionView[],
  }
}

export interface AgentRunHistoryView {
  id: string
  status: string
  started_at: string | null
  completed_at: string | null
  cost_usd: number | null
  auto_advance: boolean
}

export async function listRecentAgentRuns(
  run_id: string,
): Promise<{ ok: boolean; runs?: AgentRunHistoryView[]; error?: string }> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) return { ok: false, error: 'Profile not found' }
  const tenantId = profile.tenant_id as string

  const { data } = await svc
    .from('dms_workflow_agent_runs')
    .select('id, status, started_at, completed_at, cost_usd, auto_advance')
    .eq('tenant_id', tenantId)
    .eq('run_id', run_id)
    .order('started_at', { ascending: false })
    .limit(3)

  return { ok: true, runs: (data ?? []) as AgentRunHistoryView[] }
}
