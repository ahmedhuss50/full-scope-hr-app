/**
 * n8n webhook stub.
 *
 * Posts a JSON event to the n8n webhook URL configured via N8N_WEBHOOK_URL.
 * If the env var is not set we no-op silently and log to console — keeps the
 * primary write path unblocked when n8n is not provisioned (Phase 2).
 *
 * Wire in events like:
 *   disbursement.uploaded
 *   disbursement.checklist_completed
 *   disbursement.audit_completed
 *   disbursement.approved
 *
 * Payload shape is intentionally loose — n8n consumers can pick what they need.
 */
export interface FireN8nEventResult {
  sent: boolean
  status?: number
  reason?: string
}

export async function fireN8nEvent(
  eventName: string,
  payload: Record<string, unknown>,
): Promise<FireN8nEventResult> {
  const url = process.env.N8N_WEBHOOK_URL
  if (!url) {
    // No-op if not configured; log so it shows up in the audit / console.
    console.log('[n8n] webhook URL not configured; skipping event:', eventName, payload)
    return { sent: false, reason: 'N8N_WEBHOOK_URL not set' }
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Event': eventName,
      },
      body: JSON.stringify({
        event: eventName,
        payload,
        timestamp: new Date().toISOString(),
      }),
    })
    return { sent: res.ok, status: res.status }
  } catch (err: unknown) {
    console.error('[n8n] webhook error', err)
    return { sent: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
