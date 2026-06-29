'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Loader2, CheckCircle2, AlertTriangle, X } from 'lucide-react'
import { bulkImportProjectAccounts, type BulkImportAccountsRow } from './actions'

export type DeveloperLite = { id: string; company_name_ar: string }
export type ProjectLite = { id: string; name_ar: string; developer_id: string | null }

/**
 * Tenant-wide accounts importer.
 *
 * State machine: idle → parsing → preview → importing → done.
 * The preview lets the user fix any auto-match misses via a per-row dropdown
 * before sending the final batch to bulkImportProjectAccounts.
 */
type ParsedRow = {
  rowNumber: number          // 1-based row in the source file
  accountNumber: string      // raw value (could be IBAN or numeric)
  accountType: string        // رئيسي / انشائي / etc.
  developerRaw: string       // text from the file
  projectRaw: string         // text from the file
  bank: string
  // Auto-match result + user override.
  matchedProjectId: string | null  // null = no auto match
  selectedProjectId: string        // empty = skipped
  // Sortable derived display.
  derivedLabel: string             // "{type} — {bank}"
  isIban: boolean                  // starts with "SA"
}

type Mode = 'idle' | 'parsing' | 'preview' | 'importing' | 'done'

/**
 * Normalize Arabic text for fuzzy matching: trim, lowercase, strip tatweel,
 * collapse whitespace, normalize alef/yeh variants.
 */
function normAr(s: string): string {
  return s
    .replace(/ـ/g, '')             // tatweel
    .replace(/[إأآا]/g, 'ا')             // alef variants
    .replace(/[يى]/g, 'ي')               // yeh variants
    .replace(/ة/g, 'ه')                  // tah marbutah → heh
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function AccountsImporter({
  developers,
  projects,
}: {
  developers: DeveloperLite[]
  projects: ProjectLite[]
}) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('idle')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [doneStats, setDoneStats] = useState<{ inserted: number; skipped: number } | null>(null)

  // Pre-compute normalized lookup maps for fast auto-matching.
  const devByNorm = useMemo(() => {
    const m = new Map<string, DeveloperLite>()
    for (const d of developers) m.set(normAr(d.company_name_ar), d)
    return m
  }, [developers])

  const projectByDevAndName = useMemo(() => {
    // key = `${dev_id}::${normalized project name}` → project
    const m = new Map<string, ProjectLite>()
    for (const p of projects) {
      if (!p.developer_id) continue
      m.set(`${p.developer_id}::${normAr(p.name_ar)}`, p)
    }
    return m
  }, [projects])

  async function handleFile(file: File) {
    setError(null)
    setMode('parsing')
    try {
      // Dynamic import so xlsx isn't in the initial bundle.
      const moduleName = 'xlsx'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const XLSX: any = await import(/* webpackIgnore: true */ moduleName).catch(async () => {
        return await import('xlsx')
      })
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      // Read the first non-empty sheet.
      let parsed: ParsedRow[] = []
      for (const name of wb.SheetNames as string[]) {
        const sheet = wb.Sheets[name]
        const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true })
        const candidate = parseSheet(aoa)
        if (candidate.length > 0) {
          parsed = candidate
          break
        }
      }

      if (parsed.length === 0) {
        setError('لم نجد صفوفًا صالحة في الملف. تحقق من الأعمدة المطلوبة.')
        setMode('idle')
        return
      }

      // Auto-match each row.
      parsed = parsed.map((r) => {
        const dev = devByNorm.get(normAr(r.developerRaw))
        if (!dev) return r
        const proj = projectByDevAndName.get(`${dev.id}::${normAr(r.projectRaw)}`)
        if (!proj) return r
        return { ...r, matchedProjectId: proj.id, selectedProjectId: proj.id }
      })

      setRows(parsed)
      setMode('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل قراءة الملف.')
      setMode('idle')
    }
  }

  /** Convert a 2D array of cells into ParsedRow[]. Row 1 is the header — skip it. */
  function parseSheet(aoa: unknown[][]): ParsedRow[] {
    const out: ParsedRow[] = []
    for (let i = 1; i < aoa.length; i++) {
      const row = aoa[i] ?? []
      const accountNumberRaw = String(row[0] ?? '').trim()
      const accountType = String(row[1] ?? '').trim()
      const developerRaw = String(row[2] ?? '').trim()
      const projectRaw = String(row[3] ?? '').trim()
      const bank = String(row[4] ?? '').trim()

      // Skip empty / placeholder rows.
      if (!accountNumberRaw || accountNumberRaw === '-' || accountNumberRaw === '—') continue
      if (!developerRaw && !projectRaw) continue

      const isIban = /^SA/i.test(accountNumberRaw)
      const derivedLabel = [accountType, bank].filter(Boolean).join(' — ') || 'حساب'

      out.push({
        rowNumber: i + 1,
        accountNumber: accountNumberRaw,
        accountType,
        developerRaw,
        projectRaw,
        bank,
        matchedProjectId: null,
        selectedProjectId: '',
        derivedLabel,
        isIban,
      })
    }
    return out
  }

  async function confirmImport() {
    setError(null)
    const toImport: BulkImportAccountsRow[] = []
    for (const r of rows) {
      if (!r.selectedProjectId) continue
      toImport.push({
        project_id: r.selectedProjectId,
        label: r.derivedLabel,
        account_number: r.isIban ? null : r.accountNumber,
        bank_name: r.bank || null,
        iban: r.isIban ? r.accountNumber.toUpperCase() : null,
      })
    }
    if (toImport.length === 0) {
      setError('لم تختر أي صف للاستيراد. يجب تحديد المشروع لكل صف على الأقل.')
      return
    }
    setMode('importing')
    const res = await bulkImportProjectAccounts({ rows: toImport })
    if (!res.ok) {
      setError(res.error)
      setMode('preview')
      return
    }
    setDoneStats({
      inserted: res.inserted,
      skipped: rows.length - toImport.length,
    })
    setMode('done')
    router.refresh()
  }

  function reset() {
    setRows([])
    setError(null)
    setDoneStats(null)
    setMode('idle')
  }

  const matchedCount = rows.filter((r) => !!r.matchedProjectId).length
  const willImportCount = rows.filter((r) => !!r.selectedProjectId).length

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-4">
      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {mode === 'idle' && (
        <label className="block">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold shadow-sm hover:bg-teal-700 transition cursor-pointer">
            <Upload className="w-4 h-4" aria-hidden="true" />
            اختر ملف Excel
          </span>
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void handleFile(f)
            }}
          />
        </label>
      )}

      {mode === 'parsing' && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          جاري قراءة الملف…
        </div>
      )}

      {mode === 'preview' && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-slate-700">
              <span className="font-semibold">{rows.length}</span> صف ·
              <span className="text-emerald-700 font-semibold mx-1">{matchedCount}</span>
              مُطابَقة تلقائيًا ·
              <span className="text-slate-900 font-semibold mx-1">{willImportCount}</span>
              ستُستورد
            </div>
            <div className="inline-flex items-center gap-2">
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
                إلغاء
              </button>
              <button
                type="button"
                onClick={confirmImport}
                disabled={willImportCount === 0}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold shadow-sm hover:bg-emerald-700 transition disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                استيراد {willImportCount} حساب
              </button>
            </div>
          </div>

          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-y border-slate-200">
                <tr className="text-right">
                  <Th>الحالة</Th>
                  <Th>رقم الحساب</Th>
                  <Th>نوع الحساب</Th>
                  <Th>البنك</Th>
                  <Th>المطور (من الملف)</Th>
                  <Th>المشروع (من الملف)</Th>
                  <Th>المشروع المُطابَق</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, idx) => {
                  const status = !r.selectedProjectId
                    ? r.matchedProjectId === null
                      ? { cls: 'bg-amber-50 text-amber-800 ring-amber-200', label: 'لا توجد مطابقة', Icon: AlertTriangle }
                      : { cls: 'bg-slate-100 text-slate-600 ring-slate-200', label: 'تخطّي', Icon: X }
                    : r.matchedProjectId === r.selectedProjectId
                      ? { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'مُطابَقة', Icon: CheckCircle2 }
                      : { cls: 'bg-teal-50 text-teal-700 ring-teal-200', label: 'تعديل يدوي', Icon: CheckCircle2 }
                  return (
                    <tr key={r.rowNumber} className="hover:bg-slate-50/60">
                      <Td>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${status.cls}`}>
                          <status.Icon className="w-3 h-3" aria-hidden="true" />
                          {status.label}
                        </span>
                      </Td>
                      <Td>
                        <span className="font-mono text-xs">{r.accountNumber}</span>
                        {r.isIban && (
                          <span className="ms-1 text-[10px] font-semibold text-violet-700">IBAN</span>
                        )}
                      </Td>
                      <Td>{r.accountType || '—'}</Td>
                      <Td>{r.bank || '—'}</Td>
                      <Td className="max-w-[14rem] truncate">{r.developerRaw || '—'}</Td>
                      <Td className="max-w-[12rem] truncate">{r.projectRaw || '—'}</Td>
                      <Td>
                        <select
                          value={r.selectedProjectId}
                          onChange={(e) => {
                            const v = e.target.value
                            setRows((prev) => prev.map((row, i) => i === idx ? { ...row, selectedProjectId: v } : row))
                          }}
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                        >
                          <option value="">— تخطّي —</option>
                          {projects.map((p) => {
                            const dev = developers.find((d) => d.id === p.developer_id)
                            const label = dev
                              ? `${dev.company_name_ar} · ${p.name_ar}`
                              : p.name_ar
                            return <option key={p.id} value={p.id}>{label}</option>
                          })}
                        </select>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {mode === 'importing' && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          جاري الاستيراد…
        </div>
      )}

      {mode === 'done' && doneStats && (
        <div className="space-y-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <div className="font-semibold inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              تم الاستيراد بنجاح
            </div>
            <div className="mt-1 text-xs text-emerald-700">
              أُضيفت <span className="font-mono font-bold">{doneStats.inserted}</span> حسابات.
              {doneStats.skipped > 0 && (
                <> تم تخطّي <span className="font-mono font-bold">{doneStats.skipped}</span> صفًا.</>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            استيراد ملف آخر
          </button>
        </div>
      )}
    </section>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  )
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 text-sm text-slate-700 align-top ${className ?? ''}`}>
      {children}
    </td>
  )
}
