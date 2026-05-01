import { Resend } from 'resend'
import type { Locale } from '@/lib/i18n/translations'

/**
 * Single Resend client. Lazy — instantiated on first call so that build-time
 * imports don't fail when RESEND_API_KEY is unset (preview deploys, CI).
 */
let _resend: Resend | null = null
function client(): Resend {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not set')
    }
    _resend = new Resend(process.env.RESEND_API_KEY)
  }
  return _resend
}

export interface SendEmailArgs {
  to: string | string[]
  subject: string
  html: string
  text?: string
  /** Locale of the email body — used for transactional logging only, no rendering branch here. */
  locale?: Locale
  /** Override the sender. Defaults to RESEND_FROM env var. */
  from?: string
  /** Optional reply-to address. */
  replyTo?: string
}

export interface SendEmailResult {
  sent: boolean
  messageId?: string
  reason?: string
}

/**
 * Send a transactional email via Resend. Best-effort: if RESEND_API_KEY is
 * not set, logs a warning and returns { sent: false } rather than throwing.
 * Callers (server actions) must not let email failure block the primary
 * write path.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set — skipping send to', args.to)
    return { sent: false, reason: 'RESEND_API_KEY not configured' }
  }

  const from = args.from ?? process.env.RESEND_FROM ?? 'Full Scope <noreply@fullscope.sa>'

  try {
    const resp = await client().emails.send({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      reply_to: args.replyTo,
    })
    if (resp.error) {
      console.error('[email] Resend error', resp.error)
      return { sent: false, reason: resp.error.message }
    }
    return { sent: true, messageId: resp.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[email] Resend exception', err)
    return { sent: false, reason: message }
  }
}
