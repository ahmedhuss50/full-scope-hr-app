'use server'
import { z } from 'zod'
import { headers } from 'next/headers'
import crypto from 'crypto'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/resend'
import { fireN8nEvent } from '@/lib/integrations/n8n'

/**
 * createWorkflow — server action that provisions a brand-new disbursement
 * workflow run end-to-end:
 *   - dms_documents placeholder row (in a client-scoped folder)
 *   - dms_workflow_runs row + N step rows mirrored from the chosen template
 *   - signers for every step; current user as interim assignee for internal_user
 *     stages, the developer (external) for the first stage
 *   - upload token (40+ char base64url) for the developer
 *   - audit log: workflow_started, step_activated, signer_invited, token_created
 *   - optional Resend email to the developer with the upload URL
 *   - n8n fire-and-forget event 'workflow.started'
 *
 * Returns { ok: true, run_id, upload_url, email } on success or
 *         { ok: false, error } with a descriptive message on any failure.
 *
 * Caller is responsible for redirecting; this action does not redirect itself
 * so the form can render inline errors.
 */

const Schema = z.object({
  client_id: z.string().uuid(),
  template_id: z.string().uuid(),
  title: z.string().min(3).max(200),
  developer_name: z.string().min(1).max(120),
  developer_email: z.string().email(),
  token_expires_days: z.number().int().min(1).max(90).optional(),
  notify_developer: z.boolean().optional(),
  notes: z.string().optional().or(z.literal('')),
})

export type CreateWorkflowInput = z.infer<typeof Schema>

export interface CreateWorkflowResult {
  ok: boolean
  run_id?: string
  upload_url?: string
  email?: { sent: boolean; reason?: string }
  error?: string
}

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    'https://full-scope-hr-app.vercel.app'
  )
}

function generateToken(): string {
  // 30 random bytes → 40 url-safe base64 chars (no padding).
  return crypto.randomBytes(30).toString('base64url')
}

function buildEmailHtml(args: {
  developerName: string
  title: string
  uploadUrl: string
  expiresInDays: number
}): string {
  const { developerName, title, uploadUrl, expiresInDays } = args
  return `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #0f172a;">Action required: upload disbursement documents</h2>
  <p>Hi ${escapeHtml(developerName)},</p>
  <p>Full Scope is requesting the following documents for your disbursement workflow: <strong>${escapeHtml(title)}</strong></p>
  <ul>
    <li>Construction Contract</li>
    <li>Bill / Invoice</li>
    <li>Proof of Fund</li>
    <li>Bank Statement</li>
  </ul>
  <p>Click the button below to upload securely. No login required.</p>
  <p style="margin: 32px 0;">
    <a href="${uploadUrl}" style="display: inline-block; background: #0d9488; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Upload documents</a>
  </p>
  <p style="color: #64748b; font-size: 12px;">This link expires in ${expiresInDays} days. If you have questions, reply to this email.</p>
</body></html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export async function createWorkflow(input: CreateWorkflowInput): Promise<CreateWorkflowResult> {
  // ---- 1) Auth check ------------------------------------------------------
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, full_name')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) return { ok: false, error: 'No tenant mapping for this user.' }

  const tenantId = profile.tenant_id as string
  const userId = profile.id as string

  // ---- 2) Validate input --------------------------------------------------
  const parsed = Schema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }
  }
  const v = parsed.data
  const expiresDays = v.token_expires_days ?? 7

  // Confirm the client + template exist for this tenant.
  const [clientRes, templateRes] = await Promise.all([
    svc
      .from('clients')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('id', v.client_id)
      .maybeSingle(),
    svc
      .from('dms_workflow_templates')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('id', v.template_id)
      .maybeSingle(),
  ])
  if (!clientRes.data) return { ok: false, error: 'Client not found.' }
  if (!templateRes.data) return { ok: false, error: 'Template not found.' }

  // Tenant display name (firm) — used in the email subject only.
  const { data: tenantRow } = await svc
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle()
  const firmName = (tenantRow?.name as string | undefined) ?? 'Full Scope'

  // ---- 3) Resolve a folder for the placeholder document -------------------
  // Prefer "Engagement Letters" → any client folder → root → create one.
  let folderId: string | null = null

  const { data: engagementLetterFolder } = await svc
    .from('dms_folders')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('client_id', v.client_id)
    .ilike('name', '%engagement letter%')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (engagementLetterFolder?.id) {
    folderId = engagementLetterFolder.id as string
  } else {
    const { data: anyClientFolder } = await svc
      .from('dms_folders')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('client_id', v.client_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (anyClientFolder?.id) {
      folderId = anyClientFolder.id as string
    } else {
      // Fall back: create a fresh client-scoped folder for workflow docs.
      const { data: newFolder, error: folderErr } = await svc
        .from('dms_folders')
        .insert({
          tenant_id: tenantId,
          parent_id: null,
          client_id: v.client_id,
          engagement_id: null,
          name: 'Workflow Documents',
          kind: 'client_general',
          description: 'Auto-created for workflow placeholder documents.',
          created_by: userId,
        })
        .select('id')
        .single()
      if (folderErr || !newFolder) {
        console.error('[createWorkflow] folder create failed', folderErr)
        return { ok: false, error: 'Could not create or locate a folder for this client.' }
      }
      folderId = newFolder.id as string
    }
  }

  // ---- 4) Create the dms_documents placeholder row ------------------------
  if (!folderId) return { ok: false, error: 'Could not resolve a folder for the document.' }
  const placeholderFilename = `${v.title.replace(/[^\w\s.-]+/g, '_').slice(0, 180)}.pending`
  const { data: docRow, error: docErr } = await svc
    .from('dms_documents')
    .insert({
      tenant_id: tenantId,
      folder_id: folderId,
      client_id: v.client_id,
      filename: placeholderFilename,
      display_name: v.title,
      description: v.notes || null,
      doc_kind: 'disbursement',
      sensitivity: 'confidential',
      status: 'draft',
      version_number: 1,
      uploaded_by: userId,
    })
    .select('id')
    .single()
  if (docErr || !docRow) {
    console.error('[createWorkflow] document insert failed', docErr)
    return { ok: false, error: 'Could not create placeholder document.' }
  }
  const documentId = docRow.id as string

  // ---- 5) Load template stages ------------------------------------------
  const { data: stages, error: stagesErr } = await svc
    .from('dms_workflow_template_stages')
    .select('id, order_index, kind, name, signer_kind')
    .eq('tenant_id', tenantId)
    .eq('template_id', v.template_id)
    .order('order_index', { ascending: true })
  if (stagesErr || !stages || stages.length === 0) {
    console.error('[createWorkflow] template stages load failed', stagesErr)
    return { ok: false, error: 'Selected template has no stages.' }
  }

  // ---- 6) Create the run row (current_step_id filled in after step insert)
  const { data: runRow, error: runErr } = await svc
    .from('dms_workflow_runs')
    .insert({
      tenant_id: tenantId,
      template_id: v.template_id,
      document_id: documentId,
      client_id: v.client_id,
      initiated_by: userId,
      status: 'in_progress',
      current_step_id: null,
      notes: v.notes || null,
    })
    .select('id')
    .single()
  if (runErr || !runRow) {
    console.error('[createWorkflow] run insert failed', runErr)
    return { ok: false, error: 'Could not create workflow run.' }
  }
  const runId = runRow.id as string

  // ---- 7) Create one run-step per template stage --------------------------
  const nowIso = new Date().toISOString()
  const stepRows = stages.map((s, idx) => ({
    tenant_id: tenantId,
    run_id: runId,
    template_stage_id: s.id,
    order_index: s.order_index,
    kind: s.kind,
    name: s.name,
    signer_kind: s.signer_kind,
    status: idx === 0 ? 'awaiting' : 'pending',
    activated_at: idx === 0 ? nowIso : null,
  }))

  const { data: insertedSteps, error: stepsErr } = await svc
    .from('dms_workflow_run_steps')
    .insert(stepRows)
    .select('id, order_index, kind, name, signer_kind, status')
    .order('order_index', { ascending: true })
  if (stepsErr || !insertedSteps || insertedSteps.length === 0) {
    console.error('[createWorkflow] steps insert failed', stepsErr)
    return { ok: false, error: 'Could not create workflow steps.' }
  }

  const firstStep = insertedSteps[0]

  // Set current_step_id to the first step now that we know its id.
  await svc
    .from('dms_workflow_runs')
    .update({ current_step_id: firstStep.id })
    .eq('id', runId)

  // ---- 8) Create signers for every step ---------------------------------
  // Step 1 is always the developer (external). Later steps default to the
  // current user; the user can reassign them later from the UI.
  type SignerInsert = {
    tenant_id: string
    run_step_id: string
    signer_kind: 'external' | 'internal_user'
    internal_user_id: string | null
    external_name: string | null
    external_email: string | null
    external_role: string | null
    notify_sent_at: string | null
  }
  const signerInserts: SignerInsert[] = insertedSteps.map((step) => {
    if (step.id === firstStep.id) {
      return {
        tenant_id: tenantId,
        run_step_id: step.id,
        signer_kind: 'external',
        internal_user_id: null,
        external_name: v.developer_name,
        external_email: v.developer_email,
        external_role: 'Developer Representative',
        notify_sent_at: null,
      }
    }
    // Internal stages → assign to current user as interim default.
    return {
      tenant_id: tenantId,
      run_step_id: step.id,
      signer_kind: 'internal_user',
      internal_user_id: userId,
      external_name: null,
      external_email: null,
      external_role: null,
      notify_sent_at: null,
    }
  })

  const { data: insertedSigners, error: signersErr } = await svc
    .from('dms_workflow_signers')
    .insert(signerInserts)
    .select('id, run_step_id')
  if (signersErr || !insertedSigners) {
    console.error('[createWorkflow] signers insert failed', signersErr)
    return { ok: false, error: 'Could not create signers.' }
  }
  const firstSigner = insertedSigners.find((s) => s.run_step_id === firstStep.id)
  if (!firstSigner) {
    return { ok: false, error: 'Could not locate the developer signer row.' }
  }

  // ---- 9) Generate upload token + insert token row ----------------------
  const token = generateToken()
  const expiresAtIso = new Date(
    Date.now() + expiresDays * 24 * 60 * 60 * 1000,
  ).toISOString()

  const { error: tokenErr } = await svc
    .from('dms_workflow_signer_tokens')
    .insert({
      tenant_id: tenantId,
      signer_id: firstSigner.id,
      token,
      expires_at: expiresAtIso,
      used_at: null,
      view_count: 0,
      token_kind: 'upload',
    })
  if (tokenErr) {
    console.error('[createWorkflow] token insert failed', tokenErr)
    return { ok: false, error: 'Could not generate upload token.' }
  }

  const uploadUrl = `${siteUrl()}/upload/${token}`

  // ---- 10) Audit-log batch ----------------------------------------------
  // workflow_started (run-level) + step_activated for the first step +
  // signer_invited + token_created for the developer signer/token.
  await svc.from('dms_workflow_audit_log').insert([
    {
      tenant_id: tenantId,
      run_id: runId,
      run_step_id: null,
      actor_kind: 'user',
      actor_user_id: userId,
      action: 'workflow_started',
      details: {
        template: templateRes.data.name,
        client: clientRes.data.name,
        title: v.title,
      },
    },
    {
      tenant_id: tenantId,
      run_id: runId,
      run_step_id: firstStep.id,
      actor_kind: 'system',
      action: 'step_activated',
      details: { order_index: firstStep.order_index, name: firstStep.name },
    },
    {
      tenant_id: tenantId,
      run_id: runId,
      run_step_id: firstStep.id,
      actor_kind: 'system',
      actor_signer_id: firstSigner.id,
      action: 'signer_invited',
      details: {
        signer_kind: 'external',
        signer: v.developer_name,
        email: v.developer_email,
      },
    },
    {
      tenant_id: tenantId,
      run_id: runId,
      run_step_id: firstStep.id,
      actor_kind: 'system',
      actor_signer_id: firstSigner.id,
      action: 'token_created',
      details: { kind: 'upload', expires_in_days: expiresDays },
    },
  ])

  // ---- 11) Optional email via Resend -----------------------------------
  let emailResult: { sent: boolean; reason?: string } | undefined
  if (v.notify_developer !== false) {
    const html = buildEmailHtml({
      developerName: v.developer_name,
      title: v.title,
      uploadUrl,
      expiresInDays: expiresDays,
    })
    try {
      const result = await sendEmail({
        to: v.developer_email,
        subject: `Action required: upload disbursement documents — ${firmName}`,
        html,
        text: `Hi ${v.developer_name},

Full Scope is requesting documents for your disbursement workflow: ${v.title}

Upload them here (no login required): ${uploadUrl}

This link expires in ${expiresDays} days.`,
      })
      emailResult = { sent: result.sent, reason: result.reason }

      if (result.sent) {
        // Mark the signer as notified.
        await svc
          .from('dms_workflow_signers')
          .update({ notify_sent_at: new Date().toISOString() })
          .eq('id', firstSigner.id)
      }

      await svc.from('dms_workflow_audit_log').insert({
        tenant_id: tenantId,
        run_id: runId,
        run_step_id: firstStep.id,
        actor_kind: 'system',
        actor_signer_id: firstSigner.id,
        action: result.sent ? 'email_sent' : 'email_failed',
        details: {
          channel: 'resend',
          to: v.developer_email,
          subject: `Action required: upload disbursement documents — ${firmName}`,
          reason: result.reason,
        },
      })
    } catch (err) {
      console.error('[createWorkflow] email send threw', err)
      const reason = err instanceof Error ? err.message : 'Unknown email error'
      emailResult = { sent: false, reason }
      await svc.from('dms_workflow_audit_log').insert({
        tenant_id: tenantId,
        run_id: runId,
        run_step_id: firstStep.id,
        actor_kind: 'system',
        actor_signer_id: firstSigner.id,
        action: 'email_failed',
        details: { channel: 'resend', to: v.developer_email, reason },
      })
    }
  }

  // ---- 12) n8n event (fire-and-forget) ---------------------------------
  try {
    const hdrs = headers()
    await fireN8nEvent('workflow.started', {
      run_id: runId,
      document_id: documentId,
      client_id: v.client_id,
      template_id: v.template_id,
      title: v.title,
      developer: { name: v.developer_name, email: v.developer_email },
      upload_url: uploadUrl,
      initiated_by_email: user.email,
      initiated_by_ip: hdrs.get('x-forwarded-for') ?? null,
    })
  } catch (err) {
    console.error('[createWorkflow] n8n fire failed', err)
  }

  return {
    ok: true,
    run_id: runId,
    upload_url: uploadUrl,
    email: emailResult,
  }
}
