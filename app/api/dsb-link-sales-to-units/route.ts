/**
 * POST /api/dsb-link-sales-to-units
 * ----------------------------------------------------------------------------
 * Button-triggered wrapper around the linkSalesToUnitsForProject helper
 * that lives in app/app/disbursements/admin/units/actions.ts. Kept as an
 * HTTP endpoint (not just a server action) so the buyer-contracts client
 * component can call it and show live progress.
 *
 * Input  (JSON): { project_id: string, use_ai?: boolean }
 * Auth: owner only (cookie session).
 * Output (JSON): { ok, linked_count, remaining, ai_used }
 */

import { NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

async function requireOwner(): Promise<
  | { ok: true; tenantId: string }
  | { ok: false; status: number; error: string }
> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, status: 401, error: 'لم يتم تسجيل الدخول.' }
  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id, dsb_role')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) return { ok: false, status: 401, error: 'الحساب غير مرتبط بمستأجر.' }
  if ((profile.dsb_role as string | null) !== 'owner') {
    return { ok: false, status: 403, error: 'هذه العملية متاحة للمدير فقط.' }
  }
  return { ok: true, tenantId: profile.tenant_id as string }
}

export async function POST(req: Request) {
  const auth = await requireOwner()
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  }

  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    /* empty body ok */
  }
  const { project_id: projectIdRaw, use_ai: useAiRaw } = (body || {}) as {
    project_id?: unknown
    use_ai?: unknown
  }
  if (typeof projectIdRaw !== 'string' || !projectIdRaw.trim()) {
    return NextResponse.json({ ok: false, error: 'project_id required' }, { status: 400 })
  }
  const projectId = projectIdRaw.trim()
  const useAi = useAiRaw !== false

  // Verify the project belongs to this tenant BEFORE inlining the linker
  // (helper trusts the tenantId + projectId pair implicitly).
  const svc = createSupabaseService()
  const { data: project } = await svc
    .from('dsb_projects')
    .select('id, tenant_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project || (project as { tenant_id: string }).tenant_id !== auth.tenantId) {
    return NextResponse.json({ ok: false, error: 'المشروع غير موجود.' }, { status: 404 })
  }

  // Import the helper. It's in a 'use server' file but exported as an
  // internal (non-async-action) helper — direct import works fine.
  const { linkSalesToUnitsForProject } = await import(
    '@/app/app/disbursements/admin/units/actions'
  )
  const result = await linkSalesToUnitsForProject({
    tenantId: auth.tenantId,
    projectId,
    useAi,
  })

  return NextResponse.json({
    ok: true,
    linked_count: result.linkedCount,
    remaining: result.remaining,
    ai_used: result.aiUsed,
  })
}
