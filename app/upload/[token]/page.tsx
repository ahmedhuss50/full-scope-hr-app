import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import { LanguageToggle } from '@/components/LanguageToggle'
import { UploadForm } from './UploadForm'

export const dynamic = 'force-dynamic'

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
}

type StepRow = {
  id: string
  run_id: string
  kind: string
  name: string
}

type RunRow = {
  id: string
  client_id: string | null
  tenant_id: string
  client: { name: string } | { name: string }[] | null
  tenant: { name: string } | { name: string }[] | null
}

export default async function UploadTokenPage({ params }: { params: { token: string } }) {
  const token = params.token
  const svc = createSupabaseService()
  const hdrs = headers()
  const ip = hdrs.get('x-forwarded-for') ?? hdrs.get('x-real-ip') ?? null

  // 1. Look up token
  const { data: tokenRow } = await svc
    .from('dms_workflow_signer_tokens')
    .select('id, tenant_id, signer_id, expires_at, used_at, view_count, token_kind')
    .eq('token', token)
    .maybeSingle()

  if (!tokenRow) {
    return <InvalidLinkScreen />
  }

  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    redirect(`/upload/${token}/expired`)
  }

  // If already used, friendly done page
  if (tokenRow.used_at) {
    redirect(`/upload/${token}/done`)
  }

  // Best-effort view count + audit
  try {
    await svc
      .from('dms_workflow_signer_tokens')
      .update({ view_count: (tokenRow.view_count ?? 0) + 1 })
      .eq('id', tokenRow.id)
  } catch {
    // best-effort
  }

  // 2. Load signer + step + run
  const signerRes = await svc
    .from('dms_workflow_signers')
    .select('id, run_step_id, external_name, external_email, external_role')
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
      id, client_id, tenant_id,
      client:clients!client_id(name),
      tenant:tenants!tenant_id(name)
    `)
    .eq('id', step.run_id)
    .maybeSingle()
  const run = (runRes.data ?? null) as unknown as RunRow | null
  if (!run) return <InvalidLinkScreen />

  // Audit-log the view (best-effort)
  try {
    await svc.from('dms_workflow_audit_log').insert({
      tenant_id: tokenRow.tenant_id,
      run_id: run.id,
      run_step_id: step.id,
      actor_kind: 'external_signer',
      actor_signer_id: signer.id,
      action: 'signer_viewed',
      details: { view_count: (tokenRow.view_count ?? 0) + 1, page: 'upload' },
      ip_address: ip,
    })
  } catch {
    // best-effort
  }

  const tenant = pickOne(run.tenant)
  const client = pickOne(run.client)
  const firmName = tenant?.name ?? 'Full Scope'

  return (
    <>
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <Link href="#" className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-slate-900 text-white font-black text-sm">
              F
            </span>
            <span className="serif text-base font-bold text-slate-900 truncate">
              {tServer('sign.brand_label')}
            </span>
          </Link>
          <LanguageToggle />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 min-w-0">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {/* Title section */}
          <div className="p-6 sm:p-8 border-b border-slate-100">
            <h1 className="serif font-black text-2xl sm:text-3xl tracking-tight text-slate-900">
              {tServer('disbursement.upload.title')}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {tServer('disbursement.upload.subtitle', { firm: firmName })}
            </p>
            {client?.name && (
              <p className="mt-1 text-xs text-slate-500">{client.name}</p>
            )}
          </div>

          {/* Signer info */}
          <section className="px-6 sm:px-8 pt-6 sm:pt-8">
            <div className="text-sm text-slate-700">
              {tServer('disbursement.upload.signing_as', {
                name: signer.external_name ?? '',
                email: signer.external_email ?? '',
              })}
              {signer.external_role && (
                <>
                  <span className="text-slate-300 mx-2">·</span>
                  <span className="text-slate-500">{signer.external_role}</span>
                </>
              )}
            </div>
          </section>

          {/* Upload slots + submit */}
          <section className="p-6 sm:p-8">
            <UploadForm token={token} />

            <div className="text-[11px] text-slate-500 leading-relaxed pt-4">
              {tServer('disbursement.upload.legal_notice')}
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
        <h1 className="serif font-black text-2xl text-slate-900 mb-2">
          {tFn('sign.invalid.title', SERVER_LOCALE)}
        </h1>
        <p className="text-sm text-slate-600">{tFn('sign.invalid.body', SERVER_LOCALE)}</p>
      </div>
    </main>
  )
}
