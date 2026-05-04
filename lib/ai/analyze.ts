/**
 * Mock AI document-analysis stub for the DMS workflow demo.
 *
 * Returns realistic-looking analysis based on (doc_kind, stage_kind).
 * Future: replace with a real Claude API call. The shape of `AiAnalysisResult`
 * matches the `dms_workflow_ai_analyses` row contract (summary / key_points /
 * risk_flags / recommendation / confidence / model / raw_output) so the swap
 * is a one-function change.
 *
 * Plug-in point for the real Claude call: see the `// REAL_API:` block at the
 * bottom of `analyzeDocument`.
 */

export interface AiAnalysisInput {
  document_name: string
  doc_kind: string | null
  stage_kind: string
  client_name?: string
  prompt?: string
}

export interface AiAnalysisResult {
  summary: string
  key_points: string[]
  risk_flags: string[]
  recommendation: string
  confidence: number
  model: string
  raw_output?: Record<string, unknown>
}

type Branch = (input: AiAnalysisInput) => AiAnalysisResult

const branches: Record<string, Branch> = {
  'engagement_letter:intake': (i) => ({
    summary: `${i.client_name ?? 'The client'} engagement letter received. Standard SOCPA-compliant terms; fee and scope match proposal.`,
    key_points: [
      'Engagement scope aligned to original proposal.',
      'Fee schedule matches approved budget.',
      'Standard liability cap (3x fee) within firm policy.',
      'No non-standard clauses identified.',
    ],
    risk_flags: [],
    recommendation: 'Recommend approve and route to client signature.',
    confidence: 0.93,
    model: 'mock',
    raw_output: { mock: true, branch: 'engagement_letter:intake' },
  }),
  'engagement_letter:client_signature': (i) => ({
    summary: `Engagement letter for ${i.client_name ?? 'the client'} — standard SOCPA terms; safe to approve.`,
    key_points: [
      'Period and scope clearly defined.',
      'Fixed fee with monthly billing schedule.',
      'Standard SOCPA / ISA framework applies.',
      'No unusual clauses identified.',
    ],
    risk_flags: [],
    recommendation: 'No red flags identified. Safe to approve.',
    confidence: 0.92,
    model: 'mock',
    raw_output: { mock: true, branch: 'engagement_letter:client_signature' },
  }),
  'engagement_letter:internal_review': () => ({
    summary: 'Independent review confirms terms align with firm policy and client intent.',
    key_points: [
      'Counter-signature confirmed.',
      'Scope and fee match prior approvals.',
      'Liability cap consistent with firm policy.',
    ],
    risk_flags: [],
    recommendation: 'Recommend approve.',
    confidence: 0.94,
    model: 'mock',
    raw_output: { mock: true, branch: 'engagement_letter:internal_review' },
  }),
  'engagement_letter:final_approval': () => ({
    summary: 'Final partner sign-off. Engagement ready to commence.',
    key_points: [
      'All prior approvals consistent.',
      'Engagement may begin per agreed schedule.',
    ],
    risk_flags: [],
    recommendation: 'Approve and archive.',
    confidence: 0.97,
    model: 'mock',
    raw_output: { mock: true, branch: 'engagement_letter:final_approval' },
  }),
  'tax_return:intake': (i) => ({
    summary: `${i.client_name ?? 'Client'} ZATCA VAT return. Numbers tie to underlying workpapers.`,
    key_points: [
      'Output VAT matches schedule build.',
      'Input VAT ties to vendor invoices sampled.',
      'Net payable aligns with trial balance.',
      'ZATCA Phase 2 e-invoicing references included.',
    ],
    risk_flags: [],
    recommendation: 'Recommend approve.',
    confidence: 0.95,
    model: 'mock',
    raw_output: { mock: true, branch: 'tax_return:intake' },
  }),
  'tax_return:client_signature': (i) => ({
    summary: `VAT return for ${i.client_name ?? 'the client'} — net payable matches ledger.`,
    key_points: [
      'Filing covers a single VAT period.',
      'No reconciliation gaps vs. general ledger.',
      'ZATCA-ready format; no unusual entries.',
    ],
    risk_flags: [],
    recommendation: 'Safe to approve.',
    confidence: 0.94,
    model: 'mock',
    raw_output: { mock: true, branch: 'tax_return:client_signature' },
  }),
  'working_paper:internal_review': () => ({
    summary: 'Internal review flagged a variance between WIP balance and trial balance.',
    key_points: [
      'WIP balance per workpaper does not match trial balance.',
      'Likely cause: late vendor accruals not posted.',
      'Reconciliation required before sign-off.',
    ],
    risk_flags: ['unreconciled_variance', 'requires_rework'],
    recommendation: 'Recommend reject and request reconciliation.',
    confidence: 0.91,
    model: 'mock',
    raw_output: { mock: true, branch: 'working_paper:internal_review' },
  }),
}

function fallback(input: AiAnalysisInput): AiAnalysisResult {
  return {
    summary: `Document ${input.document_name} reviewed at ${input.stage_kind} stage.`,
    key_points: [
      'Document received and parsed.',
      'No structural anomalies detected.',
      'Pending human review.',
    ],
    risk_flags: [],
    recommendation: 'Proceed to manual review.',
    confidence: 0.85,
    model: 'mock',
    raw_output: { mock: true, branch: 'fallback' },
  }
}

/**
 * Generate a realistic-looking analysis for a document at a given workflow
 * stage. Mock-only for the demo; real Claude integration deferred to S30.
 */
export async function analyzeDocument(input: AiAnalysisInput): Promise<AiAnalysisResult> {
  const key = `${input.doc_kind ?? 'other'}:${input.stage_kind}`
  const branch = branches[key]
  if (branch) return branch(input)

  // REAL_API: replace the fallback below with a real Claude call.
  //
  // const resp = await fetch('https://api.anthropic.com/v1/messages', {
  //   method: 'POST',
  //   headers: {
  //     'x-api-key': process.env.ANTHROPIC_API_KEY!,
  //     'anthropic-version': '2023-06-01',
  //     'content-type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     model: 'claude-sonnet-4-5',
  //     max_tokens: 1024,
  //     system: 'You are an experienced KSA accounting-firm reviewer. Return strict JSON.',
  //     messages: [{ role: 'user', content: buildPrompt(input) }],
  //   }),
  // })
  // return parseClaudeResponse(await resp.json())

  return fallback(input)
}
