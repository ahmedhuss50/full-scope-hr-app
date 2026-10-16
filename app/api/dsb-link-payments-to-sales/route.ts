/**
 * POST /api/dsb-link-payments-to-sales
 * ----------------------------------------------------------------------------
 * Finds every dsb_payments row for the caller's tenant where sale_id IS NULL
 * but contract_number_raw IS NOT NULL, and tries to resolve each to a sale
 * via (tenant_id, contract_number). Updates the matching rows in bulk.
 *
 * Scoping:
 *   - Caller must be a tenant owner.
 *   - Optional { project_id } in the JSON body narrows the pass to one
 *     project; omit to run tenant-wide.
 *
 * Response:
 *   { ok: true, scanned, linked, unmatched, examples: [{ payment_id, contract_number_raw }] }
 *   on error: { ok: false, error: string }
 *
 * This is a safe operation — it never INSERTs, DELETEs, or overwrites a
 * non-null sale_id. Repeated runs are no-ops once everything resolvable has
 * been resolved.
 */
import { NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function POST(req: Request) {
  // ----- Auth: owner only -----
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return jsonError('لم يتم تسجيل الدخول.', 401)

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id, dsb_role')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) return jsonError('حسابك غير مرتبط بمستأجر.', 401)
  if ((profile.dsb_role as string | null) !== 'owner') {
    return jsonError('هذه العملية متاحة للمدير فقط.', 403)
  }
  const tenantId = profile.tenant_id as string

  // ----- Body (project narrowing is optional) -----
  const body = (await req.json().catch(() => ({}))) as { project_id?: string | null }
  const projectFilter = (body.project_id ?? '').trim() || null

  // ----- 1) Load unlinked payments that have a raw contract to match on -----
  let candidatesQ = svc
    .from('dsb_payments')
    .select('id, project_id, contract_number_raw')
    .eq('tenant_id', tenantId)
    .is('sale_id', null)
    .not('contract_number_raw', 'is', null)
    .limit(10000)
  if (projectFilter) candidatesQ = candidatesQ.eq('project_id', projectFilter)
  const { data: candidates, error: candErr } = await candidatesQ
  if (candErr) return jsonError('فشل تحميل الدفعات: ' + candErr.message, 500)
  type Candidate = { id: string; project_id: string | null; contract_number_raw: string | null }
  const rows = (candidates ?? []) as Candidate[]
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, linked: 0, unmatched: 0, examples: [] })
  }

  // Normalize contract numbers to lowercase for the sales lookup. Keep a
  // reverse map so we can resolve each payment back to its sale.
  const normalize = (s: string | null) => (s ?? '').trim().toLowerCase()
  const uniqueContracts = Array.from(
    new Set(rows.map((r) => normalize(r.contract_number_raw)).filter(Boolean)),
  )

  // ----- 2) Fetch sales by contract_number (case-insensitive) in CHUNKS -----
  // PostgREST .or() with ilike filters hits URL-length limits around a few
  // hundred terms; chunk defensively.
  type SaleLite = { id: string; project_id: string; contract_number: string | null }
  const saleByContract = new Map<string, SaleLite>()
  const CHUNK = 100
  for (let i = 0; i < uniqueContracts.length; i += CHUNK) {
    const slice = uniqueContracts.slice(i, i + CHUNK)
    const orExpr = slice
      .map((v) => `contract_number.ilike.${v.replace(/[,()]/g, ' ')}`)
      .join(',')
    let q = svc
      .from('dsb_unit_sales')
      .select('id, project_id, contract_number')
      .eq('tenant_id', tenantId)
      .or(orExpr)
    if (projectFilter) q = q.eq('project_id', projectFilter)
    const { data: sRows, error: sErr } = await q
    if (sErr) return jsonError('فشل البحث عن العقود: ' + sErr.message, 500)
    for (const s of (sRows ?? []) as SaleLite[]) {
      if (s.contract_number) {
        const key = normalize(s.contract_number)
        // First match wins; good enough — contract_number should be unique
        // per tenant anyway.
        if (!saleByContract.has(key)) saleByContract.set(key, s)
      }
    }
  }

  // ----- 3) Build the update plan — group payment IDs by target sale -----
  const paymentsBySaleId = new Map<string, string[]>()
  const unmatched: Candidate[] = []
  for (const p of rows) {
    const key = normalize(p.contract_number_raw)
    const sale = key ? saleByContract.get(key) : null
    if (!sale) { unmatched.push(p); continue }
    // Narrow by project if the payment carries one — avoids cross-project
    // false positives when two tenants share contract numbers.
    if (p.project_id && sale.project_id && p.project_id !== sale.project_id) {
      unmatched.push(p)
      continue
    }
    const list = paymentsBySaleId.get(sale.id) ?? []
    list.push(p.id)
    paymentsBySaleId.set(sale.id, list)
  }

  // ----- 4) Apply updates in chunks (same .in() URL-limit concern) -----
  let linked = 0
  for (const [saleId, paymentIds] of paymentsBySaleId.entries()) {
    for (let i = 0; i < paymentIds.length; i += 200) {
      const slice = paymentIds.slice(i, i + 200)
      const { data: updated, error: updErr } = await svc
        .from('dsb_payments')
        .update({ sale_id: saleId })
        .in('id', slice)
        .eq('tenant_id', tenantId)
        .is('sale_id', null)
        .select('id')
      if (updErr) return jsonError('فشل الربط: ' + updErr.message, 500)
      linked += (updated ?? []).length
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: rows.length,
    linked,
    unmatched: unmatched.length,
    examples: unmatched.slice(0, 10).map((u) => ({
      payment_id: u.id,
      contract_number_raw: u.contract_number_raw,
    })),
  })
}
