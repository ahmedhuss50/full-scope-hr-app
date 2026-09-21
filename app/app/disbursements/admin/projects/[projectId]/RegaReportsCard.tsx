'use client'

/**
 * RegaReportsCard — «تقارير REGA الربعية»
 *
 * The quarter-download surface for a project. Owner-only. The user picks
 * a year + quarter once at the top, and the three download buttons
 * (delivery notice docx · buyers register xlsx · accountant workbook xlsx)
 * all use that period. For the buyers register, which is a snapshot, an
 * optional from/to date filter narrows the sales rows to just the sales
 * inside that window.
 */
import { useMemo, useState } from 'react'
import { FileDown, Calendar } from 'lucide-react'

const QUARTERS = [
  { code: 'Q1' as const, label: 'الربع الأول' },
  { code: 'Q2' as const, label: 'الربع الثاني' },
  { code: 'Q3' as const, label: 'الربع الثالث' },
  { code: 'Q4' as const, label: 'الربع الرابع' },
]

type QCode = typeof QUARTERS[number]['code']

function currentPeriod(): { year: number; quarter: QCode } {
  const now = new Date()
  const q = Math.min(4, Math.max(1, Math.ceil((now.getMonth() + 1) / 3))) as 1 | 2 | 3 | 4
  return { year: now.getFullYear(), quarter: (`Q${q}` as QCode) }
}

function quarterDateRange(year: number, quarter: QCode): { from: string; to: string } {
  const q = Number(quarter.replace('Q', ''))
  const startMonth = (q - 1) * 3 + 1
  const from = `${year}-${String(startMonth).padStart(2, '0')}-01`
  const end = new Date(Date.UTC(year, startMonth + 2, 0))
  const to = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`
  return { from, to }
}

export function RegaReportsCard({
  projectId,
  projectName,
  currentYear,
  regaReady,
}: {
  projectId: string
  projectName: string
  /** Kept for backwards-compat; the picker now controls year. */
  currentYear: number
  regaReady: boolean
}) {
  const nowPeriod = currentPeriod()
  const [year, setYear] = useState<number>(nowPeriod.year || currentYear)
  const [quarter, setQuarter] = useState<QCode>(nowPeriod.quarter)

  // Optional custom range for the buyers register snapshot.
  const [useCustomRange, setUseCustomRange] = useState(false)
  const q = quarterDateRange(year, quarter)
  const [fromDate, setFromDate] = useState<string>(q.from)
  const [toDate, setToDate] = useState<string>(q.to)

  // Year dropdown: current year ± 3
  const yearOptions = useMemo(() => {
    const cur = nowPeriod.year
    return [cur + 1, cur, cur - 1, cur - 2, cur - 3]
  }, [nowPeriod.year])

  const qLabel = QUARTERS.find((qq) => qq.code === quarter)?.label ?? ''

  // Effective date range: user-picked custom, or the quarter's implied range.
  const effFrom = useCustomRange ? fromDate : q.from
  const effTo   = useCustomRange ? toDate   : q.to

  const deliveryHref   = `/api/dsb-delivery-notice?project_id=${projectId}&quarter=${quarter}&year=${year}`
  const accountantHref = `/api/dsb-accountant-workbook-xlsx?project_id=${projectId}&quarter=${quarter}&year=${year}`
  const buyersHref     = `/api/dsb-buyers-register-xlsx?project_id=${projectId}&from=${effFrom}&to=${effTo}`

  const btn =
    'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-bold shadow-sm hover:bg-teal-700 transition'

  return (
    <section className="rounded-xl border border-teal-200 bg-teal-50/30 shadow-sm p-5 space-y-4" dir="rtl">
      <div className="flex items-center gap-2">
        <FileDown className="w-5 h-5 text-teal-700" aria-hidden="true" />
        <h2 className="serif font-bold text-base text-slate-900">
          تقارير REGA الربعية
        </h2>
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">
        اختر الفترة أدناه، ثم نزّل أي تقرير مطلوب.
        {!regaReady && (
          <span className="text-amber-700 font-semibold">
            {' '}أكمِل بيانات REGA في «تهيئة المشروع» ليظهر رقم الرخصة وتاريخ الاتفاقية في المستندات.
          </span>
        )}
      </p>

      {/* Period picker */}
      <div className="rounded-lg bg-white border border-teal-200 p-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar className="w-4 h-4 text-teal-700" aria-hidden="true" />
          <span className="text-xs font-bold text-slate-700">الفترة:</span>
          <select
            value={year}
            onChange={(e) => {
              const y = Number(e.target.value)
              setYear(y)
              if (!useCustomRange) {
                const r = quarterDateRange(y, quarter)
                setFromDate(r.from); setToDate(r.to)
              }
            }}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-mono text-slate-900"
            dir="ltr"
          >
            {yearOptions.map((y) => (<option key={y} value={y}>{y}</option>))}
          </select>
          <select
            value={quarter}
            onChange={(e) => {
              const qq = e.target.value as QCode
              setQuarter(qq)
              if (!useCustomRange) {
                const r = quarterDateRange(year, qq)
                setFromDate(r.from); setToDate(r.to)
              }
            }}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-semibold text-slate-900"
          >
            {QUARTERS.map((qq) => (<option key={qq.code} value={qq.code}>{qq.label}</option>))}
          </select>
          <span className="text-[11px] text-slate-500 font-mono" dir="ltr">
            {q.from} → {q.to}
          </span>
        </div>

        <label className="inline-flex items-start gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={useCustomRange}
            onChange={(e) => setUseCustomRange(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <span className="text-slate-700">
            استخدام نطاق تواريخ مخصص (يؤثر فقط على «سجل المشترين»)
          </span>
        </label>
        {useCustomRange && (
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[11px] text-slate-600">من</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-mono" dir="ltr" />
            <label className="text-[11px] text-slate-600">إلى</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-mono" dir="ltr" />
          </div>
        )}
      </div>

      {/* Download buttons — one per report type, all use the picked period */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <a
          href={deliveryHref}
          download
          className={btn}
          title={`إشعار تسليم ${qLabel} ${year} لمشروع ${projectName}`}
        >
          <FileDown className="w-4 h-4" aria-hidden="true" />
          إشعار التسليم (Word)
        </a>
        <a
          href={buyersHref}
          download
          className={btn}
          title={`سجل المشترين ${useCustomRange ? `(${effFrom} → ${effTo})` : `${qLabel} ${year}`} لمشروع ${projectName}`}
        >
          <FileDown className="w-4 h-4" aria-hidden="true" />
          سجل المشترين (Excel)
        </a>
        <a
          href={accountantHref}
          download
          className={btn}
          title={`نموذج المحاسب القانوني ${qLabel} ${year} لمشروع ${projectName}`}
        >
          <FileDown className="w-4 h-4" aria-hidden="true" />
          نموذج المحاسب القانوني (Excel)
        </a>
      </div>

      <div className="text-[11px] text-slate-500">
        الملفات القادمة (قريبًا): التقرير الموقّع (PDF) · حزمة التسليم كاملة (ZIP)
      </div>
    </section>
  )
}
