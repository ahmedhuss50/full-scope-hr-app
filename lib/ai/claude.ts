/**
 * Anthropic Claude API thin wrapper.
 *
 * Single entry-point used by `lib/ai/analyze.ts` (mock fallback) and
 * `lib/agent/runWorkflowAgent.ts` (per-checklist-item calls). Centralizes:
 *   - lazy SDK construction (errors only when actually invoked)
 *   - default model + temperature
 *   - text extraction from a multi-block response
 *   - JSON parsing helper that tolerates surrounding prose
 */
import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _client
}

export interface ClaudeMessageOptions {
  model?: string
  maxTokens?: number
  systemPrompt?: string
  temperature?: number
}

export interface ClaudeResponse {
  text: string
  inputTokens: number
  outputTokens: number
  model: string
  durationMs: number
}

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5-20250929'

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export async function callClaude(
  prompt: string,
  opts: ClaudeMessageOptions = {},
): Promise<ClaudeResponse> {
  const start = Date.now()
  const client = getClient()
  const resp = await client.messages.create({
    model: opts.model ?? DEFAULT_CLAUDE_MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.3,
    system: opts.systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  })
  // Structural narrow — avoids depending on the SDK's exported sub-types,
  // which differ across 0.30.x patch versions.
  const text = resp.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
  return {
    text,
    inputTokens: resp.usage.input_tokens,
    outputTokens: resp.usage.output_tokens,
    model: resp.model,
    durationMs: Date.now() - start,
  }
}

/**
 * Parse a structured JSON response from Claude. Tolerates prose around the
 * JSON object (which Claude sometimes emits despite "JSON only" instructions).
 */
export function parseClaudeJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object found in Claude response')
  return JSON.parse(match[0]) as T
}

/**
 * Cost calculation for Claude Sonnet 4.5 — $3/MTok input, $15/MTok output.
 */
export function calcSonnet45CostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 3) / 1_000_000 + (outputTokens * 15) / 1_000_000
}
