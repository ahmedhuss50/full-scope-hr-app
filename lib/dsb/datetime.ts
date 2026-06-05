/**
 * Shared date/time formatters for the Document Review module.
 *
 * Always renders in Saudi Arabia Standard Time (Asia/Riyadh, UTC+3, no DST).
 * Use:
 *   - fmtDate    for pure dates (voucher_date, delivery_date, invoice_date) —
 *                renders day/month/year only.
 *   - fmtDateTime for true timestamps (submitted_at, signed_at, created_at,
 *                  occurred_at) — renders day/month/year + HH:mm.
 *
 * Both helpers accept a string, a Date, null, or undefined and degrade
 * gracefully to "—" when the input is missing.
 */

const TIMEZONE = 'Asia/Riyadh'
const LOCALE_AR = 'ar-SA'

export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value : '—'
  try {
    return new Intl.DateTimeFormat(LOCALE_AR, {
      timeZone: TIMEZONE,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value : '—'
  try {
    return new Intl.DateTimeFormat(LOCALE_AR, {
      timeZone: TIMEZONE,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d)
  } catch {
    return d.toISOString().replace('T', ' ').slice(0, 16)
  }
}

/** Just the time portion (e.g. "٠٣:٤٢ م"), no date. Useful for compact rows. */
export function fmtTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat(LOCALE_AR, {
      timeZone: TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d)
  } catch {
    return d.toISOString().slice(11, 16)
  }
}
