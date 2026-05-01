/**
 * interviewProposed — sent when HR clicks "Will Interview" and proposes time slots.
 *
 * Bilingual (EN + AR) inline HTML. Locale chosen from the candidate's
 * `candidates.locale` value at the time of send.
 */
import type { Locale } from '@/lib/i18n/translations'

export interface InterviewProposedArgs {
  candidateFirstName: string
  firmName: string                 // e.g., "Full Scope"
  roleTitle?: string | null
  schedulePickerUrl: string        // /schedule/[token] absolute URL
  /** Pre-formatted slot labels in the candidate's locale ("Wed, 12 May · 10:00") */
  slots: Array<{ label: string }>
  interviewerName?: string | null
  durationMinutes?: number
  locale: Locale
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export function renderInterviewProposed(args: InterviewProposedArgs): RenderedEmail {
  if (args.locale === 'ar') return renderAr(args)
  return renderEn(args)
}

function renderEn(args: InterviewProposedArgs): RenderedEmail {
  const { candidateFirstName, firmName, roleTitle, schedulePickerUrl, slots, interviewerName, durationMinutes } = args
  const subject = `${firmName} — pick an interview time`
  const slotItems = slots
    .map(s => `<li style="padding:6px 0;color:#0F172A;">${escapeHtml(s.label)}</li>`)
    .join('')
  const interviewerLine = interviewerName
    ? `<p style="font-size:14px;color:#475569;margin:0 0 16px;">Interviewer: <strong>${escapeHtml(interviewerName)}</strong>${durationMinutes ? ` · ${durationMinutes} min` : ''}</p>`
    : ''

  const intro = roleTitle
    ? `Thanks for applying to the <strong>${escapeHtml(roleTitle)}</strong> role at ${escapeHtml(firmName)}. We would like to set up a${durationMinutes ? ` ${durationMinutes}-minute` : ''} conversation.`
    : `Thanks for applying at ${escapeHtml(firmName)}. We would like to set up a${durationMinutes ? ` ${durationMinutes}-minute` : ''} conversation.`

  const html = baseShell({
    dir: 'ltr',
    lang: 'en',
    title: subject,
    bodyHtml: `
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;margin:0 0 14px;color:#0F172A;">Hi ${escapeHtml(candidateFirstName)} — let's talk.</h1>
      <p style="font-size:15.5px;line-height:1.7;color:#0F172A;margin:0 0 16px;">${intro}</p>
      ${interviewerLine}
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:14px 18px;margin:0 0 22px;">
        <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#475569;font-weight:700;margin-bottom:6px;">Your interview options</div>
        <ul style="margin:0;padding-${'left'}:18px;font-size:14.5px;line-height:1.6;color:#0F172A;">${slotItems}</ul>
      </div>
      <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:6px auto 6px;">
        <tr><td align="center" style="background:#0D9488;border-radius:8px;">
          <a href="${escapeAttr(schedulePickerUrl)}" style="display:inline-block;padding:14px 28px;color:#FFFFFF;font-weight:600;font-size:15px;text-decoration:none;letter-spacing:.01em;">Pick a time &nbsp;→</a>
        </td></tr>
      </table>
      <p style="font-size:13px;color:#64748B;margin:18px 0 0;line-height:1.65;">Can't make any of these? Just reply to this email.</p>
      <p style="font-size:14px;color:#475569;margin:24px 0 0;">— ${escapeHtml(firmName)} hiring team</p>
    `,
  })

  const slotText = slots.map(s => `  • ${s.label}`).join('\n')
  const text = `Hi ${candidateFirstName},

${roleTitle
    ? `Thanks for applying to the ${roleTitle} role at ${firmName}. We would like to set up a${durationMinutes ? ` ${durationMinutes}-minute` : ''} conversation.`
    : `Thanks for applying at ${firmName}. We would like to set up a${durationMinutes ? ` ${durationMinutes}-minute` : ''} conversation.`}

Pick a time that works:
${slotText}

Book here: ${schedulePickerUrl}

Can't make any of these? Just reply to this email.

— ${firmName} hiring team`

  return { subject, html, text }
}

function renderAr(args: InterviewProposedArgs): RenderedEmail {
  const { candidateFirstName, firmName, roleTitle, schedulePickerUrl, slots, interviewerName, durationMinutes } = args
  const subject = `${firmName} — اختر موعد المقابلة`
  const slotItems = slots
    .map(s => `<li style="padding:6px 0;color:#0F172A;">${escapeHtml(s.label)}</li>`)
    .join('')
  const interviewerLine = interviewerName
    ? `<p style="font-size:14px;color:#475569;margin:0 0 16px;">المُقابِل: <strong>${escapeHtml(interviewerName)}</strong>${durationMinutes ? ` · ${durationMinutes} دقيقة` : ''}</p>`
    : ''

  const intro = roleTitle
    ? `شكرًا لتقدّمك لوظيفة <strong>${escapeHtml(roleTitle)}</strong> في ${escapeHtml(firmName)}. نودّ ترتيب${durationMinutes ? ` لقاء قصير لمدة ${durationMinutes} دقيقة` : ' مقابلة قصيرة'}.`
    : `شكرًا لتقدّمك إلى ${escapeHtml(firmName)}. نودّ ترتيب${durationMinutes ? ` لقاء قصير لمدة ${durationMinutes} دقيقة` : ' مقابلة قصيرة'}.`

  const html = baseShell({
    dir: 'rtl',
    lang: 'ar',
    title: subject,
    bodyHtml: `
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;margin:0 0 14px;color:#0F172A;">مرحبًا ${escapeHtml(candidateFirstName)} — لنتحدّث.</h1>
      <p style="font-size:15.5px;line-height:1.8;color:#0F172A;margin:0 0 16px;">${intro}</p>
      ${interviewerLine}
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:14px 18px;margin:0 0 22px;">
        <div style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#475569;font-weight:700;margin-bottom:6px;">المواعيد المتاحة</div>
        <ul style="margin:0;padding-${'right'}:18px;font-size:14.5px;line-height:1.7;color:#0F172A;">${slotItems}</ul>
      </div>
      <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:6px auto 6px;">
        <tr><td align="center" style="background:#0D9488;border-radius:8px;">
          <a href="${escapeAttr(schedulePickerUrl)}" style="display:inline-block;padding:14px 28px;color:#FFFFFF;font-weight:600;font-size:15px;text-decoration:none;letter-spacing:.01em;">اختر موعدًا &nbsp;←</a>
        </td></tr>
      </table>
      <p style="font-size:13px;color:#64748B;margin:18px 0 0;line-height:1.7;">إذا لم تناسبك المواعيد المقترحة، يكفي الرد على هذا البريد.</p>
      <p style="font-size:14px;color:#475569;margin:24px 0 0;">— فريق التوظيف ${escapeHtml(firmName)}</p>
    `,
  })

  const slotText = slots.map(s => `  • ${s.label}`).join('\n')
  const text = `مرحبًا ${candidateFirstName},

${roleTitle
    ? `شكرًا لتقدّمك لوظيفة ${roleTitle} في ${firmName}. نودّ ترتيب${durationMinutes ? ` لقاء قصير لمدة ${durationMinutes} دقيقة` : ' مقابلة قصيرة'}.`
    : `شكرًا لتقدّمك إلى ${firmName}. نودّ ترتيب${durationMinutes ? ` لقاء قصير لمدة ${durationMinutes} دقيقة` : ' مقابلة قصيرة'}.`}

المواعيد المتاحة:
${slotText}

احجز هنا: ${schedulePickerUrl}

إذا لم تناسبك المواعيد المقترحة، يكفي الرد على هذا البريد.

— فريق التوظيف ${firmName}`

  return { subject, html, text }
}

function baseShell({ dir, lang, title, bodyHtml }: { dir: 'ltr' | 'rtl'; lang: string; title: string; bodyHtml: string }): string {
  const fontStack = lang === 'ar'
    ? `'IBM Plex Sans Arabic','Segoe UI','Helvetica Neue',Arial,sans-serif`
    : `-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif`

  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#FFFFFF;">
<table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation" style="background:#FFFFFF;padding:32px 16px;font-family:${fontStack};color:#0F172A;" dir="${dir}">
  <tr><td align="center">
    <table width="560" cellspacing="0" cellpadding="0" border="0" role="presentation" style="max-width:560px;">
      <tr><td style="height:3px;background:#0D9488;line-height:3px;font-size:3px;">&nbsp;</td></tr>
      <tr><td style="padding-top:24px;"></td></tr>
      <tr><td style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;padding:32px 28px;">
        ${bodyHtml}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
