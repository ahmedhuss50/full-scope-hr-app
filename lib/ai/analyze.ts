/**
 * AI document-analysis layer.
 *
 * Two paths:
 *   1. Real Claude — invoked when `ANTHROPIC_API_KEY` is set.
 *   2. Mock        — fallback for local dev / when the key is missing.
 *
 * Function signatures (`analyzeDocument`, `analyzeChecklistItem`) are
 * unchanged so all existing call sites work untouched. The `model` field
 * on the result tells you which path executed.
 */
import { callClaude, parseClaudeJson, isClaudeConfigured, DEFAULT_CLAUDE_MODEL } from './claude'

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

  // ----------------------------------------------------------------
  // Disbursement Document Review (Full Scope SOP, 4 stages)
  // ----------------------------------------------------------------
  'disbursement:intake': () => ({
    summary:
      'Uploaded 4 documents totalling 1,164,164 SAR. Disbursement #ST0026. Payee: Al-Sahel Construction Co. Project: Madra Plot 1. Construction-related expense. No obvious anomalies in initial review.',
    key_points: [
      'Bundle: contract + bill + proof of fund + bank statement.',
      'Disbursement #ST0026 — total 1,164,164 SAR.',
      'Payee: Al-Sahel Construction Co.',
      'Project: Madra Plot 1 (construction account).',
      'Bank statement opening balance: 5,732,914 SAR (Al Rajhi).',
      'No duplicate-payment or amount-mismatch flags surfaced.',
    ],
    risk_flags: [],
    recommendation: 'Recommend route to Admin Checklist Review (Stage 2).',
    confidence: 0.93,
    model: 'mock',
    raw_output: { mock: true, branch: 'disbursement:intake' },
  }),
  'disbursement:internal_review': () => ({
    summary:
      'Pre-filled 14 of 19 checklist items based on document contents. Flagged 5 items where supporting documentation is missing or not mentioned. Recommend admin verify items 5, 7, 17, 18, 19 manually before signing off.',
    key_points: [
      '14/19 items pre-filled with confidence ≥ 0.80.',
      '5 items require human verification (signatures, vendor ledger, invoice-date proximity).',
      'Construction account has sufficient balance (5,732,914 SAR vs 1,164,164 SAR draw).',
      'Beneficiary account matches contract.',
      'Total in disbursement document reconciles to invoice within 0.0%.',
    ],
    risk_flags: ['signatures_unverified', 'vendor_ledger_unconfirmed'],
    recommendation: 'Recommend admin review items 5, 7, 17, 18, 19 manually before sign-off.',
    confidence: 0.87,
    model: 'mock',
    raw_output: { mock: true, branch: 'disbursement:internal_review' },
  }),
  // Auditor stage uses the same enum kind 'internal_review' as admin; we
  // distinguish via the branch key only when the seed/action passes
  // doc_kind='disbursement_audit'. Fallback is the line above.
  'disbursement_audit:internal_review': () => ({
    summary:
      'Cross-validated admin’s responses. Concur on 17/19 items. Suggest second look at item 11 (progress percentage) — engineering estimate cited but not attached.',
    key_points: [
      'Independent re-verification: 17/19 items match admin assessment.',
      'Divergence on item 11 (PROGRESS_PERCENT): admin flagged issue (32% vs 28%); engineering estimate file still missing.',
      'Divergence on item 5 (INVOICE_DATE): admin marked not_mentioned; auditor reads partial date in margin.',
      'No new risk flags introduced beyond admin’s.',
      'Beneficiary account confirmed against contract Section 7.',
    ],
    risk_flags: ['progress_percent_unverified'],
    recommendation:
      'Recommend approve with note — request engineering estimate before owner sign-off.',
    confidence: 0.9,
    model: 'mock',
    raw_output: { mock: true, branch: 'disbursement_audit:internal_review' },
  }),
  'disbursement:final_approval': () => ({
    summary:
      'All 19 items resolved. Total disbursement 1,164,164 SAR within construction account budget. Recommend approve.',
    key_points: [
      'Admin and auditor agree on 17/19; remaining 2 carry documented notes.',
      'Construction account balance 5,732,914 SAR — draw represents 20.3% of available.',
      'Beneficiary account verified twice.',
      'No unresolved risk flags after auditor reconciliation.',
    ],
    risk_flags: [],
    recommendation: 'Approve and archive. Notify developer of payment release.',
    confidence: 0.96,
    model: 'mock',
    raw_output: { mock: true, branch: 'disbursement:final_approval' },
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

const DOC_SYSTEM_PROMPT =
  "You are a senior accountant at a Saudi accounting firm reviewing disbursement documents. " +
  'You evaluate compliance against a 19-point checklist. Respond with JSON only. Be concise. ' +
  'Use the document metadata provided. If a question cannot be answered from metadata alone, ' +
  "return status='not_mentioned' with low confidence."

interface ClaudeDocAnalysisJson {
  summary: string
  key_points?: string[]
  risk_flags?: string[]
  recommendation?: string
  confidence?: number
}

function buildDocPrompt(input: AiAnalysisInput): string {
  return [
    'Document metadata:',
    `- name: ${input.document_name}`,
    `- doc_kind: ${input.doc_kind ?? 'unknown'}`,
    `- stage: ${input.stage_kind}`,
    input.client_name ? `- client: ${input.client_name}` : null,
    input.prompt ? `\nStage prompt:\n${input.prompt}` : null,
    '',
    'Return JSON with keys: summary (string), key_points (array of strings),',
    'risk_flags (array of short snake_case codes), recommendation (string),',
    'confidence (number between 0 and 1).',
  ]
    .filter(Boolean)
    .join('\n')
}

async function analyzeDocumentWithClaude(input: AiAnalysisInput): Promise<AiAnalysisResult> {
  const resp = await callClaude(buildDocPrompt(input), {
    systemPrompt: DOC_SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 800,
  })
  const parsed = parseClaudeJson<ClaudeDocAnalysisJson>(resp.text)
  return {
    summary: parsed.summary ?? 'No summary returned.',
    key_points: Array.isArray(parsed.key_points) ? parsed.key_points : [],
    risk_flags: Array.isArray(parsed.risk_flags) ? parsed.risk_flags : [],
    recommendation: parsed.recommendation ?? '',
    confidence:
      typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1
        ? parsed.confidence
        : 0.7,
    model: resp.model,
    raw_output: {
      input_tokens: resp.inputTokens,
      output_tokens: resp.outputTokens,
      duration_ms: resp.durationMs,
    },
  }
}

/**
 * Generate a realistic-looking analysis for a document at a given workflow
 * stage. Real Claude when ANTHROPIC_API_KEY is set; mock fallback otherwise.
 */
export async function analyzeDocument(input: AiAnalysisInput): Promise<AiAnalysisResult> {
  if (isClaudeConfigured()) {
    try {
      return await analyzeDocumentWithClaude(input)
    } catch (err) {
      console.error('[analyzeDocument] Claude call failed, falling back to mock', err)
    }
  } else {
    console.warn('[analyzeDocument] ANTHROPIC_API_KEY missing — using mock analysis.')
  }

  const key = `${input.doc_kind ?? 'other'}:${input.stage_kind}`
  const branch = branches[key]
  if (branch) return branch(input)
  return fallback(input)
}

// ----------------------------------------------------------------
// Per-checklist-item AI suggestion
// ----------------------------------------------------------------

export type ChecklistItemStatus =
  | 'verified'
  | 'issue'
  | 'not_mentioned'
  | 'not_attached'
  | 'pending'

export interface ChecklistItemSuggestion {
  status: ChecklistItemStatus
  notes: string
  confidence: number
  model: string
}

export interface AnalyzeChecklistItemInput {
  /** Stable code like 'DOC_SEQUENCE'. Drives the suggestion table below. */
  code: string
  /** English prompt — used as fallback if no `code` match. */
  prompt_en?: string
  /** Arabic prompt — included in the model context when present. */
  prompt_ar?: string
  /** Optional snippet of document text the model would have seen. */
  document_excerpt?: string
  /** Run id — used as the cache partition so per-run answers remain stable. */
  run_id?: string
  /** Lightweight metadata describing what was uploaded for this run. */
  documents?: Array<{
    filename: string
    display_name?: string | null
    upload_kind?: string | null
    file_size_bytes?: number | null
  }>
}

/**
 * Mock per-item suggestion for the 19-item disbursement checklist.
 * Returns the canonical AI guess for the demo; in production this would
 * be a per-item Claude call with the relevant document excerpt.
 *
 * Items not in the table fall back to { pending, low confidence } so the UI
 * still renders something but the admin must answer manually.
 */
const CHECKLIST_SUGGESTIONS: Record<string, ChecklistItemSuggestion> = {
  DOC_SEQUENCE:        { status: 'verified',      notes: 'Sequence ST0026 detected; prior ST0025 referenced.',                     confidence: 0.96, model: 'mock' },
  DOC_DATE:            { status: 'not_mentioned', notes: 'No explicit issue date in document body; footer print date only.',       confidence: 0.78, model: 'mock' },
  OPENING_BALANCE:     { status: 'verified',      notes: 'Opening balance reconciles to prior document closing.',                  confidence: 0.91, model: 'mock' },
  INVOICE_CLIENT:      { status: 'verified',      notes: 'Client name on invoice: Madra Developers.',                              confidence: 0.94, model: 'mock' },
  INVOICE_DATE:        { status: 'verified',      notes: 'Invoice dated within 14 days of disbursement document.',                 confidence: 0.62, model: 'mock' },
  INVOICE_NOT_PAID:    { status: 'verified',      notes: 'No prior payment record located for invoice number.',                    confidence: 0.88, model: 'mock' },
  INVOICE_RECORDED:    { status: 'not_attached',  notes: 'Vendor ledger snapshot not present in upload bundle.',                   confidence: 0.84, model: 'mock' },
  SERVICE_RECEIVED:    { status: 'pending',       notes: 'Cannot verify from documents alone — site engineer confirmation needed.', confidence: 0.30, model: 'mock' },
  CONTRACT_PRICES:     { status: 'verified',      notes: 'Invoice unit prices align with contract pricing schedule.',              confidence: 0.95, model: 'mock' },
  TOTAL_RECALC:        { status: 'verified',      notes: 'Line-item recomputation matches stated total: 1,164,164 SAR.',           confidence: 0.99, model: 'mock' },
  PROGRESS_PERCENT:    { status: 'pending',       notes: 'Engineering estimate not attached; cannot verify automatically.',         confidence: 0.55, model: 'mock' },
  ACCOUNT_SUFFICIENCY: { status: 'verified',      notes: 'Construction account balance 5,732,914 SAR — sufficient for draw of 1,164,164 SAR.', confidence: 0.97, model: 'mock' },
  BENEFICIARY_ACCOUNT: { status: 'verified',      notes: 'Beneficiary account on disbursement matches contract Section 7.',        confidence: 0.93, model: 'mock' },
  GUARANTEE_ACCOUNT:   { status: 'verified',      notes: 'Guarantee account reference present and matches escrow agreement.',      confidence: 0.86, model: 'mock' },
  EXPENSE_NATURE:      { status: 'verified',      notes: 'Construction-related expense; sourced from construction account (correct).', confidence: 0.92, model: 'mock' },
  TOTAL_VS_INVOICES:   { status: 'verified',      notes: 'Disbursement total reconciles exactly to single attached invoice.',      confidence: 0.99, model: 'mock' },
  DEVELOPER_REVIEW:    { status: 'pending',       notes: 'Signature image present but cannot match to specimen automatically.',    confidence: 0.40, model: 'mock' },
  ENGINEER_APPROVAL:   { status: 'pending',       notes: 'Engineering supervisor signature present; specimen comparison needed.',  confidence: 0.42, model: 'mock' },
  AUTHORIZED_PAYMENT:  { status: 'pending',       notes: 'Authorized signatories listed; manual verification of authority required.', confidence: 0.45, model: 'mock' },
}

// Process-local cache: per (run_id, item_code) we only ask Claude once.
// Survives only the lifetime of the Node process — fine for a single
// agent run; for true persistence we'd serialize into a Supabase column.
const CHECKLIST_CACHE = new Map<string, ChecklistItemSuggestion>()

interface ClaudeChecklistJson {
  status?: ChecklistItemStatus
  reasoning?: string
  notes?: string
  confidence?: number
}

const CHECKLIST_SYSTEM_PROMPT =
  "You are a senior accountant at a Saudi accounting firm reviewing disbursement documents. " +
  'You evaluate compliance against a 19-point checklist. Respond with JSON only. Be concise. ' +
  'Use the document metadata provided. If a question cannot be answered from metadata alone, ' +
  "return status='not_mentioned' with low confidence."

function buildChecklistPrompt(input: AnalyzeChecklistItemInput): string {
  const docs = (input.documents ?? [])
    .map(
      (d) =>
        `  - ${d.display_name ?? d.filename} (filename=${d.filename}, kind=${d.upload_kind ?? 'unknown'})`,
    )
    .join('\n')
  return [
    `Checklist item code: ${input.code}`,
    input.prompt_en ? `Question (EN): ${input.prompt_en}` : null,
    input.prompt_ar ? `Question (AR): ${input.prompt_ar}` : null,
    '',
    'Documents available in this disbursement bundle:',
    docs || '  (no documents attached)',
    '',
    "Return JSON with these exact keys:",
    "  status: one of 'verified' | 'issue' | 'not_mentioned' | 'not_attached' | 'pending'",
    "  reasoning: short explanation (max 2 sentences) of how you reached this decision",
    "  confidence: number between 0 and 1",
  ]
    .filter(Boolean)
    .join('\n')
}

async function analyzeChecklistItemWithClaude(
  input: AnalyzeChecklistItemInput,
): Promise<ChecklistItemSuggestion> {
  const resp = await callClaude(buildChecklistPrompt(input), {
    systemPrompt: CHECKLIST_SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 350,
  })
  const parsed = parseClaudeJson<ClaudeChecklistJson>(resp.text)
  const validStatuses: ChecklistItemStatus[] = [
    'verified', 'issue', 'not_mentioned', 'not_attached', 'pending',
  ]
  const status: ChecklistItemStatus = validStatuses.includes(parsed.status as ChecklistItemStatus)
    ? (parsed.status as ChecklistItemStatus)
    : 'pending'
  return {
    status,
    notes: parsed.reasoning ?? parsed.notes ?? '',
    confidence:
      typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1
        ? parsed.confidence
        : 0.5,
    model: resp.model,
  }
}

/**
 * Generate an AI suggestion for a single checklist item.
 * Real Claude when ANTHROPIC_API_KEY is set; mock fallback otherwise.
 * Cached per (run_id, item_code) within the process to avoid duplicate work.
 */
export async function analyzeChecklistItem(
  input: AnalyzeChecklistItemInput,
): Promise<ChecklistItemSuggestion> {
  const cacheKey = `${input.run_id ?? 'no-run'}:${input.code}`
  const cached = CHECKLIST_CACHE.get(cacheKey)
  if (cached) return cached

  if (isClaudeConfigured()) {
    try {
      const live = await analyzeChecklistItemWithClaude(input)
      CHECKLIST_CACHE.set(cacheKey, live)
      return live
    } catch (err) {
      console.error('[analyzeChecklistItem] Claude call failed, falling back to mock', err)
    }
  } else {
    console.warn('[analyzeChecklistItem] ANTHROPIC_API_KEY missing — using mock suggestion.')
  }

  const hit = CHECKLIST_SUGGESTIONS[input.code]
  const result: ChecklistItemSuggestion = hit ?? {
    status: 'pending',
    notes: 'AI could not auto-evaluate this item; please answer manually.',
    confidence: 0.3,
    model: 'mock',
  }
  CHECKLIST_CACHE.set(cacheKey, result)
  return result
}

/** Surface the default Claude model for callers that need it for logging. */
export const CLAUDE_MODEL = DEFAULT_CLAUDE_MODEL
