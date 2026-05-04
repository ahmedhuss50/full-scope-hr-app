import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Sparkles, ShieldAlert, FileText } from 'lucide-react'
import { headers } from 'next/headers'
import { createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import { LanguageToggle } from '@/components/LanguageToggle'
import { SignerForm } from './SignerForm'

export const dynamic = 'force-dynamic'

// Server-rendered locale. Client toggle still flips client-rendered strings.
const SERVER_LOCALE: Locale = 'en'

function tServer(key: StringKey, vars?: Record<string, string | number>) {
  return tFn(key, SERVER_LOCALE, vars)
}

function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

type SignerRow = {
  id: string
  run_step_id: string
  external_name: string | null
  external_email: string | null
  external_role: string | null
  signer_kind: string
}

type StepRow = {
  id: string
  run_id: string
  kind: string
  name: string
}

type RunRow = {
  id: string
  document_id: string
  client_id: string | null
  tenant_id: string
  document: { display_name: string | null; filename: string; doc_kind: string | null } | { display_name: string | null; filename: string; doc_kind: string | null }[] | null
  client: { name: string } | { name: string }[] | null
  tenant: { name: string } | { name: string }[] | null
}

type AnalysisRow = {
  summary: string
  key_points: string[] | null
  risk_flags: string[] | null
  recommendation: string | null
  confidence: number | null
  model: string | null
}

export default async function SignerPage({ params }: { params: { token: string } }) {
  const token = params.token
  const svc = createSupabaseService()
  const hdrs = headers()
  const ip = hdrs.get('x-forwarded-for') ?? hdrs.get('x-real-ip') ?? null

  // 1. Look up token
  const { data: tokenRow } = await svc
    .from('dms_workflow_signer_tokens')
    .select('id, tenant_id, signer_id, expires_at, used_at, view_count')
    .eq('token', token)
    .maybeSingle()

  if (!tokenRow) {
    return <InvalidLinkScreen />
  }

  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    redirect(`/sign/${token}/expired`)
  }

  // If used, allow re-views (read-only) but the form will short-circuit.
  // 2. Increment view count + write audit log
  try {
    await svc
      .from('dms_workflow_signer_tokens')
      .update({ view_count: (tokenRow.view_count ?? 0) + 1 })
      .eq('id', tokenRow.id)
  } catch {
    // best-effort
  }

  // 3. Load signer + step + run + document + analysis
  const signerRes = await svc
    .from('dms_workflow_signers')
    .select('id, run_step_id, external_name, external_email, external_role, signer_kind')
    .eq('id', tokenRow.signer_id)
    .maybeSingle()
  const signer = (signerRes.data ?? null) as unknown as SignerRow | null
  if (!signer) return <InvalidLinkScreen />

  const stepRes = await svc
    .from('dms_workflow_run_steps')
    .select('id, run_id, kind, name')
    .eq('id', signer.run_step_id)
    .maybeSingle()
  const step = (stepRes.data ?? null) as unknown as StepRow | null
  if (!step) return <InvalidLinkScreen />

  const runRes = await svc
    .from('dms_workflow_runs')
    .select(`
      id, document_id, client_id, tenant_id,
      document:dms_documents!document_id(display_name, filename, doc_kind),
      client:clients!client_id(name),
      tenant:tenants!tenant_id(name)
    `)
    .eq('id', step.run_id)
    .maybeSingle()
  const run = (runRes.data ?? null) as unknown as RunRow | null
  if (!run) return <InvalidLinkScreen />

  // 4. Audit-log the view (best-effort)
  try {
    await svc.from('dms_workflow_audit_log').insert({
      tenant_id: tokenRow.tenant_id,
      run_id: run.id,
      run_step_id: step.id,
      actor_kind: 'external_signer',
      actor_signer_id: signer.id,
      action: 'signer_viewed',
      details: { view_count: (tokenRow.view_count ?? 0) + 1 },
      ip_address: ip,
    })
  } catch {
    // best-effort
  }

  const analysisRes = await svc
    .from('dms_workflow_ai_analyses')
    .select('summary, key_points, risk_flags, recommendation, confidence, model')
    .eq('tenant_id', tokenRow.tenant_id)
    .eq('run_step_id', step.id)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const analysis = (analysisRes.data ?? null) as unknown as AnalysisRow | null

  const doc = pickOne(run.document)
  const client = pickOne(run.client)
  const tenant = pickOne(run.tenant)
  const firmName = tenant?.name ?? 'Full Scope'
  const alreadySigned = Boolean(tokenRow.used_at)
  const confidencePct = analysis?.confidence != null ? Math.round(Number(analysis.confidence) * 100) : null

  return (
    <>
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <Link href="#" className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-slate-900 text-white font-black text-sm">F</span>
            <span className="serif text-base font-bold text-slate-900 truncate">{tServer('sign.brand_label')}</span>
          </Link>
          <LanguageToggle />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 min-w-0">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {/* Title section */}
          <div className="p-6 sm:p-8 border-b border-slate-100">
            <h1 className="serif font-black text-2xl sm:text-3xl tracking-tight text-slate-900">
              {tServer('sign.title')}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {tServer('sign.subtitle', { firm: firmName })}
            </p>
          </div>

          {/* Document section */}
          <section className="p-6 sm:p-8 border-b border-slate-100 space-y-2">
            <div className="text-xs uppercase tracking-wider font-semibold text-slate-500">
              {tServer('sign.document_section')}
            </div>
            <div className="flex items-start gap-3">
              <FileText className="w-5 h-5 text-slate-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-slate-900">{doc?.display_name ?? doc?.filename ?? '—'}</div>
                {doc?.filename && doc.display_name && (
                  <div className="text-xs text-slate-500 truncate font-mono">{doc.filename}</div>
                )}
                {client?.name && (
                  <div className="text-xs text-slate-500 mt-1">{client.name}</div>
                )}
              </div>
              <a
                href="#"
                title={tServer('sign.preview_unavailable')}
                className="text-xs font-semibold text-teal-600 hover:text-teal-700 cursor-not-allowed opacity-80 shrink-0"
              >
                {tServer('sign.view_document')}
              </a>
            </div>
          </section>

          {/* AI Analysis section */}
          {analysis && (
            <section className="p-6 sm:p-8 border-b border-slate-100">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-5">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-teal-600" />
                    <h2 className="text-base font-bold text-teal-700">{tServer('workflows.ai.title')}</h2>
                  </div>
                  {analysis.model && (
                    <span className="text-[10px] font-mono text-slate-400">{analysis.model}</span>
                  )}
                </div>

                <p className="text-sm font-semibold text-slate-900">{analysis.summary}</p>

                {analysis.key_points && analysis.key_points.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">
                      {tServer('workflows.ai.key_points')}
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
                      {tServer('workflows.ai.risk_flags')}
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
                    <span className="not-italic font-semibold text-slate-500 me-1">{tServer('workflows.ai.recommendation')}:</span>
                    {analysis.recommendation}
                  </div>
                )}

                {confidencePct != null && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">
                      <span>{tServer('workflows.ai.confidence')}</span>
                      <span className="font-mono text-slate-700">{confidencePct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full bg-teal-500" style={{ width: `${confidencePct}%` }} aria-hidden="true" />
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Signer info + buttons */}
          <section className="p-6 sm:p-8 space-y-4">
            <div className="text-sm text-slate-700">
              {tServer('sign.signing_as', {
                name: signer.external_name ?? '',
                email: signer.external_email ?? '',
              })}
              {signer.external_role && (
                <>
                  <span className="text-slate-300 mx-2">·</span>
                  <span className="text-slate-500">{tServer('sign.role')}: {signer.external_role}</span>
                </>
              )}
            </div>

            {alreadySigned ? (
              <div className="p-4 rounded-lg bg-green-50 border border-green-100 text-green-900 text-sm">
                <div className="font-semibold">{tServer('sign.done.title')}</div>
                <div className="text-xs mt-1 text-green-800/80">
                  This link has already been used.
                </div>
              </div>
            ) : (
              <SignerForm token={token} />
            )}

            <div className="text-[11px] text-slate-500 leading-relaxed pt-2">
              {tServer('sign.legal_notice')}
              <br />
              <span className="text-slate-400">{tServer('sign.privacy_notice')}</span>
              <span className="mx-1.5 text-slate-300">·</span>
              <a href="#" className="underline hover:text-slate-700">{tServer('sign.view_audit_trail')}</a>
            </div>
          </section>
        </div>
      </main>
    </>
  )
}

function InvalidLinkScreen() {
  return (
    <main className="max-w-md mx-auto px-6 py-20 text-center">
      <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
        <h1 className="serif font-black text-2xl text-slate-900 mb-2">{tFn('sign.invalid.title', SERVER_LOCALE)}</h1>
        <p className="text-sm text-slate-600">{tFn('sign.invalid.body', SERVER_LOCALE)}</p>
      </div>
    </main>
  )
}
