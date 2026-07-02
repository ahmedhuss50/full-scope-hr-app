/**
 * Fire the contract-extract endpoint (fire-and-forget).
 *
 * Mirrors lib/n8n/fire-dsb-breakdown.ts — POSTs to our own
 * /api/dsb-contract-extract route which runs Claude Vision + matching. The
 * caller (registerContract flow) does not block on the response; the endpoint
 * updates the dsb_unit_contracts row with the extraction result + linkage.
 *
 * URL resolution:
 *   1. NEXT_PUBLIC_APP_URL → "<APP_URL>/api/dsb-contract-extract"
 *   2. VERCEL_URL          → "https://<VERCEL_URL>/api/dsb-contract-extract"
 *   3. otherwise: skip (warn) — local dev without either env set
 */

export interface FireDsbContractExtractInput {
  contract_id: string
  /** Optional project scope — enables unit_number fallback matching. */
  project_id?: string
}

function resolveTargetUrl(): string | null {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
  if (!base) return null
  return `${base.replace(/\/$/, '')}/api/dsb-contract-extract`
}

export async function fireDsbContractExtract(
  input: FireDsbContractExtractInput,
): Promise<void> {
  const target = resolveTargetUrl()
  if (!target) {
    console.warn(
      '[dsb-contract-extract] no target URL configured (set NEXT_PUBLIC_APP_URL or VERCEL_URL) — skipping extraction',
    )
    return
  }

  try {
    await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.DSB_EXTRACT_SECRET
          ? { 'x-dsb-secret': process.env.DSB_EXTRACT_SECRET }
          : {}),
      },
      body: JSON.stringify(input),
      // Fire-and-forget — Vercel keeps the receiver running after we abort.
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return
    console.error('[dsb-contract-extract] fire-and-forget POST failed', err)
  }
}
