'use server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createSupabaseService } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/resend'
import { analyzeDocument } from '@/lib/ai/analyze'
import { fireN8nEvent } from '@/lib/integrations/n8n'

const ALLOWED_KINDS = ['contract', 'bill', 'proof_of_fund', 'bank_statement'] as const
type UploadKind = typeof ALLOWED_KINDS[number]

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB
const STORAGE_BUCKET = 'Document submission'

const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream', // fallback when browser cannot detect mime
])

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function isAllowedKind(s: string): s is UploadKind {
  return (ALLOWED_KINDS as readonly string[]).includes(s)
}

// ===========================================================================
// NEW direct-to-Storage flow (bypasses the Vercel 4.5 MB server-action body
// limit). The client requests signed upload URLs, PUTs each file straight to
// Supabase Storage, then calls registerUploads with JSON metadata only.
// ===========================================================================

interface RequestUploadUrlsInput {
  token: string
  slots: Array<{
    kind: string
    filename: string
    mime_type: string
    size: number
  }>
}

export type RequestUploadUrlsResult = {
  ok: boolean
  bucket?: string
  uploads?: Array<{
    kind: UploadKind
    signed_url: string
    storage_path: string
    token: string // upload-token returned by createSignedUploadUrl
  }>
  error?: string
  redirectTo?: string
}

/**
 * Validates the upload token and mints one signed upload URL per requested
 * slot. The signed URL bypasses Storage RLS for that specific path, so no
 * bucket policy changes are needed beyond the bucket existing.
 *
 * Small request/response — safely fits under the Vercel 4.5 MB server-action
 * body limit. The actual file bytes never touch this endpoint.
 */
export async function requestUploadUrls(
  input: RequestUploadUrlsInput,
): Promise<RequestUploadUrlsResult> {
  const { token, slots } = input
  if (!token || token.length < 10) {
    return { ok: false, error: 'Invalid token' }
  }
  if (!Array.isArray(slots) || slots.length === 0) {
    return { ok: false, error: 'No upload slots requested' }
  }

  const svc = createSupabaseService()

  // 1. Look up + validate token (must be active, not expired, kind='upload').
  const { data: tokenRow } = await svc
    .from('dms_workflow_signer_tokens')
    .select('id, tenant_id, signer_id, expires_at, used_at, token_kind')
    .eq('token', token)
    .maybeSingle()
  if (!tokenRow) return { ok: false, error: 'Token not found' }

  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'expired', redirectTo: `/upload/${token}/expired` }
  }
  if (tokenRow.used_at) {
    return { ok: false, error: 'already_used', redirectTo: `/upload/${token}/done` }
  }
  if (tokenRow.token_kind && tokenRow.token_kind !== 'upload') {
    return { ok: false, error: 'Wrong token kind' }
  }

  // 2. Resolve tenant + run + step from the token.
  const { data: signer } = await svc
    .from('dms_workflow_signers')
    .select('id, run_step_id')
    .eq('id', tokenRow.signer_id)
    .maybeSingle()
  if (!signer) return { ok: false, error: 'Signer not found' }

  const { data: step } = await svc
    .from('dms_workflow_run_steps')
    .select('id, run_id')
    .eq('id', signer.run_step_id)
    .maybeSingle()
  if (!step) return { ok: false, error: 'Step not found' }

  const { data: run } = await svc
    .from('dms_workflow_runs')
    .select('id, tenant_id')
    .eq('id', step.run_id)
    .maybeSingle()
  if (!run) return { ok: false, error: 'Run not found' }

  const tenantId = tokenRow.tenant_id as string
  const runId = run.id as string

  // 3. For each slot validate and mint a signed upload URL.
  const uploads: NonNullable<RequestUploadUrlsResult['uploads']> = []
  for (const slot of slots) {
    if (!isAllowedKind(slot.kind)) {
      return { ok: false, error: `Unsupported upload kind: ${slot.kind}` }
    }
    if (typeof slot.size !== 'number' || slot.size <= 0) {
      return { ok: false, error: `Invalid file size for ${slot.kind}` }
    }
    if (slot.size > MAX_FILE_SIZE) {
      return { ok: false, error: `File too large for ${slot.kind} (max 25 MB)` }
    }
    if (slot.mime_type && !ALLOWED_MIME_TYPES.has(slot.mime_type)) {
      return { ok: false, error: `Unsupported file type for ${slot.kind}: ${slot.mime_type}` }
    }

    const safeName = sanitizeFilename(slot.filename || `${slot.kind}.bin`)
    const storagePath = `${tenantId}/${runId}/${slot.kind}/${safeName}`

    const { data: signedData, error: signedErr } = await svc.storage
      .from(STORAGE_BUCKET)
      .createSignedUploadUrl(storagePath)

    if (signedErr || !signedData) {
      console.error('[upload] createSignedUploadUrl failed', signedErr)
      return {
        ok: false,
        error: `Could not generate upload URL for ${slot.kind}`,
      }
    }

    uploads.push({
      kind: slot.kind,
      signed_url: signedData.signedUrl,
      storage_path: signedData.path ?? storagePath,
      token: signedData.token,
    })
  }

  return { ok: true, bucket: STORAGE_BUCKET, uploads }
}

interface RegisterUploadsInput {
  token: string
  uploads: Array<{
    kind: string
    storage_path: string
    filename: string
    display_name?: string
    file_size: number
    mime_type: string
  }>
}

export type RegisterUploadsResult = {
  ok: boolean
  error?: string
  redirectTo?: string
}

/**
 * After the client has PUT every file directly to Supabase Storage via the
 * signed URLs from requestUploadUrls, this action inserts the metadata rows,
 * marks the step approved, advances the workflow + fires n8n.
 *
 * Mirrors the DB-side logic in submitDisbursementUpload (minus the upload).
 */
export async function registerUploads(
  input: RegisterUploadsInput,
): Promise<RegisterUploadsResult> {
  const { token, uploads } = input
  if (!token || token.length < 10) {
    return { ok: false, error: 'Invalid token' }
  }
  if (!Array.isArray(uploads) || uploads.length === 0) {
    return { ok: false, error: 'No uploads to register' }
  }

  const svc = createSupabaseService()
  const hdrs = headers()
  const ip = hdrs.get('x-forwarded-for') ?? hdrs.get('x-real-ip') ?? null
  const userAgent = hdrs.get('user-agent') ?? null

  // 1. Validate token again (defence-in-depth).
  const { data: tokenRow } = await svc
    .from('dms_workflow_signer_tokens')
    .select('id, tenant_id, signer_id, expires_at, used_at, token_kind')
    .eq('token', token)
    .maybeSingle()
  if (!tokenRow) return { ok: false, error: 'Token not found' }
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'expired', redirectTo: `/upload/${token}/expired` }
  }
  if (tokenRow.used_at) {
    return { ok: true, redirectTo: `/upload/${token}/done` }
  }

  // 2. Resolve tenant + run + step + signer.
  const { data: signer } = await svc
    .from('dms_workflow_signers')
    .select('id, run_step_id, external_name, external_email')
    .eq('id', tokenRow.signer_id)
    .maybeSingle()
  if (!signer) return { ok: false, error: 'Signer not found' }

  const { data: step } = await svc
    .from('dms_workflow_run_steps')
    .select('id, run_id, order_index, kind, name')
    .eq('id', signer.run_step_id)
    .maybeSingle()
  if (!step) return { ok: false, error: 'Step not found' }

  const { data: run } = await svc
    .from('dms_workflow_runs')
    .select('id, document_id, client_id, template_id, tenant_id')
    .eq('id', step.run_id)
    .maybeSingle()
  if (!run) return { ok: false, error: 'Run not found' }

  const tenantId = tokenRow.tenant_id as string

  // 3. Insert dms_workflow_uploads rows + audit entries.
  const recorded: Array<{ kind: UploadKind; filename: string; size: number }> = []
  for (const u of uploads) {
    if (!isAllowedKind(u.kind)) {
      return { ok: false, error: `Unsupported upload kind: ${u.kind}` }
    }
    if (u.file_size > MAX_FILE_SIZE) {
      return { ok: false, error: `File too large for ${u.kind}` }
    }

    const safeName = sanitizeFilename(u.filename || `${u.kind}.bin`)

    await svc.from('dms_workflow_uploads').insert({
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: step.id,
      uploaded_by_signer_id: signer.id,
      filename: safeName,
      display_name: u.display_name ?? u.filename ?? safeName,
      upload_kind: u.kind,
      storage_path: u.storage_path,
      storage_bucket: STORAGE_BUCKET,
      file_size_bytes: u.file_size,
      mime_type: u.mime_type || 'application/octet-stream',
    })

    recorded.push({ kind: u.kind, filename: safeName, size: u.file_size })

    await svc.from('dms_workflow_audit_log').insert({
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: step.id,
      actor_kind: 'external_signer',
      actor_signer_id: signer.id,
      action: 'upload_received',
      details: { kind: u.kind, filename: safeName, size: u.file_size, storage_ok: true, direct_upload: true },
      ip_address: ip,
    })
  }

  if (recorded.length === 0) {
    return { ok: false, error: 'No files registered' }
  }

  // 4. Signature row (developer signs off on the upload bundle).
  await svc.from('dms_workflow_signatures').insert({
    tenant_id: tenantId,
    run_step_id: step.id,
    signer_id: signer.id,
    decision: 'approve',
    reason: `Uploaded ${recorded.length} document(s).`,
    signer_ip: ip,
    signer_user_agent: userAgent,
  })

  // 5. Mark step approved.
  await svc
    .from('dms_workflow_run_steps')
    .update({
      status: 'approved',
      completed_at: new Date().toISOString(),
    })
    .eq('id', step.id)

  // 6. Mark token used.
  await svc
    .from('dms_workflow_signer_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenRow.id)

  // 7. Audit log — step completed.
  await svc.from('dms_workflow_audit_log').insert([
    {
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: step.id,
      actor_kind: 'external_signer',
      actor_signer_id: signer.id,
      action: 'signer_approved',
      details: { step: step.kind, uploaded_kinds: recorded.map((u) => u.kind) },
      ip_address: ip,
    },
    {
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: step.id,
      actor_kind: 'system',
      action: 'step_completed',
      details: { order_index: step.order_index },
    },
  ])

  // 8. n8n event (best-effort).
  try {
    await fireN8nEvent('disbursement.uploaded', {
      run_id: run.id,
      run_step_id: step.id,
      document_id: run.document_id,
      uploads: recorded.map((u) => ({ kind: u.kind, filename: u.filename, size: u.size })),
    })
  } catch (err) {
    console.error('[upload] n8n event failed', err)
  }

  // 9. Activate next step (Admin Checklist Review).
  const { data: nextStep } = await svc
    .from('dms_workflow_run_steps')
    .select('id, order_index, kind, name, signer_kind')
    .eq('tenant_id', tenantId)
    .eq('run_id', run.id)
    .gt('order_index', step.order_index)
    .order('order_index', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (nextStep) {
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
      .eq('id', run.id)

    await svc.from('dms_workflow_audit_log').insert({
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: nextStep.id,
      actor_kind: 'system',
      action: 'step_activated',
      details: { order_index: nextStep.order_index, name: nextStep.name },
    })

    // Best-effort AI analysis for the new stage.
    try {
      const analysis = await analyzeDocument({
        document_name: 'Disbursement Document',
        doc_kind: 'disbursement',
        stage_kind: nextStep.kind,
      })
      await svc.from('dms_workflow_ai_analyses').insert({
        tenant_id: tenantId,
        run_id: run.id,
        run_step_id: nextStep.id,
        prompt: null,
        model: analysis.model,
        summary: analysis.summary,
        key_points: analysis.key_points,
        risk_flags: analysis.risk_flags,
        recommendation: analysis.recommendation,
        confidence: analysis.confidence,
        raw_output: analysis.raw_output ?? null,
      })

      await svc.from('dms_workflow_audit_log').insert({
        tenant_id: tenantId,
        run_id: run.id,
        run_step_id: nextStep.id,
        actor_kind: 'system',
        action: 'ai_analysis_generated',
        details: { model: analysis.model, confidence: analysis.confidence, step: nextStep.kind },
      })
    } catch (err) {
      console.error('[upload] AI analysis failed', err)
    }

    // Notify internal admin (best-effort).
    try {
      const { data: nextSigner } = await svc
        .from('dms_workflow_signers')
        .select('internal_user_id, internal_user:users!internal_user_id(email, full_name)')
        .eq('run_step_id', nextStep.id)
        .maybeSingle()
      type IU = { email?: string | null; full_name?: string | null }
      const iu = nextSigner?.internal_user as IU | IU[] | null | undefined
      const internal = Array.isArray(iu) ? iu[0] : iu
      if (internal?.email) {
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
        await sendEmail({
          to: internal.email,
          subject: `Developer upload received — your checklist review is needed`,
          html: `<p>Hello ${internal.full_name ?? ''},</p>
                 <p>The developer has uploaded their disbursement documents. The 19-item checklist is pre-filled and ready for your review.</p>
                 <p><a href="${baseUrl}/app/dms/workflows/${run.id}">Open workflow</a></p>`,
          text: `Open workflow: ${baseUrl}/app/dms/workflows/${run.id}`,
        })
      }
    } catch (err) {
      console.error('[upload] internal notify failed', err)
    }
  }

  return { ok: true, redirectTo: `/upload/${token}/done` }
}

interface UploadInput {
  token: string
  files: Partial<Record<UploadKind, File>>
}

/**
 * @deprecated Use `requestUploadUrls` + client direct-to-Storage PUT +
 * `registerUploads` instead. This action receives the actual file bytes via a
 * Server Action, which fails on Vercel's Hobby tier for any payload over
 * 4.5 MB (413 Content Too Large). Kept as a small-file fallback only.
 *
 * External developer upload action: writes the 4 files to Supabase Storage,
 * inserts dms_workflow_uploads rows, marks the developer's step approved,
 * and advances the workflow to Stage 2 (Admin Checklist Review).
 *
 * Public path — uses service-role to bypass RLS because there is no Supabase
 * auth session for an external uploader. Idempotent: if the token has already
 * been used, redirects to the success page.
 */
export async function submitDisbursementUpload(input: UploadInput) {
  const { token } = input
  if (!token || token.length < 10) {
    return { ok: false as const, error: 'Invalid token' }
  }

  const svc = createSupabaseService()
  const hdrs = headers()
  const ip = hdrs.get('x-forwarded-for') ?? hdrs.get('x-real-ip') ?? null
  const userAgent = hdrs.get('user-agent') ?? null

  // 1. Look up token
  const { data: tokenRow } = await svc
    .from('dms_workflow_signer_tokens')
    .select('id, tenant_id, signer_id, expires_at, used_at, token_kind')
    .eq('token', token)
    .maybeSingle()
  if (!tokenRow) return { ok: false as const, error: 'Token not found' }

  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return { ok: false as const, error: 'expired', redirectTo: `/upload/${token}/expired` }
  }

  if (tokenRow.used_at) {
    return { ok: true as const, alreadyUploaded: true, redirectTo: `/upload/${token}/done` }
  }

  // 2. Load signer + step + run
  const { data: signer } = await svc
    .from('dms_workflow_signers')
    .select('id, run_step_id, external_name, external_email')
    .eq('id', tokenRow.signer_id)
    .maybeSingle()
  if (!signer) return { ok: false as const, error: 'Signer not found' }

  const { data: step } = await svc
    .from('dms_workflow_run_steps')
    .select('id, run_id, order_index, kind, name')
    .eq('id', signer.run_step_id)
    .maybeSingle()
  if (!step) return { ok: false as const, error: 'Step not found' }

  const { data: run } = await svc
    .from('dms_workflow_runs')
    .select('id, document_id, client_id, template_id, tenant_id')
    .eq('id', step.run_id)
    .maybeSingle()
  if (!run) return { ok: false as const, error: 'Run not found' }

  const tenantId = tokenRow.tenant_id as string

  // 3. For each kind that has a file, upload to Supabase Storage and insert
  //    a dms_workflow_uploads row. Best-effort on storage; the metadata row
  //    is what powers the UI either way.
  const uploaded: Array<{ kind: UploadKind; filename: string; size: number; storage_path: string | null }> = []

  for (const kind of ALLOWED_KINDS) {
    const f = input.files[kind]
    if (!f) continue
    if (f.size > MAX_FILE_SIZE) {
      return { ok: false as const, error: `File too large for ${kind}` }
    }

    const safeName = f.name.replace(/[^a-zA-Z0-9._-]+/g, '_')
    const storagePath = `${tenantId}/${run.id}/${kind}/${safeName}`

    let storageOk = false
    try {
      const arrayBuf = await f.arrayBuffer()
      const { error: storageErr } = await svc.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, Buffer.from(arrayBuf), {
          contentType: f.type || 'application/octet-stream',
          upsert: true,
        })
      if (!storageErr) storageOk = true
      else console.warn('[upload] storage error', storageErr.message)
    } catch (err) {
      console.warn('[upload] storage exception (bucket may not exist yet)', err)
    }

    await svc.from('dms_workflow_uploads').insert({
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: step.id,
      uploaded_by_signer_id: signer.id,
      filename: safeName,
      display_name: f.name,
      upload_kind: kind,
      storage_path: storageOk ? storagePath : null,
      storage_bucket: STORAGE_BUCKET,
      file_size_bytes: f.size,
      mime_type: f.type || 'application/octet-stream',
    })

    uploaded.push({ kind, filename: safeName, size: f.size, storage_path: storageOk ? storagePath : null })

    // Audit log per file
    await svc.from('dms_workflow_audit_log').insert({
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: step.id,
      actor_kind: 'external_signer',
      actor_signer_id: signer.id,
      action: 'upload_received',
      details: { kind, filename: safeName, size: f.size, storage_ok: storageOk },
      ip_address: ip,
    })
  }

  if (uploaded.length === 0) {
    return { ok: false as const, error: 'No files provided' }
  }

  // 4. Insert a "signature" row representing the developer's sign-off on the upload
  await svc.from('dms_workflow_signatures').insert({
    tenant_id: tenantId,
    run_step_id: step.id,
    signer_id: signer.id,
    decision: 'approve',
    reason: `Uploaded ${uploaded.length} document(s).`,
    signer_ip: ip,
    signer_user_agent: userAgent,
  })

  // 5. Mark step approved
  await svc
    .from('dms_workflow_run_steps')
    .update({
      status: 'approved',
      completed_at: new Date().toISOString(),
    })
    .eq('id', step.id)

  // 6. Mark token used
  await svc
    .from('dms_workflow_signer_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenRow.id)

  // 7. Audit log — step completed + signer approved
  await svc.from('dms_workflow_audit_log').insert([
    {
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: step.id,
      actor_kind: 'external_signer',
      actor_signer_id: signer.id,
      action: 'signer_approved',
      details: { step: step.kind, uploaded_kinds: uploaded.map((u) => u.kind) },
      ip_address: ip,
    },
    {
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: step.id,
      actor_kind: 'system',
      action: 'step_completed',
      details: { order_index: step.order_index },
    },
  ])

  // 8. Fire n8n webhook (best-effort)
  try {
    await fireN8nEvent('disbursement.uploaded', {
      run_id: run.id,
      run_step_id: step.id,
      document_id: run.document_id,
      uploads: uploaded.map((u) => ({ kind: u.kind, filename: u.filename, size: u.size })),
    })
  } catch (err) {
    console.error('[upload] n8n event failed', err)
  }

  // 9. Find next step (Admin Checklist Review)
  const { data: nextStep } = await svc
    .from('dms_workflow_run_steps')
    .select('id, order_index, kind, name, signer_kind')
    .eq('tenant_id', tenantId)
    .eq('run_id', run.id)
    .gt('order_index', step.order_index)
    .order('order_index', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (nextStep) {
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
      .eq('id', run.id)

    await svc.from('dms_workflow_audit_log').insert({
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: nextStep.id,
      actor_kind: 'system',
      action: 'step_activated',
      details: { order_index: nextStep.order_index, name: nextStep.name },
    })

    // Generate AI analysis for the admin checklist stage (best-effort)
    try {
      const analysis = await analyzeDocument({
        document_name: 'Disbursement Document',
        doc_kind: 'disbursement',
        stage_kind: nextStep.kind,
      })
      await svc.from('dms_workflow_ai_analyses').insert({
        tenant_id: tenantId,
        run_id: run.id,
        run_step_id: nextStep.id,
        prompt: null,
        model: analysis.model,
        summary: analysis.summary,
        key_points: analysis.key_points,
        risk_flags: analysis.risk_flags,
        recommendation: analysis.recommendation,
        confidence: analysis.confidence,
        raw_output: analysis.raw_output ?? null,
      })

      await svc.from('dms_workflow_audit_log').insert({
        tenant_id: tenantId,
        run_id: run.id,
        run_step_id: nextStep.id,
        actor_kind: 'system',
        action: 'ai_analysis_generated',
        details: { model: analysis.model, confidence: analysis.confidence, step: nextStep.kind },
      })
    } catch (err) {
      console.error('[upload] AI analysis failed', err)
    }

    // Notify the internal admin (best-effort)
    try {
      const { data: nextSigner } = await svc
        .from('dms_workflow_signers')
        .select('internal_user_id, internal_user:users!internal_user_id(email, full_name)')
        .eq('run_step_id', nextStep.id)
        .maybeSingle()
      type IU = { email?: string | null; full_name?: string | null }
      const iu = nextSigner?.internal_user as IU | IU[] | null | undefined
      const internal = Array.isArray(iu) ? iu[0] : iu
      if (internal?.email) {
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
        await sendEmail({
          to: internal.email,
          subject: `Developer upload received — your checklist review is needed`,
          html: `<p>Hello ${internal.full_name ?? ''},</p>
                 <p>The developer has uploaded their disbursement documents. The 19-item checklist is pre-filled and ready for your review.</p>
                 <p><a href="${baseUrl}/app/dms/workflows/${run.id}">Open workflow</a></p>`,
          text: `Open workflow: ${baseUrl}/app/dms/workflows/${run.id}`,
        })
      }
    } catch (err) {
      console.error('[upload] internal notify failed', err)
    }
  }

  return { ok: true as const, redirectTo: `/upload/${token}/done` }
}

/**
 * @deprecated Fallback only — see `submitDisbursementUpload`. The form now
 * uses `requestUploadUrls` + direct-to-Storage PUT + `registerUploads`.
 *
 * Server-action wrapper used directly from the upload form. Reads the four
 * file slots from FormData and redirects to the result page.
 */
export async function submitUploadFormAction(formData: FormData) {
  const token = String(formData.get('token') ?? '')
  const files: UploadInput['files'] = {}
  for (const kind of ALLOWED_KINDS) {
    const f = formData.get(`file_${kind}`)
    if (f instanceof File && f.size > 0) {
      files[kind] = f
    }
  }

  const result = await submitDisbursementUpload({ token, files })
  if (!result.ok) {
    if (result.error === 'expired') redirect(`/upload/${token}/expired`)
    redirect(`/upload/${token}?err=1`)
  }
  if (result.redirectTo) redirect(result.redirectTo)
  redirect(`/upload/${token}/done`)
}
