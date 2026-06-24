/**
 * Fire the AI Compliance Review.
 *
 * Mirrors fire-dsb-breakdown.ts — server-to-server POST to our own
 * /api/dsb-ai-review route, authenticated via the shared DSB_EXTRACT_SECRET
 * header. The review route now accepts that header as an alternative to the
 * usual cookie-based auth (see /api/dsb-ai-review/route.ts).
 *
 * Used to chain the review automatically after the extraction step finishes,
 * so the user never has to press the "مراجعة آلية" button manually — the
 * checklist arrives pre-filled with AI verdicts and rationales.
 *
 * Fire-and-forget: never throws, never blocks. The serverless function on
 * Vercel keeps running to completion even after this 10s timeout fires.
 */

export interface FireDsbAiReviewInput {
  case_id: string
  tenant_id: string
}

function resolveTargetUrl(): string | null {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
  if (!base) return null
  return `${base.replace(/\/$/, '')}/api/dsb-ai-review`
}

export async function fireDsbAiReviewWebhook(input: FireDsbAiReviewInput): Promise<void> {
  const target = resolveTargetUrl()
  if (!target) {
    console.warn(
      '[dsb-ai-review] no target URL configured (set NEXT_PUBLIC_APP_URL or VERCEL_URL) — skipping auto review',
    )
    return
  }
  const secret = process.env.DSB_EXTRACT_SECRET
  if (!secret) {
    // Without the shared secret the review route would fall through to cookie
    // auth, which we don't have in a server-to-server call. Skip rather than
    // 401 in the logs.
    console.warn('[dsb-ai-review] DSB_EXTRACT_SECRET not set — skipping auto review')
    return
  }

  try {
    await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dsb-secret': secret,
      },
      body: JSON.stringify(input),
      // The review call takes ~30s on its own. We use 10s here because we're
      // fire-and-forget — the serverless function keeps running on Vercel
      // even after this AbortSignal fires.
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return
    console.error('[dsb-ai-review] fire-and-forget POST failed', err)
  }
}
