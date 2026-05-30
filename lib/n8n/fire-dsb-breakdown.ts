/**
 * Fire the n8n "Disbursement Breakdown (AI)" webhook.
 *
 * Called from the three places that finalize an upload + flip a case to
 * `with_employee`:
 *   - app/developer/new/actions.ts           (developer portal submit)
 *   - app/upload-disbursement/[token]/...    (tokenized magic-link upload)
 *   - app/app/disbursements/new/actions.ts   (Full Scope staff upload)
 *
 * Fire-and-forget — never throws, never blocks. If the webhook env var is
 * unset (e.g. local dev without n8n) we silently skip so the existing email +
 * audit path still completes.
 */

export interface FireDsbBreakdownInput {
  case_id: string
  tenant_id: string
}

export async function fireDsbBreakdownWebhook(input: FireDsbBreakdownInput): Promise<void> {
  const url = process.env.N8N_DSB_BREAKDOWN_WEBHOOK_URL
  if (!url) {
    console.warn('[n8n] N8N_DSB_BREAKDOWN_WEBHOOK_URL not set — skipping AI breakdown')
    return
  }
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    console.error('[n8n] fireDsbBreakdownWebhook failed', err)
    // Fire-and-forget — never throw so caller can finish.
  }
}
