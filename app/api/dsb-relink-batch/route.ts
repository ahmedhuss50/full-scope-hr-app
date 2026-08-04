/**
 * POST /api/dsb-relink-batch
 * ----------------------------------------------------------------------------
 * Backfill utility. Finds cases that were already AI-extracted but have no
 * unit_id link (typical for cases processed BEFORE the extraction prompt was
 * updated to include unit_number/contract_number/buyer_name_ar), and re-runs
 * extraction on each with skip_sections + merge_extracted flags so the AI
 * re-reads the PDF, refreshes extracted_fields with the identifier keys, and
 * the auto-linker inside /api/dsb-extract writes the new links.
 *
 * Input  (JSON body):
 *   { limit?: number, project_id?: string }
 *   - limit: max cases to process (default 10, cap 30 to stay under Vercel's
 *     300s ceiling given ~15s per case)
 *   - project_id: optional narrow to one project
 *
 * Auth: cookie session, owner only.
 *
 * Output (JSON):
 *   {
 *     ok: true,
 *     processed: number,
 *     linked_unit: number,
 *     linked_sale: number,
 *     linked_contract: number,
 *     failed: number,
 *     remaining_unlinked: number,
 *     details: [{ case_number, linked, error? }]
 *   }
 *
 * Runs sequentially (Anthropic rate-limit friendly, keeps memory low). If the
 * user has 197 unlinked cases they'll click the button ~20 times to get through
 * them all — that's fine, each batch is self-contained.
 */

import { NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 min — Vercel Pro ceiling

const BATCH_CAP = 30
const DEFAULT_LIMIT = 10

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// GET — count of unlinked cases (for the UI badge)
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  const auth = await requireOwner()
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  }
  const svc = createSupabaseService()
  const url = new URL(req.url)
  const projectId = url.searchParams.get('project_id')

  let q = svc
    .from('dsb_cases')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', auth.tenantId)
    .is('unit_id', null)
    .not('extracted_at', 'is', null)
  if (projectId) q = q.eq('project_id', projectId)
  const { count, error } = await q
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({
    ok: true,
    unlinked_count: count ?? 0,
  })
}

// ---------------------------------------------------------------------------
// POST — process a batch
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  const auth = await requireOwner()
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  }

  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    /* empty body is fine */
  }
  const { limit: limitRaw, project_id: projectIdRaw } = (body || {}) as {
    limit?: unknown
    project_id?: unknown
  }
  const limit = Math.max(
    1,
    Math.min(
      BATCH_CAP,
      typeof limitRaw === 'number' && Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : DEFAULT_LIMIT,
    ),
  )
  const projectId = typeof projectIdRaw === 'string' && projectIdRaw.trim() ? projectIdRaw.trim() : null

  const svc = createSupabaseService()

  // ----- Pick N unlinked cases (oldest first so a full backfill drains
  //       from the oldest data). -----
  let listQ = svc
    .from('dsb_cases')
    .select('id, case_number, project_id')
    .eq('tenant_id', auth.tenantId)
    .is('unit_id', null)
    .not('extracted_at', 'is', null)
    .order('extracted_at', { ascending: true })
    .limit(limit)
  if (projectId) listQ = listQ.eq('project_id', projectId)
  const { data: cases, error: listErr } = await listQ
  if (listErr) {
    return NextResponse.json({ ok: false, error: listErr.message }, { status: 500 })
  }
  const targets = (cases ?? []) as Array<{
    id: string
    case_number: string
    project_id: string
  }>

  // Base URL for the internal extract call. Prefer the deployed URL so we
  // hit the right runtime environment; fall back to VERCEL_URL in preview.
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
  if (!baseUrl) {
    return NextResponse.json(
      { ok: false, error: 'NEXT_PUBLIC_APP_URL (or VERCEL_URL) not set' },
      { status: 500 },
    )
  }
  const extractSecret = process.env.DSB_EXTRACT_SECRET // may be unset

  // ----- Process sequentially -----
  let linkedUnit = 0
  let linkedSale = 0
  let linkedContract = 0
  let failed = 0
  const details: Array<{ case_number: string; linked: string[]; error?: string }> = []

  for (const t of targets) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (extractSecret) headers['x-dsb-secret'] = extractSecret
      const resp = await fetch(`${baseUrl}/api/dsb-extract`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          case_id: t.id,
          tenant_id: auth.tenantId,
          skip_sections: true,
          merge_extracted: true,
        }),
        // Give each case up to 90s. Haiku on a single-shot PDF is usually
        // ~10-20s; the extra headroom covers chunked PDFs.
        signal: AbortSignal.timeout(90_000),
      })
      const json = (await resp.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        linked?: { unit_id?: string; sale_id?: string; contract_id?: string }
      }
      if (!resp.ok || !json.ok) {
        failed += 1
        details.push({
          case_number: t.case_number,
          linked: [],
          error: json.error || `HTTP ${resp.status}`,
        })
        continue
      }
      const links = json.linked || {}
      const which: string[] = []
      if (links.unit_id) {
        linkedUnit += 1
        which.push('unit')
      }
      if (links.sale_id) {
        linkedSale += 1
        which.push('sale')
      }
      if (links.contract_id) {
        linkedContract += 1
        which.push('contract')
      }
      details.push({ case_number: t.case_number, linked: which })
    } catch (err) {
      failed += 1
      const msg = err instanceof Error ? err.message : String(err)
      details.push({ case_number: t.case_number, linked: [], error: msg })
    }
  }

  // Fresh count of what's still unlinked after this batch.
  let remainQ = svc
    .from('dsb_cases')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', auth.tenantId)
    .is('unit_id', null)
    .not('extracted_at', 'is', null)
  if (projectId) remainQ = remainQ.eq('project_id', projectId)
  const { count: remaining } = await remainQ

  return NextResponse.json({
    ok: true,
    processed: targets.length,
    linked_unit: linkedUnit,
    linked_sale: linkedSale,
    linked_contract: linkedContract,
    failed,
    remaining_unlinked: remaining ?? 0,
    details,
  })
}
