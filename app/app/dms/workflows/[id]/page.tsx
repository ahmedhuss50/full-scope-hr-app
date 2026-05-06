import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CheckCircle2, XCircle, Circle, Clock, Sparkles, ShieldAlert, ExternalLink, Mail, FileText, Upload as UploadIcon } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import {
  statusChipClasses, stepStatusChipClasses, statusLabel, stepStatusLabel, stageLabel,
  fmtDateTime, pickOne,
  type WorkflowRunStatus, type WorkflowStepStatus, type WorkflowStageKind, type WorkflowSignerKind,
} from '../_shared'
import { CopyLinkButton } from '../CopyLinkButton'
import { ChecklistTable, type ChecklistRow, type ChecklistStatus } from './ChecklistTable'
import { AgentPanel } from './AgentPanel'

export const dynamic = 'force-dynamic'
// Agent run can take 30+ seconds (Claude latency × 19 items). Vercel Hobby
// caps server actions at 10s by default; pin this segment higher.
export const maxDuration = 60

const DISBURSEMENT_TEMPLATE_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type RunRow = {
  id: string
  status: WorkflowRunStatus
  started_at: string
  completed_at: string | null
  notes: string | null
  current_step_id: string | null
  document_id: string
  client_id: string | null
  template_id: string | null
  document: { id: string; display_name: string | null; filename: string; doc_kind: string | null } | { id: string; display_name: string | null; filename: string; doc_kind: string | null }[] | null
  client: { id: string; name: string } | { id: string; name: string }[] | null
  template: { name: string } | { name: string }[] | null
  initiator: { full_name: string | null } | { full_name: string | null }[] | null
}

type StepRow = {
  id: string
  order_index: number
  kind: WorkflowStageKind
  name: string
  signer_kind: WorkflowSignerKind
  status: WorkflowStepStatus
  activated_at: string | null
  completed_at: string | null
  rejected_reason: string | null
}

type SignerRow = {
  id: string
  run_step_id: string
  signer_kind: WorkflowSignerKind
  external_name: string | null
  external_email: string | null
  external_role: string | null
  internal_user_id: string | null
  notify_sent_at: string | null
  internal_user: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null
}

type TokenRow = {
  signer_id: string
  token: string
  expires_at: string
  used_at: string | null
  view_count: number
  token_kind?: string | null
}

type SignatureRow = {
  run_step_id: string
  signer_id: string
  decision: 'approve' | 'reject'
  reason: string | null
  signed_at: string
  signer: { external_name: string | null; internal_user: { full_name: string | null } | { full_name: string | null }[] | null } | { external_name: string | null; internal_user: { full_name: string | null } | { full_name: string | null }[] | null }[] | null
}

type AnalysisRow = {
  id: string
  run_step_id: string | null
  model: string | null
  summary: string
  key_points: string[] | null
  risk_flags: string[] | null
  recommendation: string | null
  confidence: number | null
  generated_at: string
}

type AuditRow = {
  id: string
  run_step_id: string | null
  actor_kind: string
  actor_user_id: string | null
  actor_signer_id: string | null
  action: string
  details: Record<string, unknown> | null
  occurred_at: string
  actor: { full_name: string | null } | { full_name: string | null }[] | null
}

type ChecklistItemRow = {
  id: string
  template_id: string
  order_index: number
  code: string | null
  prompt_en: string
  prompt_ar: string
  ai_check_capable: boolean
}

type ChecklistResponseRow = {
  id: string
  run_step_id: string
  checklist_item_id: string
  status: ChecklistStatus
  notes: string | null
  ai_suggested_status: ChecklistStatus | null
  ai_suggested_notes: string | null
  ai_confidence: number | null
}

type UploadRow = {
  id: string
  run_step_id: string | null
  filename: string
  display_name: string | null
  upload_kind: string | null
  storage_path: string | null
  file_size_bytes: number | null
  mime_type: string | null
  uploaded_at: string
}

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
}

function describeAuditEvent(e: AuditRow, locale: Locale): { who: string; what: string } {
  const actor = pickOne(e.actor)
  const details = e.details ?? {}
  const signerName = (details as { signer?: string }).signer
  const email = (details as { email?: string }).email

  const who =
    e.actor_kind === 'external_signer' ? (signerName ?? email ?? tServer('sign.signing_as', locale, { name: '', email: '' }).trim()) :
    actor?.full_name ?? (e.actor_kind === 'system' ? 'System' : '—')

  const what = tServer(`workflows.event.${e.action}` as StringKey, locale)
  return { who, what: what === `workflows.event.${e.action}` ? e.action : what }
}

export default async function WorkflowDetailPage({ params }: { params: { id: string } }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id, locale')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) return null

  const tenantId = profile.tenant_id as string
  const locale = ((profile.locale as Locale) ?? 'ar')

  const runRes = await svc
    .from('dms_workflow_runs')
    .select(`
      id, status, started_at, completed_at, notes, current_step_id, document_id, client_id, template_id,
      document:dms_documents!document_id(id, display_name, filename, doc_kind),
      client:clients!client_id(id, name),
      template:dms_workflow_templates!template_id(name),
      initiator:users!initiated_by(full_name)
    `)
    .eq('tenant_id', tenantId)
    .eq('id', params.id)
    .maybeSingle()

  const run = (runRes.data ?? null) as unknown as RunRow | null
  if (!run) notFound()

  const [stepsRes, analysesRes, auditRes] = await Promise.all([
    svc
      .from('dms_workflow_run_steps')
      .select('id, order_index, kind, name, signer_kind, status, activated_at, completed_at, rejected_reason')
      .eq('tenant_id', tenantId)
      .eq('run_id', params.id)
      .order('order_index', { ascending: true }),
    svc
      .from('dms_workflow_ai_analyses')
      .select('id, run_step_id, model, summary, key_points, risk_flags, recommendation, confidence, generated_at')
      .eq('tenant_id', tenantId)
      .eq('run_id', params.id),
    svc
      .from('dms_workflow_audit_log')
      .select(`
        id, run_step_id, actor_kind, actor_user_id, actor_signer_id, action, details, occurred_at,
        actor:users!actor_user_id(full_name)
      `)
      .eq('tenant_id', tenantId)
      .eq('run_id', params.id)
      .order('occurred_at', { ascending: false })
      .limit(15),
  ])

  const steps = (stepsRes.data ?? []) as StepRow[]
  const stepIds = steps.map((s) => s.id)
  const stepIdsForQuery = stepIds.length > 0 ? stepIds : ['00000000-0000-0000-0000-000000000000']

  const [signersRes, signaturesRes] = await Promise.all([
    svc
      .from('dms_workflow_signers')
      .select(`
        id, run_step_id, signer_kind, external_name, external_email, external_role,
        internal_user_id, notify_sent_at,
        internal_user:users!internal_user_id(full_name, email)
      `)
      .eq('tenant_id', tenantId)
      .in('run_step_id', stepIdsForQuery),
    svc
      .from('dms_workflow_signatures')
      .select(`
        run_step_id, signer_id, decision, reason, signed_at,
        signer:dms_workflow_signers!signer_id(external_name, internal_user:users!internal_user_id(full_name))
      `)
      .eq('tenant_id', tenantId)
      .in('run_step_id', stepIdsForQuery),
  ])

  const signers = (signersRes.data ?? []) as unknown as SignerRow[]
  const signerIds = signers.map((s) => s.id)
  const signerIdsForQuery = signerIds.length > 0 ? signerIds : ['00000000-0000-0000-0000-000000000000']

  const tokensRes = await svc
    .from('dms_workflow_signer_tokens')
    .select('signer_id, token, expires_at, used_at, view_count, token_kind')
    .eq('tenant_id', tenantId)
    .in('signer_id', signerIdsForQuery)
    .is('used_at', null)
    .order('created_at', { ascending: false })

  const tokens = (tokensRes.data ?? []) as TokenRow[]
  const signaturesForRun = (signaturesRes.data ?? []) as unknown as SignatureRow[]
  const analyses = (analysesRes.data ?? []) as AnalysisRow[]
  const audits = (auditRes.data ?? []) as unknown as AuditRow[]

  // Checklist items + responses + uploads (only meaningful for templates that
  // have them; queries are cheap if no rows exist).
  const templateId = run.template_id
  const [itemsRes, responsesRes, uploadsRes] = await Promise.all([
    templateId
      ? svc
          .from('dms_workflow_checklist_items')
          .select('id, template_id, order_index, code, prompt_en, prompt_ar, ai_check_capable')
          .eq('tenant_id', tenantId)
          .eq('template_id', templateId)
          .order('order_index', { ascending: true })
      : Promise.resolve({ data: [] as ChecklistItemRow[] }),
    svc
      .from('dms_workflow_checklist_responses')
      .select('id, run_step_id, checklist_item_id, status, notes, ai_suggested_status, ai_suggested_notes, ai_confidence')
      .eq('tenant_id', tenantId)
      .in('run_step_id', stepIdsForQuery),
    svc
      .from('dms_workflow_uploads')
      .select('id, run_step_id, filename, display_name, upload_kind, storage_path, file_size_bytes, mime_type, uploaded_at')
      .eq('tenant_id', tenantId)
      .eq('run_id', params.id)
      .order('uploaded_at', { ascending: true }),
  ])

  const checklistItems = (itemsRes.data ?? []) as ChecklistItemRow[]
  const checklistResponses = (responsesRes.data ?? []) as ChecklistResponseRow[]
  const uploads = (uploadsRes.data ?? []) as UploadRow[]

  // Agent panel is visible only for the Disbursement Document Review template,
  // and only attached to the currently-active internal_review step.
  const isDisbursement = templateId === DISBURSEMENT_TEMPLATE_ID
  const activeInternalStep = steps.find(
    (s) => s.status === 'awaiting' && s.kind === 'internal_review',
  )
  const showAgentPanel = isDisbursement && Boolean(activeInternalStep)

  // Index responses by (run_step_id, checklist_item_id)
  const responseMap = new Map<string, ChecklistResponseRow>()
  for (const r of checklistResponses) {
    responseMap.set(`${r.run_step_id}:${r.checklist_item_id}`, r)
  }

  // Index uploads by step
  const uploadsByStep = new Map<string, UploadRow[]>()
  for (const u of uploads) {
    const key = u.run_step_id ?? 'unassigned'
    const arr = uploadsByStep.get(key) ?? []
    arr.push(u)
    uploadsByStep.set(key, arr)
  }

  // Index by step
  const signerByStep = new Map<string, SignerRow>()
  for (const s of signers) signerByStep.set(s.run_step_id, s)
  const tokenBySigner = new Map<string, TokenRow>()
  // Tokens are ordered created_at desc; keep only the most recent unused per signer.
  for (const t of tokens) {
    if (!tokenBySigner.has(t.signer_id)) tokenBySigner.set(t.signer_id, t)
  }
  const sigByStep = new Map<string, SignatureRow>()
  for (const s of signaturesForRun) sigByStep.set(s.run_step_id, s)
  const analysisByStep = new Map<string, AnalysisRow>()
  for (const a of analyses) {
    if (a.run_step_id) analysisByStep.set(a.run_step_id, a)
  }

  const runDoc = pickOne(run.document)
  const runClient = pickOne(run.client)
  const runTemplate = pickOne(run.template)
  const runInitiator = pickOne(run.initiator)

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="text-xs text-slate-500 flex items-center gap-1.5">
        <Link href="/app/dms" className="hover:text-slate-700">{tServer('dms.crumb.dms', locale)}</Link>
        <span className="text-slate-300">/</span>
        <Link href="/app/dms/workflows" className="hover:text-slate-700">{tServer('workflows.title', locale)}</Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700 font-semibold truncate max-w-[40ch]">
          {runDoc?.display_name ?? runDoc?.filename ?? '—'}
        </span>
      </nav>

      <header className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="serif font-black text-2xl tracking-tight text-slate-900">
            {runDoc?.display_name ?? runDoc?.filename ?? '—'}
          </h1>
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusChipClasses(run.status)}`}>
            {statusLabel(run.status, locale)}
          </span>
        </div>
        <p className="text-sm text-slate-500">
          {runClient?.name ?? '—'}
          <span className="text-slate-300 mx-2">·</span>
          {runTemplate?.name ?? '—'}
          <span className="text-slate-300 mx-2">·</span>
          {fmtDateTime(run.started_at, locale)}
          {runInitiator?.full_name && (
            <>
              <span className="text-slate-300 mx-2">·</span>
              {tServer('workflows.detail.initiated_by', locale, { name: runInitiator.full_name })}
            </>
          )}
        </p>
      </header>

      {/* AI Agent panel — disbursement template only, when an internal review step is active */}
      {showAgentPanel && activeInternalStep && (
        <AgentPanel
          runId={run.id}
          stepId={activeInternalStep.id}
          totalChecklistItems={checklistItems.length}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pipeline (2/3) */}
        <div className="lg:col-span-2 space-y-4">
          {steps.map((step, idx) => {
            const signer = signerByStep.get(step.id)
            const token = signer ? tokenBySigner.get(signer.id) : null
            const sig = sigByStep.get(step.id)
            const analysis = analysisByStep.get(step.id)
            const isLast = idx === steps.length - 1
            return (
              <div key={step.id} className="relative">
                {/* connector line */}
                {!isLast && (
                  <div className="absolute start-5 top-12 bottom-[-1rem] w-px bg-slate-200" aria-hidden="true" />
                )}
                <div className={`relative bg-white border rounded-xl p-5 shadow-sm ${
                  step.status === 'awaiting' ? 'border-blue-200 ring-2 ring-blue-100' :
                  step.status === 'rejected' ? 'border-red-200' :
                  step.status === 'approved' ? 'border-green-200' :
                  'border-slate-200'
                }`}>
                  <div className="flex items-start gap-4">
                    {/* Stage number / status circle */}
                    <StepCircle step={step} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="text-xs uppercase tracking-wider font-semibold text-slate-500">
                          {tServer('workflows.col.current_stage', locale)} {step.order_index}
                        </div>
                        <h3 className="font-bold text-slate-900">{stageLabel(step.kind, locale)}</h3>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${stepStatusChipClasses(step.status)}`}>
                          {stepStatusLabel(step.status, locale)}
                        </span>
                      </div>

                      {/* Signer info */}
                      {signer && (
                        <div className="mt-2 text-sm text-slate-700">
                          <span className="font-medium text-slate-500">{tServer('workflows.detail.signer', locale)}: </span>
                          {signer.signer_kind === 'external'
                            ? <>{signer.external_name ?? '—'} <span className="text-slate-400">&lt;{signer.external_email}&gt;</span> {signer.external_role && <span className="text-slate-500">— {signer.external_role}</span>}</>
                            : <>{pickOne(signer.internal_user)?.full_name ?? '—'} {signer.external_role && <span className="text-slate-500">— {signer.external_role}</span>}</>
                          }
                        </div>
                      )}

                      {/* Activation / completion timestamps */}
                      <div className="mt-1 text-xs text-slate-500 space-x-2">
                        {step.activated_at && (
                          <span>{tServer('workflows.detail.activated_at', locale, { date: fmtDateTime(step.activated_at, locale) })}</span>
                        )}
                        {step.completed_at && (
                          <span>· {step.status === 'rejected'
                            ? tServer('workflows.detail.rejected_at', locale, { date: fmtDateTime(step.completed_at, locale) })
                            : tServer('workflows.detail.completed_at', locale, { date: fmtDateTime(step.completed_at, locale) })}
                          </span>
                        )}
                      </div>

                      {/* Active external signer/upload link box */}
                      {step.status === 'awaiting' && signer?.signer_kind === 'external' && token && (
                        (() => {
                          const path = token.token_kind === 'upload' ? 'upload' : 'sign'
                          const fullUrl = `${siteUrl()}/${path}/${token.token}`
                          return (
                            <div className="mt-3 p-3 rounded-lg bg-blue-50 border border-blue-100 flex items-start gap-3 flex-wrap">
                              <Mail className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-xs text-blue-900 font-semibold">
                                  {tServer('workflows.detail.signer_link_sent', locale, { email: signer.external_email ?? '' })}
                                </div>
                                <div className="mt-1 text-[11px] font-mono text-blue-800/80 break-all">
                                  {fullUrl}
                                </div>
                              </div>
                              <CopyLinkButton url={fullUrl} />
                            </div>
                          )
                        })()
                      )}

                      {/* Signature info for approved/rejected step */}
                      {sig && (
                        <div className={`mt-3 p-3 rounded-lg text-sm ${
                          sig.decision === 'approve'
                            ? 'bg-green-50 border border-green-100 text-green-900'
                            : 'bg-red-50 border border-red-100 text-red-900'
                        }`}>
                          <div className="font-semibold">
                            {sig.decision === 'approve'
                              ? tServer('sign.approve', locale)
                              : tServer('sign.reject', locale)}
                            <span className="font-normal text-slate-700"> — {fmtDateTime(sig.signed_at, locale)}</span>
                          </div>
                          {sig.reason && (
                            <div className="mt-1 text-sm">
                              <span className="font-medium">{tServer('workflows.detail.reason', locale)}: </span>
                              {sig.reason}
                            </div>
                          )}
                        </div>
                      )}

                      {/* AI analysis card */}
                      {analysis && <AiAnalysisCard analysis={analysis} locale={locale} />}

                      {/* Uploads section — visible on the intake step that received the files */}
                      {(() => {
                        const stepUploads = uploadsByStep.get(step.id) ?? []
                        if (stepUploads.length === 0) return null
                        return (
                          <div className="mt-4 p-4 rounded-lg bg-white border border-slate-200">
                            <div className="flex items-center gap-2 mb-3">
                              <UploadIcon className="w-4 h-4 text-slate-500" />
                              <h4 className="text-sm font-bold text-slate-900">
                                {tServer('workflows.uploads.title', locale)}
                              </h4>
                              <span className="text-[11px] text-slate-500 font-mono">{stepUploads.length}</span>
                            </div>
                            <ul className="divide-y divide-slate-100">
                              {stepUploads.map((u) => (
                                <li key={u.id} className="py-2 flex items-center gap-3">
                                  <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-semibold text-slate-900 truncate">
                                      {u.display_name ?? u.filename}
                                    </div>
                                    <div className="text-[11px] text-slate-500 truncate font-mono">
                                      {u.filename}
                                    </div>
                                  </div>
                                  {u.upload_kind && (
                                    <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200">
                                      {(() => {
                                        const k = `disbursement.upload.kind.${u.upload_kind}` as StringKey
                                        const lbl = tServer(k, locale)
                                        return lbl === k ? u.upload_kind : lbl
                                      })()}
                                    </span>
                                  )}
                                  <div className="text-[11px] text-slate-500 font-mono whitespace-nowrap">
                                    {fmtBytes(u.file_size_bytes)}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )
                      })()}

                      {/* 19-item checklist — visible on internal_review steps for templates that have items */}
                      {step.kind === 'internal_review' && checklistItems.length > 0 && (
                        <ChecklistTable
                          rows={checklistItems.map((it) => {
                            const r = responseMap.get(`${step.id}:${it.id}`) ?? null
                            return {
                              item_id: it.id,
                              order_index: it.order_index,
                              code: it.code,
                              prompt_en: it.prompt_en,
                              prompt_ar: it.prompt_ar,
                              status: (r?.status ?? null) as ChecklistRow['status'],
                              notes: r?.notes ?? null,
                              ai_status: (r?.ai_suggested_status ?? null) as ChecklistRow['ai_status'],
                              ai_notes: r?.ai_suggested_notes ?? null,
                              ai_confidence: r?.ai_confidence != null ? Number(r.ai_confidence) : null,
                            }
                          })}
                          runId={run.id}
                          runStepId={step.id}
                          editable={step.status === 'awaiting'}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Activity timeline + Document (1/3) */}
        <aside className="lg:col-span-1 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-xs uppercase tracking-wider font-semibold text-slate-600">
                {tServer('workflows.detail.activity_timeline', locale)}
              </h3>
            </div>
            <ol className="divide-y divide-slate-100">
              {audits.length === 0 ? (
                <li className="px-4 py-6 text-sm text-slate-500">
                  {tServer('workflows.detail.empty_timeline', locale)}
                </li>
              ) : (
                audits.map((e) => {
                  const { who, what } = describeAuditEvent(e, locale)
                  return (
                    <li key={e.id} className="px-4 py-3 text-sm">
                      <div className="text-slate-700">
                        <span className="font-semibold text-slate-900">{who}</span>
                        <span className="text-slate-500"> — {what}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{fmtDateTime(e.occurred_at, locale)}</div>
                    </li>
                  )
                })
              )}
            </ol>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-xs uppercase tracking-wider font-semibold text-slate-600">
                {tServer('workflows.detail.document', locale)}
              </h3>
            </div>
            <div className="p-4 space-y-2">
              <div className="font-semibold text-slate-900">{runDoc?.display_name ?? runDoc?.filename ?? '—'}</div>
              {runDoc?.filename && runDoc.display_name && (
                <div className="text-xs text-slate-500 truncate font-mono">{runDoc.filename}</div>
              )}
              {run.client_id && (
                <Link
                  href={`/app/dms/clients/${run.client_id}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-teal-600 hover:text-teal-700 mt-2"
                >
                  {tServer('workflows.detail.view_document', locale)}
                  <ExternalLink className="w-3 h-3" />
                </Link>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function StepCircle({ step }: { step: StepRow }) {
  if (step.status === 'approved') {
    return (
      <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 flex items-center justify-center shrink-0 ring-2 ring-white shadow-sm">
        <CheckCircle2 className="w-5 h-5" />
      </div>
    )
  }
  if (step.status === 'rejected') {
    return (
      <div className="w-10 h-10 rounded-full bg-red-100 text-red-700 flex items-center justify-center shrink-0 ring-2 ring-white shadow-sm">
        <XCircle className="w-5 h-5" />
      </div>
    )
  }
  if (step.status === 'awaiting') {
    return (
      <div className="relative shrink-0">
        <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center ring-2 ring-white shadow-sm">
          <Clock className="w-5 h-5" />
        </div>
        <span className="absolute inset-0 rounded-full ring-4 ring-blue-200/60 animate-pulse" aria-hidden="true" />
      </div>
    )
  }
  return (
    <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 ring-2 ring-white shadow-sm">
      <Circle className="w-5 h-5" />
    </div>
  )
}

function AiAnalysisCard({ analysis, locale }: { analysis: AnalysisRow; locale: Locale }) {
  const confidencePct = analysis.confidence != null ? Math.round(Number(analysis.confidence) * 100) : null
  return (
    <div className="mt-4 p-4 rounded-lg bg-slate-50 border border-slate-200">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-teal-600" />
          <h4 className="text-sm font-bold text-teal-700">{tFn('workflows.ai.title', locale)}</h4>
        </div>
        {analysis.model && (
          <span className="text-[10px] font-mono text-slate-400">{analysis.model}</span>
        )}
      </div>
      <p className="text-sm font-semibold text-slate-900">{analysis.summary}</p>

      {analysis.key_points && analysis.key_points.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">
            {tFn('workflows.ai.key_points', locale)}
          </div>
          <ul className="list-disc list-inside text-sm text-slate-700 space-y-0.5 ms-1">
            {analysis.key_points.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      {analysis.risk_flags && analysis.risk_flags.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-red-700 mb-1 flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" />
            {tFn('workflows.ai.risk_flags', locale)}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {analysis.risk_flags.map((f, i) => (
              <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 font-mono">
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {analysis.recommendation && (
        <div className="mt-3 text-sm italic text-slate-700">
          <span className="not-italic font-semibold text-slate-500 me-1">{tFn('workflows.ai.recommendation', locale)}:</span>
          {analysis.recommendation}
        </div>
      )}

      {confidencePct != null && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">
            <span>{tFn('workflows.ai.confidence', locale)}</span>
            <span className="font-mono text-slate-700">{confidencePct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full bg-teal-500"
              style={{ width: `${confidencePct}%` }}
              aria-hidden="true"
            />
          </div>
        </div>
      )}
    </div>
  )
}
