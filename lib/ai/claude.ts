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
 * A document attachment to send to Claude's PDF support.
 * Claude reads up to 100 pages / 32 MB per PDF.
 */
export interface DocumentAttachment {
  /** Raw bytes of the file. Will be base64-encoded for the API. */
  data: Buffer | Uint8Array
  /** Display name for logging only — not sent to the API. */
  filename: string
  /** MIME type. Defaults to 'application/pdf'. */
  mediaType?: string
}

/**
 * Call Claude with one or more attached PDF (or image) documents.
 *
 * Builds a mixed content array on the user turn:
 *   [ {type:'document', source:{type:'base64',media_type,data}} × N,
 *     {type:'text', text: prompt} ]
 *
 * The Anthropic SDK ≥ 0.30 accepts document blocks natively. We pass the
 * `pdfs-2024-09-25` beta header for older deployments as a belt-and-braces.
 */
export async function callClaudeWithDocuments(
  prompt: string,
  documents: DocumentAttachment[],
  opts: ClaudeMessageOptions = {},
): Promise<ClaudeResponse> {
  const start = Date.now()
  const client = getClient()

  const docBlocks = documents.map((doc) => {
    const buf = doc.data instanceof Buffer ? doc.data : Buffer.from(doc.data)
    return {
      type: 'document' as const,
      source: {
        type: 'base64' as const,
        media_type: (doc.mediaType ?? 'application/pdf') as 'application/pdf',
        data: buf.toString('base64'),
      },
    }
  })

  const content = [
    ...docBlocks,
    { type: 'text' as const, text: prompt },
  ]

  // The SDK's typings differ across 0.30.x — cast through `unknown` to
  // keep the call type-safe at the boundary while supporting document blocks.
  const resp = await client.messages.create({
    model: opts.model ?? DEFAULT_CLAUDE_MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.2,
    system: opts.systemPrompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [{ role: 'user', content } as any],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    betas: ['pdfs-2024-09-25'] as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

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
