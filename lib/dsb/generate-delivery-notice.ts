/**
 * generate-delivery-notice.ts
 * ----------------------------------------------------------------------------
 * Server-side generator for the REGA quarterly-report delivery notice
 * («اشعار تسليم تقرير»).
 *
 * Strategy:
 *   - Ships the original template (lib/dsb/rega-templates/delivery-notice.docx)
 *     unmodified. We do not pre-process placeholders because
 *       (a) Word splits mixed RTL/LTR strings and digits across multiple
 *           `<w:t>` runs — e.g. "أ/208" becomes ["أ/", "208"], "02 /07/1445"
 *           becomes 5 separate runs. A naive string replace on document.xml
 *           misses these.
 *       (b) We can't safely edit binary docx files from every dev
 *           environment.
 *   - Instead: at generation time we unzip the docx, walk each paragraph in
 *     document.xml, concatenate its `<w:t>` runs into a single string, apply
 *     literal-string substitutions ("ايال الاصالة" → project.name_ar, etc.),
 *     and write the result back into the FIRST run while clearing the rest.
 *     This preserves paragraph-level formatting (bold header, RTL) while
 *     handling the split-run problem cleanly.
 *   - Also handles table cells the same way.
 *
 * Kept intentionally dependency-free of any DOM library — a tiny regex-based
 * text-run walker is enough for this template. If we start needing conditional
 * blocks or loops we'll swap to docxtemplater proper.
 *
 * Callable from server actions and API routes. Returns a Buffer of the
 * generated .docx.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PizZip = require('pizzip')

// Substitution map. Order matters: longer/more-specific strings must be
// replaced BEFORE the shorter substrings they contain (else the shorter
// pattern eats them first). Keep this synchronized with the template's
// literal wording — if the office ever revises the docx we update here.
export type DeliveryNoticeVars = {
  project_name: string
  rega_license_no: string
  developer_name: string
  accountant_office_name: string
  accountant_signer_name: string
  accountant_signer_title: string
  quarter_ar: string                 // 'الأول' | 'الثاني' | 'الثالث' | 'الرابع'
  year: string                       // '2026'
  delivery_date_hijri: string        // '27 / 01 /1447هـ'
  delivery_date_gregorian: string    // '12 / 07 /2026م'
  rega_agreement_date_hijri: string  // '02 /07/1445هـ'
  rega_agreement_date_gregorian: string // '14 /01/ 2024م'
  recipient_emails: string           // one or more emails joined with ' '
}

function buildReplacements(v: DeliveryNoticeVars): Array<[string, string]> {
  return [
    // Table 0 cell values — parentheses preserved to match the template's exact wording
    ['(ايال الاصالة)',                                   `(${v.project_name})`],
    ['(أ/208)',                                          `(${v.rega_license_no})`],
    ['(شركة محمد الحبيب العقارية)',                       `(${v.developer_name})`],
    ['(شركة إتقان للاستشارات المهنية)',                    `(${v.accountant_office_name})`],
    ['الربع (الثاني) لعام 2026م',                         `الربع (${v.quarter_ar}) لعام ${v.year}م`],
    ['27 / 01 /1447هـ الموافق 12 / 07 /2026م',            `${v.delivery_date_hijri} الموافق ${v.delivery_date_gregorian}`],
    ['(mahdi@etqan-cpa.sa) (h.albaqshi@fullscope.sa)',    v.recipient_emails],
    // Body paragraph phrases — order matters for the composite phrases
    ['ايال الاصالة- أ/208',                                `${v.project_name} - ${v.rega_license_no}`],
    ['ايال الاصالة',                                       v.project_name],
    ['شركة محمد الحبيب العقارية',                          v.developer_name],
    ['02 /07/1445هـ',                                    v.rega_agreement_date_hijri],
    ['14 /01/ 2024م',                                    v.rega_agreement_date_gregorian],
    ['الربع (الثاني) من عام 2026م',                        `الربع (${v.quarter_ar}) من عام ${v.year}م`],
    ['الربع الثاني من عام 2026م',                          `الربع ${v.quarter_ar} من عام ${v.year}م`],
    ['للربع (الثاني) من عام 2026م',                        `للربع (${v.quarter_ar}) من عام ${v.year}م`],
    ['للربع الثاني 2026م',                                 `للربع ${v.quarter_ar} ${v.year}م`],
    // Signer + accountant office (compound phrases first)
    ['شركة إتقان للاستشارات المهنية تتحفظ',                 `${v.accountant_office_name} تتحفظ`],
    ['فإن شركة إتقان للاستشارات المهنية',                   `فإن ${v.accountant_office_name}`],
    ['شركة إتقان للاستشارات المهنية',                       v.accountant_office_name],
    ['مهدي بوخمسين',                                      v.accountant_signer_name],
    ['المدير التنفيذي',                                    v.accountant_signer_title],
  ]
}

// -------------------------------------------------------------------------
// DOCX XML rewriter — the meat of it.
// -------------------------------------------------------------------------
//
// We match every `<w:p>...</w:p>` (paragraph) and every `<w:tc>...</w:tc>`
// (table cell), inline-transform them, and splice back. Inside each block
// we extract all `<w:t...>...</w:t>` runs, concat the text, run substitutions,
// and rewrite: put the full string into the FIRST `<w:t>` and blank the rest.
//
// A `<w:t>` element may have attributes (xml:space="preserve"). We keep the
// opening tag intact and only rewrite the inner text.
// -------------------------------------------------------------------------

const P_RE = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g
const TC_RE = /<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g
const T_RE = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function xmlUnescape(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
}

/**
 * Given a block of XML (a paragraph or a table cell) and an ordered list of
 * substitutions, merge all `<w:t>` runs' text, apply substitutions, and
 * rewrite the block so the FIRST `<w:t>` holds the whole result while any
 * subsequent `<w:t>` runs are blanked.
 */
function transformTextBlock(block: string, subs: Array<[string, string]>): string {
  const runs: Array<{ open: string; text: string; close: string; index: number; length: number }> = []
  let match: RegExpExecArray | null
  const re = new RegExp(T_RE.source, 'g')
  while ((match = re.exec(block)) !== null) {
    runs.push({
      open: match[1]!,
      text: xmlUnescape(match[2]!),
      close: match[3]!,
      index: match.index,
      length: match[0]!.length,
    })
  }
  if (runs.length === 0) return block

  const joined = runs.map((r) => r.text).join('')
  let modified = joined
  for (const [src, dst] of subs) {
    if (modified.includes(src)) modified = modified.split(src).join(dst)
  }
  if (modified === joined) return block

  // Rewrite: first run gets the full string; blank subsequent runs.
  // Preserve xml:space="preserve" so leading/trailing whitespace survives.
  let out = ''
  let cursor = 0
  runs.forEach((r, i) => {
    // Copy everything from previous cursor up to this run
    out += block.slice(cursor, r.index)
    if (i === 0) {
      // Ensure xml:space="preserve" is on the first run's opening tag —
      // else Word may trim whitespace from a multi-word replacement.
      let openTag = r.open
      if (!/xml:space=/.test(openTag)) {
        openTag = openTag.replace(/^<w:t/, '<w:t xml:space="preserve"')
      }
      out += openTag + xmlEscape(modified) + r.close
    } else {
      out += r.open + r.close // empty text
    }
    cursor = r.index + r.length
  })
  out += block.slice(cursor)
  return out
}

function rewriteDocumentXml(xml: string, vars: DeliveryNoticeVars): string {
  const subs = buildReplacements(vars)
  // Paragraphs first (outside table cells)
  let result = xml.replace(P_RE, (block) => transformTextBlock(block, subs))
  // Table cells (which contain paragraphs already handled above, but subs
  // inside cells sometimes span cell paragraphs — the paragraph pass covers
  // both since <w:tc> contains <w:p>).
  // Second pass over <w:tc> handles anything the paragraph pass missed
  // (defensive; harmless if idempotent).
  result = result.replace(TC_RE, (block) => transformTextBlock(block, subs))
  return result
}

// -------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------

const TEMPLATE_PATH = path.join(process.cwd(), 'lib/dsb/rega-templates/delivery-notice.docx')

export async function generateDeliveryNoticeDocx(vars: DeliveryNoticeVars): Promise<Buffer> {
  const templateBytes = await fs.readFile(TEMPLATE_PATH)
  const zip = new PizZip(templateBytes)
  // The main body lives in word/document.xml. Headers/footers (word/header*.xml,
  // word/footer*.xml) COULD contain the same phrases; iterate them too so
  // headers like "شركة إتقان..." also get substituted when present.
  const targets = [
    'word/document.xml',
    ...Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n)),
  ]
  for (const name of targets) {
    const file = zip.file(name)
    if (!file) continue
    const original = file.asText()
    const rewritten = rewriteDocumentXml(original, vars)
    zip.file(name, rewritten)
  }
  const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
  return out as Buffer
}

// Convenience: format a JS Date as a REGA-style Gregorian string.
// Example: "12 / 07 /2026م". Zero-padded day/month, Arabic ة suffix.
export function fmtGregorianArabic(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getFullYear())
  return `${dd} / ${mm} /${yyyy}م`
}

// Convenience: derive Arabic quarter label from month number (1-12).
export function quarterArabicFromMonth(month: number): 'الأول' | 'الثاني' | 'الثالث' | 'الرابع' {
  if (month <= 3) return 'الأول'
  if (month <= 6) return 'الثاني'
  if (month <= 9) return 'الثالث'
  return 'الرابع'
}
