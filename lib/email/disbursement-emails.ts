/**
 * Disbursement workflow emails — Arabic-only transactional notifications.
 *
 * Each transition in the disbursement flow fires one email. Sending is
 * best-effort (fire-and-forget with a 10 s timeout) so the primary write
 * path is never blocked by Resend hiccups.
 */
import { sendEmail } from './resend'

// Sender uses the verified Resend domain (elevatemybusiness.co). When
// fullscope.sa is added + verified in Resend we can flip this back to
// notifications@fullscope.sa. Overridable via env so it's a one-line change
// per environment without a redeploy of the code.
const DSB_FROM =
  process.env.DSB_EMAIL_FROM || 'Full Scope <notifications@elevatemybusiness.co>'

function html(body: string): string {
  return `<!doctype html><html dir="rtl" lang="ar"><body style="font-family:Cairo,Tahoma,Arial,sans-serif;color:#0f172a;line-height:1.7;">${body}</body></html>`
}

function withTimeout<T>(p: Promise<T>, ms = 10_000): Promise<T | { sent: false; reason: string }> {
  return new Promise((resolve) => {
    const ctrl = AbortSignal.timeout(ms)
    let done = false
    ctrl.addEventListener('abort', () => {
      if (!done) resolve({ sent: false, reason: 'timeout' })
    })
    p.then((v) => { done = true; resolve(v) }).catch((err) => {
      done = true
      resolve({ sent: false, reason: err instanceof Error ? err.message : String(err) })
    })
  })
}

export interface CaseEmailContext {
  to: string
  caseNumber: string
  projectName: string
  developerName: string
  amountSar: number | null
  caseUrl: string
  reason?: string
}

function fmtAmount(amount: number | null): string {
  if (amount == null) return '—'
  try {
    return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${amount} ر.س`
  }
}

/** Developer uploaded → goes to employee inbox. */
export function sendDeveloperUploadedEmail(ctx: CaseEmailContext) {
  const body = html(`
    <h2 style="margin:0 0 12px;">طلب صرف جديد بانتظار المراجعة</h2>
    <p>تم استلام طلب صرف جديد من المطوّر <strong>${ctx.developerName}</strong> ضمن مشروع <strong>${ctx.projectName}</strong>.</p>
    <ul>
      <li>رقم الطلب: <strong>${ctx.caseNumber}</strong></li>
      <li>المبلغ: <strong>${fmtAmount(ctx.amountSar)}</strong></li>
    </ul>
    <p><a href="${ctx.caseUrl}" style="display:inline-block;padding:10px 16px;background:#0d9488;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">فتح الطلب للمراجعة</a></p>
  `)
  return withTimeout(sendEmail({
    to: ctx.to,
    from: DSB_FROM,
    subject: 'طلب صرف جديد بانتظار المراجعة',
    html: body,
    locale: 'ar',
  }))
}

/** Employee approved → goes to supervisor. */
export function sendEmployeeApprovedEmail(ctx: CaseEmailContext) {
  const body = html(`
    <h2 style="margin:0 0 12px;">طلب صرف اعتمده الموظف</h2>
    <p>اعتمد الموظف طلب الصرف <strong>${ctx.caseNumber}</strong> (مشروع ${ctx.projectName}، المطوّر ${ctx.developerName})، والمبلغ ${fmtAmount(ctx.amountSar)}.</p>
    <p>الطلب بانتظار مراجعتك بصفتك المشرف.</p>
    <p><a href="${ctx.caseUrl}" style="display:inline-block;padding:10px 16px;background:#0d9488;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">فتح الطلب</a></p>
  `)
  return withTimeout(sendEmail({
    to: ctx.to,
    from: DSB_FROM,
    subject: 'طلب صرف اعتمده الموظف — بانتظار المشرف',
    html: body,
    locale: 'ar',
  }))
}

/** Supervisor approved → goes to owner for signing. */
export function sendSupervisorApprovedEmail(ctx: CaseEmailContext) {
  const body = html(`
    <h2 style="margin:0 0 12px;">طلب صرف بانتظار التوقيع</h2>
    <p>اعتمد المشرف طلب الصرف <strong>${ctx.caseNumber}</strong> (مشروع ${ctx.projectName}، المطوّر ${ctx.developerName})، والمبلغ ${fmtAmount(ctx.amountSar)}.</p>
    <p>الطلب بانتظار توقيعك.</p>
    <p><a href="${ctx.caseUrl}" style="display:inline-block;padding:10px 16px;background:#0d9488;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">فتح للتوقيع</a></p>
  `)
  return withTimeout(sendEmail({
    to: ctx.to,
    from: DSB_FROM,
    subject: 'طلب صرف بانتظار توقيعك',
    html: body,
    locale: 'ar',
  }))
}

/** Anyone in the review chain sent the case back to the developer. */
export function sendSentBackToDeveloperEmail(ctx: CaseEmailContext) {
  const body = html(`
    <h2 style="margin:0 0 12px;">أُعيد إليك طلب الصرف لإجراء تعديلات</h2>
    <p>تمت إعادة طلب الصرف <strong>${ctx.caseNumber}</strong> (مشروع ${ctx.projectName}) إليك لإجراء تعديلات.</p>
    ${ctx.reason ? `<p><strong>السبب:</strong><br/>${ctx.reason.replace(/</g, '&lt;')}</p>` : ''}
    <p><a href="${ctx.caseUrl}" style="display:inline-block;padding:10px 16px;background:#0d9488;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">فتح الطلب وتعديله</a></p>
  `)
  return withTimeout(sendEmail({
    to: ctx.to,
    from: DSB_FROM,
    subject: 'أُعيد إليك طلب الصرف لإجراء تعديلات',
    html: body,
    locale: 'ar',
  }))
}

/** Owner signed → notify developer + everyone in chain. */
export function sendSignedEmail(ctx: CaseEmailContext) {
  const body = html(`
    <h2 style="margin:0 0 12px;">تم توقيع طلب الصرف</h2>
    <p>تم توقيع طلب الصرف <strong>${ctx.caseNumber}</strong> (مشروع ${ctx.projectName}، المطوّر ${ctx.developerName})، والمبلغ ${fmtAmount(ctx.amountSar)}.</p>
    <p><a href="${ctx.caseUrl}" style="display:inline-block;padding:10px 16px;background:#0d9488;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">عرض الطلب</a></p>
  `)
  return withTimeout(sendEmail({
    to: ctx.to,
    from: DSB_FROM,
    subject: 'تم توقيع طلب الصرف',
    html: body,
    locale: 'ar',
  }))
}
