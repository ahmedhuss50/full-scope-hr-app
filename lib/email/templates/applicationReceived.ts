/**
 * applicationReceived — sent on candidate application submission.
 *
 * Bilingual (EN + AR) inline HTML; no external assets required.
 * Locale-aware: when the candidate filled the form in Arabic we send Arabic
 * with dir="rtl"; otherwise English LTR.
 */
import type { Locale } from '@/lib/i18n/translations'

export interface ApplicationReceivedArgs {
  candidateFirstName: string
  firmName: string                 // e.g., "Full Scope"
  roleTitle?: string | null
  locale: Locale
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export function renderApplicationReceived(args: ApplicationReceivedArgs): RenderedEmail {
  if (args.locale === 'ar') return renderAr(args)
  return renderEn(args)
}

function renderEn(args: ApplicationReceivedArgs): RenderedEmail {
  const { candidateFirstName, firmName, roleTitle } = args
  const subject = `${firmName} — your application has been received`
  const headline = `Thank you, ${escapeHtml(candidateFirstName)}.`
  const intro = roleTitle
    ? `We have received your application for the <strong>${escapeHtml(roleTitle)}</strong> role at ${escapeHtml(firmName)}.`
    : `We have received your application at ${escapeHtml(firmName)}.`

  const html = baseShell({
    dir: 'ltr',
    lang: 'en',
    title: subject,
    bodyHtml: `
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;margin:0 0 14px;color:#0F172A;">${headline}</h1>
      <p style="font-size:15.5px;line-height:1.7;color:#0F172A;margin:0 0 14px;">${intro}</p>
      <p style="font-size:15.5px;line-height:1.7;color:#0F172A;margin:0 0 14px;">Our hiring team typically reviews applications within one business day. If your background fits the role, we will reach out by email to schedule a conversation.</p>
      <p style="font-size:15.5px;line-height:1.7;color:#0F172A;margin:0;">If you have any questions, simply reply to this email.</p>
      <p style="font-size:14px;color:#475569;margin:24px 0 0;">— ${escapeHtml(firmName)} hiring team</p>
    `,
  })

  const text = `Thank you, ${candidateFirstName}.

${roleTitle
    ? `We have received your application for the ${roleTitle} role at ${firmName}.`
    : `We have received your application at ${firmName}.`}

Our hiring team typically reviews applications within one business day. If your background fits the role, we will reach out by email to schedule a conversation.

If you have any questions, simply reply to this email.

— ${firmName} hiring team`

  return { subject, html, text }
}

function renderAr(args: ApplicationReceivedArgs): RenderedEmail {
  const { candidateFirstName, firmName, roleTitle } = args
  const subject = `${firmName} — تم استلام طلب التوظيف الخاص بك`
  const headline = `شكرًا لك يا ${escapeHtml(candidateFirstName)}.`
  const intro = roleTitle
    ? `لقد استلمنا طلبك للتقدّم لوظيفة <strong>${escapeHtml(roleTitle)}</strong> في ${escapeHtml(firmName)}.`
    : `لقد استلمنا طلب التوظيف الخاص بك في ${escapeHtml(firmName)}.`

  const html = baseShell({
    dir: 'rtl',
    lang: 'ar',
    title: subject,
    bodyHtml: `
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;margin:0 0 14px;color:#0F172A;">${headline}</h1>
      <p style="font-size:15.5px;line-height:1.8;color:#0F172A;margin:0 0 14px;">${intro}</p>
      <p style="font-size:15.5px;line-height:1.8;color:#0F172A;margin:0 0 14px;">يقوم فريق التوظيف لدينا عادةً بمراجعة الطلبات خلال يوم عمل واحد. إذا كانت خبراتك مناسبة للوظيفة، سنتواصل معك عبر البريد الإلكتروني لتحديد موعد لمقابلة.</p>
      <p style="font-size:15.5px;line-height:1.8;color:#0F172A;margin:0;">في حال وجود أي استفسار، يكفي الرد على هذا البريد الإلكتروني.</p>
      <p style="font-size:14px;color:#475569;margin:24px 0 0;">— فريق التوظيف ${escapeHtml(firmName)}</p>
    `,
  })

  const text = `شكرًا لك يا ${candidateFirstName}.

${roleTitle
    ? `لقد استلمنا طلبك للتقدّم لوظيفة ${roleTitle} في ${firmName}.`
    : `لقد استلمنا طلب التوظيف الخاص بك في ${firmName}.`}

يقوم فريق التوظيف لدينا عادةً بمراجعة الطلبات خلال يوم عمل واحد. إذا كانت خبراتك مناسبة للوظيفة، سنتواصل معك عبر البريد الإلكتروني لتحديد موعد لمقابلة.

في حال وجود أي استفسار، يكفي الرد على هذا البريد الإلكتروني.

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
