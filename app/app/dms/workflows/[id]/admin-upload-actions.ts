'use server'
import { revalidatePath } from 'next/cache'
import { randomBytes } from 'crypto'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
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
  'application/octet-stream',
])

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function isAllowedKind(s: string): s is UploadKind {
  return (ALLOWED_KINDS as readonly string[]).includes(s)
}

export type AdminUploadResult = {
  ok: boolean
  uploaded?: number
  next_step_id?: string
  error?: string
}

interface AdminUploadInput {
  step_id: string
  files: Partial<Record<UploadKind, File>>
}

/**
 * @deprecated Use `requestAdminUploadUrls` + client direct-to-Storage PUT +
 * `registerAdminUploads` instead. Vercel's Hobby tier caps server-action
 * bodies at 4.5 MB, so larger PDFs hit a 413 error here. Kept as a small-file
 * fallback only.
 *
 * Admin manual upload — used when the developer has not used their tokenized
 * /upload/[token] link and the firm needs to drop the documents in on their
 * behalf. Mirrors `submitDisbursementUpload` but:
 *   - is gated by an authenticated firm-staff session (no token)
 *   - records `uploaded_by_user_id` (not signer_id) on the upload row
 *   - still marks the developer's external-upload step approved + advances
 *     the workflow to the next stage (Admin Checklist Review).
 */
export async function submitAdminUpload(
  input: AdminUploadInput,
): Promise<AdminUploadResult> {
  // 1. Auth.
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, full_name')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) return { ok: false, error: 'User profile not found' }

  const tenantId = profile.tenant_id as string
  const userId = profile.id as string
  const userFullName = (profile.full_name as string | null) ?? null

  // 2. Load step + run, validating tenant + state.
  const { data: step } = await svc
    .from('dms_workflow_run_steps')
    .select('id, run_id, order_index, kind, name, signer_kind, status')
    .eq('tenant_id', tenantId)
    .eq('id', input.step_id)
    .maybeSingle()
  if (!step) return { ok: false, error: 'Step not found' }

  if (step.status !== 'awaiting') {
    return { ok: false, error: 'Step is not awaiting an upload' }
  }
  if (step.kind !== 'intake' || step.signer_kind !== 'external') {
    return { ok: false, error: 'This step does not accept developer uploads' }
  }

  const { data: run } = await svc
    .from('dms_workflow_runs')
    .select('id, document_id, client_id, template_id, tenant_id')
    .eq('tenant_id', tenantId)
    .eq('id', step.run_id)
    .maybeSingle()
  if (!run) return { ok: false, error: 'Run not found' }

  // 3. Upload each file present.
  const uploaded: Array<{ kind: UploadKind; filename: string; size: number; storage_path: string | null }> = []

  for (const kind of ALLOWED_KINDS) {
    const f = input.files[kind]
    if (!f) continue
    if (f.size > MAX_FILE_SIZE) {
      return { ok: false, error: `File too large for ${kind}` }
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
      else console.warn('[admin-upload] storage error', storageErr.message)
    } catch (err) {
      console.warn('[admin-upload] storage exception (bucket may not exist yet)', err)
    }

    await svc.from('dms_workflow_uploads').insert({
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: step.id,
      uploaded_by_user_id: userId,
      filename: safeName,
      display_name: f.name,
      upload_kind: kind,
      storage_path: storageOk ? storagePath : null,
      storage_bucket: STORAGE_BUCKET,
      file_size_bytes: f.size,
      mime_type: f.type || 'application/octet-stream',
    })

    uploaded.push({ kind, filename: safeName, size: f.size, storage_path: storageOk ? storagePath : null })

    await svc.from('dms_workflow_audit_log').insert({
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: step.id,
      actor_kind: 'user',
      actor_user_id: userId,
      action: 'admin_upload_received',
      details: {
        kind,
        filename: safeName,
        size: f.size,
        storage_ok: storageOk,
        on_behalf_of_developer: true,
      },
    })
  }

  if (uploaded.length === 0) return { ok: false, error: 'No files provided' }

  const nowIso = new Date().toISOString()

  // 4. Look up the developer signer (so we can attribute the signature row to
  //    them — same pattern the public path uses, just via service role here).
  const { data: signer } = await svc
    .from('dms_workflow_signers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('run_step_id', step.id)
    .maybeSingle()

  // 5. Signature row representing the upload sign-off (recorded against the
  //    signer if one exists, otherwise null).
  await svc.from('dms_workflow_signatures').insert({
    tenant_id: tenantId,
    run_step_id: step.id,
    signer_id: signer?.id ?? null,
    decision: 'approve',
    reason: `Admin uploaded ${uploaded.length} document(s) on behalf of developer (${userFullName ?? user.email}).`,
    signed_at: nowIso,
  })

  // 6. Mark step approved + invalidate any outstanding upload tokens so the
  //    developer can't re-submit on top of the admin upload.
  await svc
    .from('dms_workflow_run_steps')
    .update({ status: 'approved', completed_at: nowIso })
    .eq('id', step.id)

  if (signer) {
    await svc
      .from('dms_workflow_signer_tokens')
      .update({ used_at: nowIso })
      .eq('signer_id', signer.id)
      .is('used_at', null)
  }

  // 7. Audit log — admin completed the upload step.
  await svc.from('dms_workflow_audit_log').insert([
    {
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: step.id,
      actor_kind: 'user',
      actor_user_id: userId,
      action: 'admin_uploaded_for_developer',
      details: {
        step: step.kind,
        uploaded_kinds: uploaded.map((u) => u.kind),
        by: userFullName,
      },
    },
    {
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: step.id,
      actor_kind: 'system',
      action: 'step_completed',
      details: { order_index: step.order_index, status: 'approved' },
    },
  ])

  // 8. Fire n8n webhook (best-effort).
  try {
    await fireN8nEvent('disbursement.uploaded', {
      run_id: run.id,
      run_step_id: step.id,
      document_id: run.document_id,
      uploads: uploaded.map((u) => ({ kind: u.kind, filename: u.filename, size: u.size })),
      by: 'internal_user',
    })
  } catch (err) {
    console.error('[admin-upload] n8n event failed', err)
  }

  // 9. Find + activate next step (the Admin Checklist Review stage).
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
      .update({ status: 'awaiting', activated_at: nowIso })
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

    // Best-effort AI analysis for the new stage so the checklist arrives pre-primed.
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
      console.error('[admin-upload] AI analysis failed', err)
    }

    // If next step is external, mint a fresh token (defensive — the
    // disbursement template's Stage 2 is internal, so this branch is rarely
    // hit, but kept for symmetry with signWorkflowStep / step-actions).
    if (nextStep.signer_kind === 'external') {
      try {
        const { data: nextSigner } = await svc
          .from('dms_workflow_signers')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('run_step_id', nextStep.id)
          .maybeSingle()
        if (nextSigner) {
          const newToken = randomBytes(30).toString('base64url').slice(0, 40)
          await svc.from('dms_workflow_signer_tokens').insert({
            tenant_id: tenantId,
            signer_id: nextSigner.id,
            token: newToken,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            token_kind: 'sign',
          })
        }
      } catch (err) {
        console.error('[admin-upload] failed to mint next-step token', err)
      }
    }
  }

  revalidatePath(`/app/dms/workflows/${run.id}`)
  return { ok: true, uploaded: uploaded.length, next_step_id: nextStep?.id }
}

// ===========================================================================
// NEW direct-to-Storage flow for the admin form (bypasses Vercel 4.5 MB body
// limit). Same pattern as the public token-based flow in
// app/upload/[token]/actions.ts, but auth-gated instead of token-gated.
// ===========================================================================

interface RequestAdminUploadUrlsInput {
  step_id: string
  slots: Array<{
    kind: string
    filename: string
    mime_type: string
    size: number
  }>
}

export type RequestAdminUploadUrlsResult = {
  ok: boolean
  bucket?: string
  uploads?: Array<{
    kind: UploadKind
    signed_url: string
    storage_path: string
    token: string
  }>
  error?: string
}

/**
 * Auth-gated equivalent of `requestUploadUrls`. Validates the firm-user
 * session, validates the target step, and mints one signed Supabase Storage
 * upload URL per requested slot. The browser PUTs file bytes directly to
 * Storage — never through this server action.
 */
export async function requestAdminUploadUrls(
  input: RequestAdminUploadUrlsInput,
): Promise<RequestAdminUploadUrlsResult> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  if (!Array.isArray(input.slots) || input.slots.length === 0) {
    return { ok: false, error: 'No upload slots requested' }
  }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) return { ok: false, error: 'User profile not found' }

  const tenantId = profile.tenant_id as string

  const { data: step } = await svc
    .from('dms_workflow_run_steps')
    .select('id, run_id, kind, signer_kind, status')
    .eq('tenant_id', tenantId)
    .eq('id', input.step_id)
    .maybeSingle()
  if (!step) return { ok: false, error: 'Step not found' }
  if (step.status !== 'awaiting') {
    return { ok: false, error: 'Step is not awaiting an upload' }
  }
  if (step.kind !== 'intake' || step.signer_kind !== 'external') {
    return { ok: false, error: 'This step does not accept developer uploads' }
  }

  const { data: run } = await svc
    .from('dms_workflow_runs')
    .select('id, tenant_id')
    .eq('tenant_id', tenantId)
    .eq('id', step.run_id)
    .maybeSingle()
  if (!run) return { ok: false, error: 'Run not found' }

  const uploads: NonNullable<RequestAdminUploadUrlsResult['uploads']> = []
  for (const slot of input.slots) {
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
    const storagePath = `${tenantId}/${run.id}/${slot.kind}/${safeName}`

    const { data: signedData, error: signedErr } = await svc.storage
      .from(STORAGE_BUCKET)
      .createSignedUploadUrl(storagePath)

    if (signedErr || !signedData) {
      console.error('[admin-upload] createSignedUploadUrl failed', signedErr)
      return { ok: false, error: `Could not generate upload URL for ${slot.kind}` }
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

interface RegisterAdminUploadsInput {
  step_id: string
  uploads: Array<{
    kind: string
    storage_path: string
    filename: string
    display_name?: string
    file_size: number
    mime_type: string
  }>
}

export type RegisterAdminUploadsResult = {
  ok: boolean
  uploaded?: number
  next_step_id?: string
  error?: string
}

/**
 * Auth-gated equivalent of `registerUploads`. After the client has PUT every
 * file directly to Supabase Storage via the signed URLs from
 * `requestAdminUploadUrls`, this action inserts the metadata rows, marks the
 * step approved, advances the workflow, and fires n8n.
 *
 * Mirrors `submitAdminUpload`'s DB-side logic (minus the actual upload).
 */
export async function registerAdminUploads(
  input: RegisterAdminUploadsInput,
): Promise<RegisterAdminUploadsResult> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  if (!Array.isArray(input.uploads) || input.uploads.length === 0) {
    return { ok: false, error: 'No uploads to register' }
  }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, full_name')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) return { ok: false, error: 'User profile not found' }

  const tenantId = profile.tenant_id as string
  const userId = profile.id as string
  const userFullName = (profile.full_name as string | null) ?? null

  const { data: step } = await svc
    .from('dms_workflow_run_steps')
    .select('id, run_id, order_index, kind, name, signer_kind, status')
    .eq('tenant_id', tenantId)
    .eq('id', input.step_id)
    .maybeSingle()
  if (!step) return { ok: false, error: 'Step not found' }
  if (step.status !== 'awaiting') {
    return { ok: false, error: 'Step is not awaiting an upload' }
  }
  if (step.kind !== 'intake' || step.signer_kind !== 'external') {
    return { ok: false, error: 'This step does not accept developer uploads' }
  }

  const { data: run } = await svc
    .from('dms_workflow_runs')
    .select('id, document_id, client_id, template_id, tenant_id')
    .eq('tenant_id', tenantId)
    .eq('id', step.run_id)
    .maybeSingle()
  if (!run) return { ok: false, error: 'Run not found' }

  const recorded: Array<{ kind: UploadKind; filename: string; size: number }> = []
  for (const u of input.uploads) {
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
      uploaded_by_user_id: userId,
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
      actor_kind: 'user',
      actor_user_id: userId,
      action: 'admin_upload_received',
      details: {
        kind: u.kind,
        filename: safeName,
        size: u.file_size,
        storage_ok: true,
        direct_upload: true,
        on_behalf_of_developer: true,
      },
    })
  }

  if (recorded.length === 0) return { ok: false, error: 'No files registered' }

  const nowIso = new Date().toISOString()

  const { data: signer } = await svc
    .from('dms_workflow_signers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('run_step_id', step.id)
    .maybeSingle()

  await svc.from('dms_workflow_signatures').insert({
    tenant_id: tenantId,
    run_step_id: step.id,
    signer_id: signer?.id ?? null,
    decision: 'approve',
    reason: `Admin uploaded ${recorded.length} document(s) on behalf of developer (${userFullName ?? user.email}).`,
    signed_at: nowIso,
  })

  await svc
    .from('dms_workflow_run_steps')
    .update({ status: 'approved', completed_at: nowIso })
    .eq('id', step.id)

  if (signer) {
    await svc
      .from('dms_workflow_signer_tokens')
      .update({ used_at: nowIso })
      .eq('signer_id', signer.id)
      .is('used_at', null)
  }

  await svc.from('dms_workflow_audit_log').insert([
    {
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: step.id,
      actor_kind: 'user',
      actor_user_id: userId,
      action: 'admin_uploaded_for_developer',
      details: {
        step: step.kind,
        uploaded_kinds: recorded.map((u) => u.kind),
        by: userFullName,
      },
    },
    {
      tenant_id: tenantId,
      run_id: run.id,
      run_step_id: step.id,
      actor_kind: 'system',
      action: 'step_completed',
      details: { order_index: step.order_index, status: 'approved' },
    },
  ])

  try {
    await fireN8nEvent('disbursement.uploaded', {
      run_id: run.id,
      run_step_id: step.id,
      document_id: run.document_id,
      uploads: recorded.map((u) => ({ kind: u.kind, filename: u.filename, size: u.size })),
      by: 'internal_user',
    })
  } catch (err) {
    console.error('[admin-upload] n8n event failed', err)
  }

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
      .update({ status: 'awaiting', activated_at: nowIso })
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
      console.error('[admin-upload] AI analysis failed', err)
    }

    if (nextStep.signer_kind === 'external') {
      try {
        const { data: nextSigner } = await svc
          .from('dms_workflow_signers')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('run_step_id', nextStep.id)
          .maybeSingle()
        if (nextSigner) {
          const newToken = randomBytes(30).toString('base64url').slice(0, 40)
          await svc.from('dms_workflow_signer_tokens').insert({
            tenant_id: tenantId,
            signer_id: nextSigner.id,
            token: newToken,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            token_kind: 'sign',
          })
        }
      } catch (err) {
        console.error('[admin-upload] failed to mint next-step token', err)
      }
    }
  }

  revalidatePath(`/app/dms/workflows/${run.id}`)
  return { ok: true, uploaded: recorded.length, next_step_id: nextStep?.id }
}
