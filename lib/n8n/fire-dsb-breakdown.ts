/**
 * Fire the AI Disbursement Breakdown.
 *
 * Previously POSTed to an n8n webhook ($env-restricted on n8n Cloud caused
 * hours of pain). Now POSTs to our own `/api/dsb-extract` Next.js route which
 * runs the entire Claude pipeline in-process (see app/api/dsb-extract/route.ts).
 * The export name is kept as `fireDsbBreakdownWebhook` for backwards
 * compatibility with the three callers:
 *   - app/developer/new/actions.ts
 *   - app/upload-disbursement/[token]/actions.ts
 *   - app/app/disbursements/new/actions.ts
 *
 * Fire-and-forget — never throws, never blocks the upload redirect. The
 * /api/dsb-extract route runs as its own serverless invocation on Vercel, so
 * it completes independently of this 10s timeout (Vercel processes serverless
 * invocations to completion even if the caller disconnects).
 *
 * URL resolution (in order):
 *   1. internal: NEXT_PUBLIC_APP_URL  → "<APP_URL>/api/dsb-extract"
 *   2. internal: VERCEL_URL           → "https://<VERCEL_URL>/api/dsb-extract"
 *   3. external fallback (legacy):    N8N_DSB_BREAKDOWN_WEBHOOK_URL
 *   4. skip (warn) — typical for purely local dev without Vercel env vars
 *
 * Auth: if DSB_EXTRACT_SECRET is set, we send `x-dsb-secret: <value>` so the
 * internal route can verify the call. The external n8n fallback ignores it.
 */

export interface FireDsbBreakdownInput {
  case_id: string
  tenant_id: string
}

function resolveTargetUrl(): string | null {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
  if (base) return `${base.replace(/\/$/, '')}/api/dsb-extract`

  // Legacy fallback (kept so existing deployments still work mid-migration).
  const legacy = process.env.N8N_DSB_BREAKDOWN_WEBHOOK_URL
  return legacy || null
}

export async function fireDsbBreakdownWebhook(input: FireDsbBreakdownInput): Promise<void> {
  const target = resolveTargetUrl()
  if (!target) {
    console.warn(
      '[dsb-extract] no target URL configured (set NEXT_PUBLIC_APP_URL or VERCEL_URL) — skipping AI extraction',
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
      // Fire-and-forget: don't block the user's redirect waiting on Claude.
      // The /api/dsb-extract serverless function will keep running on Vercel
      // even after this 10s timeout fires.
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    // AbortError after 10s is expected and harmless — the receiver is still
    // processing. Anything else gets logged for debugging.
    if (err instanceof Error && err.name === 'AbortError') {
      // fire-and-forget timed out as designed
      return
    }
    console.error('[dsb-extract] fire-and-forget POST failed', err)
  }
}
