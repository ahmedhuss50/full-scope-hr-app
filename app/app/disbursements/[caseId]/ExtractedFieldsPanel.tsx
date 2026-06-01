import { Sparkles } from 'lucide-react'

// -----------------------------------------------------------------------------
// ExtractedFieldsPanel
// -----------------------------------------------------------------------------
// Read-only display of the latest AI extraction blob stored on
// `dsb_cases.extracted_fields` (populated by the n8n breakdown workflow).
//
// Design notes:
//   - Server component (no interactivity yet) — mirrors the visual style of
//     BreakdownEditor: white card, slate borders, teal accent, serif heading.
//   - All copy is Arabic, RTL — the page wrapper already sets dir="rtl".
//   - Numbers + account/IBAN values use mono font for legibility; names use
//     the regular sans stack.
//   - Developer-name match badge: compared case-insensitively against the
//     case's project developer; green ✓ for match, red ✗ otherwise.
//   - If `extracted` itself is null/undefined we render an empty-state card so
//     the reviewer still sees the panel header and knows AI will fill it.
// -----------------------------------------------------------------------------

export type DisbursementTypeCode =
  | 'admin_marketing'
  | 'construction'
  | 'bank_financing'
  | 'moh_incentive'
  | 'unit_seriousness_fees'
  | 'vat_project_registry'
  | 'vat_sales_payment'
  | 'other'

export type ExtractedFields = {
  developer_name_ar?: string | null
  developer_name_en?: string | null
  beneficiary_name_ar?: string | null
  beneficiary_name_en?: string | null
  beneficiary_account_number?: string | null
  beneficiary_bank_name?: string | null
  beneficiary_iban?: string | null
  invoice_number?: string | null
  invoice_date?: string | null
  invoice_total_sar?: number | null
  invoice_vat_sar?: number | null
  issued_to?: string | null
  disbursement_type_label_ar?: string | null
  disbursement_type_code?: DisbursementTypeCode | null
  line_items?: Array<{
    description_ar?: string | null
    description_en?: string | null
    quantity?: number | null
    unit_price_sar?: number | null
    line_total_sar?: number | null
  }> | null
  confidence_overall?: number | null
}

// Canonical Arabic labels for each disbursement type. Used when the AI returns
// the code but the document-extracted label is missing/garbled — we fall back
// to the canonical wording.
const DISBURSEMENT_TYPE_LABELS_AR: Record<DisbursementTypeCode, string> = {
  admin_marketing:       'مصاريف إدارية وتسويقية',
  construction:          'مصاريف إنشائية',
  bank_financing:        'من قيمة تمويل بنكي',
  moh_incentive:         'من قيمة حافز وزارة الإسكان',
  unit_seriousness_fees: 'رسوم الجدية في شراء الوحدة العقارية المختارة',
  vat_project_registry:  'ضريبة القيمة المضافة عن السجل الضريبي للمشروع',
  vat_sales_payment:     'سداد ضريبة القيمة المضافة المستلمة عن المبيعات للمشروع',
  other:                 'أخرى',
}

type Fmt = {
  fmtSar: (n: number | null) => string
  fmtDate: (s: string | null) => string
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLocaleLowerCase()
}

function confidencePill(confidence: number): { cls: string; pct: string } {
  const pct = Math.max(0, Math.min(1, confidence))
  const display = `${Math.round(pct * 100)}%`
  if (pct >= 0.85)      return { cls: 'bg-green-50 text-green-700 ring-green-200', pct: display }
  if (pct >= 0.6)       return { cls: 'bg-amber-50 text-amber-700 ring-amber-200', pct: display }
  return                       { cls: 'bg-red-50 text-red-700 ring-red-200',       pct: display }
}

function HeaderCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
      {children}
    </section>
  )
}

function PanelHeader({ confidence }: { confidence: number | null | undefined }) {
  const hasConfidence = typeof confidence === 'number' && isFinite(confidence)
  const pill = hasConfidence ? confidencePill(confidence as number) : null
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="serif font-bold text-lg text-slate-900 inline-flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-teal-600" aria-hidden="true" />
          البيانات المستخرجة من الوثيقة
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          استخرجها الذكاء الاصطناعي. راجعها قبل الاعتماد.
        </p>
      </div>
      {pill && (
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ring-inset ${pill.cls}`}
          aria-label={`ثقة الاستخراج ${pill.pct}`}
        >
          ثقة: {pill.pct}
        </span>
      )}
    </div>
  )
}

function Row({
  label,
  value,
  mono,
  trailing,
}: {
  label: string
  value: string
  mono?: boolean
  trailing?: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 items-baseline py-2 border-b border-slate-100 last:border-b-0">
      <div className="text-xs font-semibold text-slate-500 text-end">{label}</div>
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <span
          className={`text-sm text-slate-900 break-all ${mono ? 'font-mono tracking-tight' : ''}`}
        >
          {value}
        </span>
        {trailing}
      </div>
    </div>
  )
}

function MatchBadge({
  extracted,
  expected,
}: {
  extracted: string | null | undefined
  expected: string | null | undefined
}) {
  if (!extracted) return null
  if (!expected) return null
  const isMatch = norm(extracted) === norm(expected)
  if (isMatch) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset bg-green-50 text-green-700 ring-green-200">
        ✓ يطابق المشروع
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset bg-red-50 text-red-700 ring-red-200">
      ✗ لا يطابق ({expected})
    </span>
  )
}

export function ExtractedFieldsPanel({
  extracted,
  expectedDeveloperNameAr,
  fmt,
}: {
  extracted: ExtractedFields | null
  expectedDeveloperNameAr: string | null
  fmt: Fmt
}) {
  if (!extracted) {
    return (
      <HeaderCard>
        <PanelHeader confidence={null} />
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-500">
          لم يتم استخراج بيانات بعد. سيتم التنفيذ تلقائيًا عند تشغيل الذكاء الاصطناعي.
        </div>
      </HeaderCard>
    )
  }

  const { fmtSar, fmtDate } = fmt
  const dash = '—'

  // Developer name display: prefer Arabic; fall back to English; otherwise dash.
  const devDisplay =
    extracted.developer_name_ar ??
    extracted.developer_name_en ??
    null

  // Beneficiary display: prefer Arabic; fall back to English; otherwise dash.
  const benDisplay =
    extracted.beneficiary_name_ar ??
    extracted.beneficiary_name_en ??
    null

  const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : []

  // Disbursement type — prefer the literal label the AI read off the document;
  // fall back to the canonical label for the matched code; only show the dash
  // when neither is available. The code itself is shown as a small mono pill
  // next to the label so the reviewer can sanity-check the categorization.
  const dtypeCode = (extracted.disbursement_type_code ?? null) as DisbursementTypeCode | null
  const dtypeLiteralLabel = extracted.disbursement_type_label_ar?.trim() || null
  const dtypeCanonicalLabel =
    dtypeCode && dtypeCode in DISBURSEMENT_TYPE_LABELS_AR
      ? DISBURSEMENT_TYPE_LABELS_AR[dtypeCode]
      : null
  const dtypeDisplay = dtypeLiteralLabel ?? dtypeCanonicalLabel ?? null

  return (
    <HeaderCard>
      <PanelHeader confidence={extracted.confidence_overall ?? null} />

      {dtypeDisplay && (
        <div className="rounded-lg border border-teal-200 bg-teal-50/40 px-4 py-3">
          <div className="text-[11px] font-semibold text-teal-700 mb-1">نوع الصرف</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900">{dtypeDisplay}</span>
            {dtypeCode && (
              <span className="inline-block text-[10px] font-mono text-teal-700 bg-white border border-teal-200 rounded px-1.5 py-0.5">
                {dtypeCode}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="px-4">
          <Row
            label="اسم المطور"
            value={devDisplay ?? dash}
            trailing={
              <MatchBadge
                extracted={extracted.developer_name_ar}
                expected={expectedDeveloperNameAr}
              />
            }
          />
          <Row label="المستفيد" value={benDisplay ?? dash} />
          <Row
            label="حساب المستفيد"
            value={extracted.beneficiary_account_number ?? dash}
            mono={!!extracted.beneficiary_account_number}
          />
          <Row label="بنك المستفيد" value={extracted.beneficiary_bank_name ?? dash} />
          <Row
            label="الآيبان"
            value={extracted.beneficiary_iban ?? dash}
            mono={!!extracted.beneficiary_iban}
          />
          <Row
            label="رقم الفاتورة"
            value={extracted.invoice_number ?? dash}
            mono={!!extracted.invoice_number}
          />
          <Row label="تاريخ الفاتورة" value={fmtDate(extracted.invoice_date ?? null)} />
          <Row
            label="إجمالي الفاتورة"
            value={fmtSar(extracted.invoice_total_sar ?? null)}
            mono={extracted.invoice_total_sar != null}
          />
          <Row
            label="ضريبة القيمة المضافة"
            value={fmtSar(extracted.invoice_vat_sar ?? null)}
            mono={extracted.invoice_vat_sar != null}
          />
          {extracted.issued_to && (
            <Row label="صادرة إلى" value={extracted.issued_to} />
          )}
        </div>
      </div>

      {lineItems.length > 0 && (
        <div className="space-y-2">
          <h3 className="serif font-bold text-sm text-slate-900">بنود الفاتورة</h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold text-slate-500 bg-slate-50 border-b border-slate-200">
                  <th className="text-start py-2 px-3">الوصف</th>
                  <th className="text-end py-2 px-3 w-20">الكمية</th>
                  <th className="text-end py-2 px-3 w-28">السعر</th>
                  <th className="text-end py-2 px-3 w-28">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li, i) => {
                  const desc =
                    li.description_ar ??
                    li.description_en ??
                    dash
                  return (
                    <tr key={i} className="border-b border-slate-100 last:border-b-0">
                      <td className="py-2 px-3 text-slate-900">{desc}</td>
                      <td className="py-2 px-3 text-end text-slate-900 font-mono">
                        {li.quantity != null ? li.quantity : dash}
                      </td>
                      <td className="py-2 px-3 text-end text-slate-900 font-mono">
                        {fmtSar(li.unit_price_sar ?? null)}
                      </td>
                      <td className="py-2 px-3 text-end text-slate-900 font-mono">
                        {fmtSar(li.line_total_sar ?? null)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </HeaderCard>
  )
}
