/**
 * Effective checklist template resolution.
 *
 * Each disbursement case sees ONE checklist, sourced from a single template.
 * The template is picked with this precedence:
 *
 *   1. project.checklist_template_id   (most specific — wins if set)
 *   2. developer.checklist_template_id (per-client default)
 *   3. tenant's default template       (the row with is_default = true)
 *   4. tenant's OLDEST template        (defensive fallback: better to run
 *                                       against SOMETHING than error out
 *                                       when the owner forgot to mark a
 *                                       default)
 *   5. null                            (no templates at all → empty)
 *
 * Keep both the case page and /api/dsb-ai-review using this helper so the
 * "which template" decision lives in exactly one place.
 */

import type { createSupabaseService } from '@/lib/supabase/server'

type Svc = ReturnType<typeof createSupabaseService>

export async function resolveEffectiveTemplateId(
  svc: Svc,
  tenantId: string,
  projectId: string | null,
  developerId: string | null,
): Promise<string | null> {
  if (projectId) {
    const { data } = await svc
      .from('dsb_projects')
      .select('checklist_template_id')
      .eq('id', projectId)
      .maybeSingle()
    const tid = (data as { checklist_template_id: string | null } | null)?.checklist_template_id ?? null
    if (tid) return tid
  }
  if (developerId) {
    const { data } = await svc
      .from('dsb_developers')
      .select('checklist_template_id')
      .eq('id', developerId)
      .maybeSingle()
    const tid = (data as { checklist_template_id: string | null } | null)?.checklist_template_id ?? null
    if (tid) return tid
  }
  // Tenant default (is_default = true).
  const { data: def } = await svc
    .from('dsb_checklist_templates')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .maybeSingle()
  const defId = (def as { id: string } | null)?.id ?? null
  if (defId) return defId

  // Defensive fallback: no default marked, but the tenant DOES have
  // templates. Use the oldest one (usually the seeded "افتراضي" or the
  // first one the owner created). Prevents "no template resolved" errors
  // when the owner just forgot to click "set as default."
  // NB: renamed from `any` (TS reserved word) to `firstTemplate`.
  const { data: firstTemplate } = await svc
    .from('dsb_checklist_templates')
    .select('id')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (firstTemplate as { id: string } | null)?.id ?? null
}
