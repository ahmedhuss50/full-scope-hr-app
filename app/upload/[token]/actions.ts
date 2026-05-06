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

interface UploadInput {
  token: string
  files: Partial<Record<UploadKind, File>>
}

/**
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
