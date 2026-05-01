'use server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { getTenantBySlug } from '@/lib/tenant/resolve'
import { sendEmail } from '@/lib/email/resend'
import { renderApplicationReceived } from '@/lib/email/templates/applicationReceived'

// Full Scope HR domain validation. Note we accept GCC work-auth values (not US-only)
// and Full Scope HR-specific qualification fields (cpa_track, licenses, jurisdictions, fluency).
const Schema = z.object({
  tenant_slug: z.string().min(1),
  locale: z.enum(['en', 'ar']),
  legal_first_name: z.string().min(1).max(80),
  legal_last_name: z.string().min(1).max(80),
  preferred_name: z.string().max(80).optional().or(z.literal('')),
  primary_email: z.string().email().optional().or(z.literal('')),
  mobile_phone: z.string().min(7).max(24),
  home_country_code: z.string().min(2).max(8),
  home_city: z.string().max(80).optional().or(z.literal('')),
  home_postal_code: z.string().max(16).optional().or(z.literal('')),
  work_auth_status: z.enum([
    'GCC National', 'GCC Resident', 'Permanent Resident',
    'Work Visa Sponsored', 'Citizen of Hiring Country', 'Requires Sponsorship',
  ]),
  classification_preference: z.enum(['W-2', '1099']),
  source: z.enum([
    'walk_in', 'referral', 'linkedin', 'indeed', 'bayt',
    'naukrigulf', 'website', 'whatsapp', 'other',
  ]),
  job_requisition_id: z.string().uuid().optional().or(z.literal('')),

  // Full Scope HR accounting-firm specific
  cpa_track: z.enum(['true', 'false']),
  licenses_held: z.string().optional(),       // JSON array string
  jurisdictions_worked: z.string().optional(),
  years_experience: z.string().max(4).optional().or(z.literal('')),
  years_audit_experience: z.string().max(4).optional().or(z.literal('')),
  arabic_fluency: z.enum(['native', 'fluent', 'conversational', 'basic', 'none']),
  english_fluency: z.enum(['native', 'fluent', 'conversational', 'basic', 'none']),
  primary_practice_area: z.enum(['audit', 'tax', 'advisory', 'bd', 'admin']),
})

const MAX_RESUME_BYTES = 10 * 1024 * 1024 // 10 MB
const ALLOWED_RESUME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

export async function submitApplication(formData: FormData) {
  // Pull all non-file fields into a plain object for schema validation.
  const raw: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string' && key !== 'resume') raw[key] = value
  }

  const parsed = Schema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.errors[0]?.message ?? 'Validation failed' }
  }
  const data = parsed.data

  const tenant = await getTenantBySlug(data.tenant_slug)
  if (!tenant) return { ok: false as const, error: 'Tenant not found' }

  const svc = createSupabaseService()

  // --- Optional: upload CV/resume if provided ---
  let resumeRef: string | null = null
  const resumeFile = formData.get('resume')
  if (resumeFile instanceof File && resumeFile.size > 0) {
    if (resumeFile.size > MAX_RESUME_BYTES) {
      return { ok: false as const, error: 'CV is too large (max 10MB)' }
    }
    if (!ALLOWED_RESUME_TYPES.has(resumeFile.type)) {
      return { ok: false as const, error: 'CV must be PDF, DOC, or DOCX' }
    }
    const ext = (resumeFile.name.split('.').pop() ?? 'pdf').toLowerCase()
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const path = `${tenant.slug}/${unique}.${ext}`

    const { error: uploadErr } = await svc.storage
      .from('resumes')
      .upload(path, resumeFile, {
        contentType: resumeFile.type,
        cacheControl: '3600',
        upsert: false,
      })
    if (uploadErr) {
      console.error('[apply] resume upload failed', uploadErr)
      return { ok: false as const, error: 'Could not upload CV. Please try again.' }
    }
    resumeRef = path
  }

  // Parse the JSON-encoded array fields safely.
  const licenses = safeJsonArray(data.licenses_held)
  const jurisdictions = safeJsonArray(data.jurisdictions_worked)

  const { data: candidate, error: candErr } = await svc
    .from('candidates')
    .insert({
      tenant_id: tenant.id,
      legal_first_name: data.legal_first_name,
      legal_last_name: data.legal_last_name,
      preferred_name: data.preferred_name || null,
      primary_email: data.primary_email || null,
      mobile_phone: data.mobile_phone,
      home_country_code: data.home_country_code,
      home_city: data.home_city || null,
      home_postal_code: data.home_postal_code || null,
      work_auth_status: data.work_auth_status,
      classification_preference: data.classification_preference,
      source: data.source,
      locale: data.locale,
      cpa_track: data.cpa_track === 'true',
      licenses_held: licenses,
      jurisdictions: jurisdictions,
      years_experience: numOrNull(data.years_experience),
      audit_hours: null,
      primary_practice_area: data.primary_practice_area,
    })
    .select('id, primary_email, legal_first_name, locale')
    .single()

  if (candErr || !candidate) {
    console.error('[apply] candidate insert failed', candErr)
    return { ok: false as const, error: 'Could not submit application' }
  }

  // Persist the bilingual fluency answers + audit hours target inside `answers` JSON
  // so we don't need to alter the candidates table for the v1 scaffold.
  const answers: Record<string, unknown> = {
    arabic_fluency: data.arabic_fluency,
    english_fluency: data.english_fluency,
    years_audit_experience: numOrNull(data.years_audit_experience),
  }

  const { error: appErr } = await svc
    .from('applications')
    .insert({
      tenant_id: tenant.id,
      candidate_id: candidate.id,
      job_requisition_id: data.job_requisition_id || null,
      status: 'applied',
      resume_file_ref: resumeRef,
      answers,
    })

  if (appErr) {
    console.error('[apply] application insert failed', appErr)
    return { ok: false as const, error: 'Could not submit application' }
  }

  // Resolve the role title for the email body (best-effort).
  let roleTitle: string | null = null
  if (data.job_requisition_id) {
    const { data: jr } = await svc
      .from('job_requisitions')
      .select('title')
      .eq('id', data.job_requisition_id)
      .maybeSingle()
    roleTitle = jr?.title ?? null
  }

  // Fire applicationReceived email (best-effort; non-fatal).
  let emailResult: { sent: boolean; reason?: string; messageId?: string } = { sent: false, reason: 'no candidate email on file' }
  if (candidate.primary_email) {
    const rendered = renderApplicationReceived({
      candidateFirstName: candidate.legal_first_name,
      firmName: tenant.name,
      roleTitle,
      locale: candidate.locale as 'en' | 'ar',
    })
    emailResult = await sendEmail({
      to: candidate.primary_email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      locale: candidate.locale as 'en' | 'ar',
    })
  }

  // Audit (best-effort; non-fatal)
  await svc.from('audit_log').insert({
    tenant_id: tenant.id,
    actor_user_id: null,
    entity_kind: 'candidate',
    entity_id: candidate.id,
    action: 'create',
    after_state: {
      source: data.source,
      classification: data.classification_preference,
      practice_area: data.primary_practice_area,
      cpa_track: data.cpa_track === 'true',
      has_resume: !!resumeRef,
      email: emailResult,
    },
  })

  return { ok: true as const, candidate_id: candidate.id, email: emailResult }
}

function safeJsonArray(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function numOrNull(raw: string | undefined): number | null {
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}
