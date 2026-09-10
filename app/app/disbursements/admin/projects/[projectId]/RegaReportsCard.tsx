/**
 * RegaReportsCard — «تقارير REGA الربعية»
 *
 * The quarter-download surface for a project. Renders three groups of
 * download buttons (delivery notice docx · buyers register xlsx ·
 * accountant workbook xlsx). Owner-only — caller decides visibility.
 *
 * Lives on the project detail page. When the project hasn't had its REGA
 * license filled in yet, we still render the buttons — the generators
 * substitute «لم يُعبَّأ» for missing fields so the owner can see the
 * output shape and know which fields to add on the تهيئة المشروع screen.
 */
import { FileDown } from 'lucide-react'

export function RegaReportsCard({
  projectId,
  projectName,
  currentYear,
  regaReady,
}: {
  projectId: string
  projectName: string
  currentYear: number
  regaReady: boolean
}) {
  const quarters: Array<{ code: 'Q1' | 'Q2' | 'Q3' | 'Q4'; label: string }> = [
    { code: 'Q1', label: 'الربع الأول' },
    { code: 'Q2', label: 'الربع الثاني' },
    { code: 'Q3', label: 'الربع الثالث' },
    { code: 'Q4', label: 'الربع الرابع' },
  ]
  return (
    <section className="rounded-xl border border-teal-200 bg-teal-50/30 shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-2">
        <FileDown className="w-5 h-5 text-teal-700" aria-hidden="true" />
        <h2 className="serif font-bold text-base text-slate-900">
          تقارير REGA الربعية
        </h2>
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">
        توليد تقارير الهيئة العامة للعقار الربعية باستخدام بيانات المشروع الحية.{' '}
        {!regaReady && (
          <span className="text-amber-700 font-semibold">
            أكمِل بيانات REGA في «تهيئة المشروع» ليظهر رقم الرخصة وتاريخ الاتفاقية في المستندات.
          </span>
        )}
      </p>

      {/* 1) Delivery notice (docx) — one per quarter */}
      <div>
        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
          إشعار التسليم (Word)
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {quarters.map((q) => (
            <a
              key={q.code}
              href={`/api/dsb-delivery-notice?project_id=${projectId}&quarter=${q.code}&year=${currentYear}`}
              download
              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white border border-teal-300 text-teal-800 text-sm font-semibold hover:bg-teal-50 transition"
              title={`تنزيل إشعار تسليم ${q.label} ${currentYear} لمشروع ${projectName}`}
            >
              <FileDown className="w-4 h-4" aria-hidden="true" />
              {q.label} {currentYear}
            </a>
          ))}
        </div>
      </div>

      {/* 2) Buyers register (xlsx) — snapshot, project-wide */}
      <div>
        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
          سجل المشترين (Excel)
        </div>
        <a
          href={`/api/dsb-buyers-register-xlsx?project_id=${projectId}`}
          download
          className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white border border-teal-300 text-teal-800 text-sm font-semibold hover:bg-teal-50 transition"
        >
          <FileDown className="w-4 h-4" aria-hidden="true" />
          تنزيل سجل المشترين
        </a>
      </div>

      {/* 3) Accountant workbook (xlsx) — one per quarter */}
      <div>
        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
          نموذج المحاسب القانوني (Excel)
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {quarters.map((q) => (
            <a
              key={`acc-${q.code}`}
              href={`/api/dsb-accountant-workbook-xlsx?project_id=${projectId}&quarter=${q.code}&year=${currentYear}`}
              download
              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white border border-teal-300 text-teal-800 text-sm font-semibold hover:bg-teal-50 transition"
              title={`تنزيل نموذج المحاسب القانوني ${q.label} ${currentYear} لمشروع ${projectName}`}
            >
              <FileDown className="w-4 h-4" aria-hidden="true" />
              {q.label} {currentYear}
            </a>
          ))}
        </div>
      </div>

      <div className="text-[11px] text-slate-500">
        الملفات القادمة (قريبًا): التقرير الموقّع (PDF) · حزمة التسليم كاملة (ZIP)
      </div>
    </section>
  )
}
