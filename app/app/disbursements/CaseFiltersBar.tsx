'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Filter, X, Search } from 'lucide-react'

/**
 * Reusable filter bar for case lists.
 *
 * All filters live in URL search params so the page can be reloaded /
 * bookmarked / shared and the state survives. The parent server component
 * reads the same params to filter its DB query.
 *
 * URL params used:
 *   ?client=<uuid>          — dsb_developers.id
 *   ?project=<uuid>         — dsb_projects.id
 *   ?employee=<uuid>        — public.users.id (assigned to project)
 *   ?status=<status>        — dsb_cases.status
 *   ?from=<YYYY-MM-DD>      — submitted_at >= start of that day
 *   ?to=<YYYY-MM-DD>        — submitted_at <  end of that day
 *   ?q=<text>               — case_number or voucher_number_text contains
 *
 * Drop into any page that lists cases; the page just needs to honour the
 * same params in its query.
 */

export type FilterOption = { id: string; label: string }

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'with_employee',          label: 'بانتظار المراجع' },
  { value: 'with_supervisor',        label: 'بانتظار المشرف' },
  { value: 'with_owner',             label: 'بانتظار مدير المراجعة' },
  { value: 'signed',                 label: 'جاهزة للتسليم' },
  { value: 'delivered',              label: 'مسلَّمة (مؤرشفة)' },
  { value: 'sent_back_to_developer', label: 'أُعيدت إلى المطوّر' },
  { value: 'draft',                  label: 'مسودة' },
  { value: 'cancelled',              label: 'ملغاة' },
]

export function CaseFiltersBar({
  clients,
  projects,
  employees,
  hideStatus = false,
}: {
  clients: FilterOption[]
  projects: Array<FilterOption & { developer_id?: string | null }>
  employees: FilterOption[]
  /** Hide the status filter (chip + select). Used on pages like the Archive
   *  where status is already fixed (delivered). Default false. */
  hideStatus?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname() ?? '/app/disbursements'
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  // Local mirror of URL state so inputs feel responsive — write to URL on change.
  const currentClient = searchParams.get('client') ?? ''
  const currentProject = searchParams.get('project') ?? ''
  const currentEmployee = searchParams.get('employee') ?? ''
  const currentStatus = searchParams.get('status') ?? ''
  const currentFrom = searchParams.get('from') ?? ''
  const currentTo = searchParams.get('to') ?? ''
  const currentQ = searchParams.get('q') ?? ''

  const [qLocal, setQLocal] = useState(currentQ)
  const [expanded, setExpanded] = useState(false)

  // Project options filtered by selected client (if any), so the operator
  // only sees projects belonging to that client.
  const filteredProjects = useMemo(() => {
    if (!currentClient) return projects
    return projects.filter((p) => !p.developer_id || p.developer_id === currentClient)
  }, [currentClient, projects])

  function applyParams(next: URLSearchParams) {
    // Preserve any unrelated params (e.g. ?tab= on dashboards) — only edit
    // the filter ones. We assume the caller passes a full URLSearchParams
    // already merged with the existing query string.
    const qs = next.toString()
    const url = qs ? `${pathname}?${qs}` : pathname
    startTransition(() => router.replace(url, { scroll: false }))
  }

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString())
    if (value && value.trim() !== '') next.set(key, value.trim())
    else next.delete(key)
    // Reset project if client changes and the previous project doesn't fit.
    if (key === 'client') {
      const proj = next.get('project')
      if (proj) {
        const stillValid = projects.some(
          (p) => p.id === proj && (!p.developer_id || p.developer_id === value),
        )
        if (!stillValid) next.delete('project')
      }
    }
    applyParams(next)
  }

  function clearAll() {
    const next = new URLSearchParams(searchParams.toString())
    ;['client', 'project', 'employee', 'status', 'from', 'to', 'q'].forEach((k) => next.delete(k))
    setQLocal('')
    applyParams(next)
  }

  const activeCount = [
    currentClient,
    currentProject,
    currentEmployee,
    currentStatus,
    currentFrom,
    currentTo,
    currentQ,
  ].filter((v) => v && v.trim() !== '').length

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500'
  const labelCls = 'text-[11px] font-semibold text-slate-500 mb-1 block'

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {/* Compact header — always visible */}
      <div className="flex items-center gap-2 flex-wrap p-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
        >
          <Filter className="w-3.5 h-3.5" aria-hidden="true" />
          الفلاتر
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.25rem] px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-800 text-[10px] font-mono">
              {activeCount}
            </span>
          )}
        </button>

        {/* Quick search always visible */}
        <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2" aria-hidden="true" />
            <input
              type="text"
              placeholder="بحث: رقم الطلب/السند/العقد/الوحدة، الاسم، الجوال، الهوية…"
              value={qLocal}
              onChange={(e) => setQLocal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setParam('q', qLocal) }}
              onBlur={() => { if (qLocal !== currentQ) setParam('q', qLocal) }}
              className={`${inputCls} ps-8`}
            />
          </div>
        </div>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-red-700 hover:bg-red-50 transition"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            مسح الفلاتر
          </button>
        )}
      </div>

      {/* Active chips */}
      {activeCount > 0 && (
        <div className="px-3 pb-2 flex items-center gap-1.5 flex-wrap border-t border-slate-100 pt-2">
          {currentClient && (
            <Chip
              label={`العميل: ${clients.find((c) => c.id === currentClient)?.label ?? '—'}`}
              onRemove={() => setParam('client', null)}
            />
          )}
          {currentProject && (
            <Chip
              label={`المشروع: ${projects.find((p) => p.id === currentProject)?.label ?? '—'}`}
              onRemove={() => setParam('project', null)}
            />
          )}
          {currentEmployee && (
            <Chip
              label={`الموظف: ${employees.find((e) => e.id === currentEmployee)?.label ?? '—'}`}
              onRemove={() => setParam('employee', null)}
            />
          )}
          {currentStatus && !hideStatus && (
            <Chip
              label={`الحالة: ${STATUS_OPTIONS.find((s) => s.value === currentStatus)?.label ?? currentStatus}`}
              onRemove={() => setParam('status', null)}
            />
          )}
          {currentFrom && (
            <Chip label={`من: ${currentFrom}`} onRemove={() => setParam('from', null)} />
          )}
          {currentTo && (
            <Chip label={`إلى: ${currentTo}`} onRemove={() => setParam('to', null)} />
          )}
          {currentQ && (
            <Chip label={`بحث: ${currentQ}`} onRemove={() => { setQLocal(''); setParam('q', null) }} />
          )}
        </div>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-slate-100 p-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>العميل</label>
            <select className={inputCls} value={currentClient} onChange={(e) => setParam('client', e.target.value || null)}>
              <option value="">— الكل —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>المشروع</label>
            <select className={inputCls} value={currentProject} onChange={(e) => setParam('project', e.target.value || null)}>
              <option value="">— الكل —</option>
              {filteredProjects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>الموظف المسؤول</label>
            <select className={inputCls} value={currentEmployee} onChange={(e) => setParam('employee', e.target.value || null)}>
              <option value="">— الكل —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </div>
          {!hideStatus && (
            <div>
              <label className={labelCls}>الحالة</label>
              <select className={inputCls} value={currentStatus} onChange={(e) => setParam('status', e.target.value || null)}>
                <option value="">— الكل —</option>
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={labelCls}>من تاريخ</label>
            <input type="date" className={inputCls} value={currentFrom} onChange={(e) => setParam('from', e.target.value || null)} dir="ltr" />
          </div>
          <div>
            <label className={labelCls}>إلى تاريخ</label>
            <input type="date" className={inputCls} value={currentTo} onChange={(e) => setParam('to', e.target.value || null)} dir="ltr" />
          </div>
        </div>
      )}
    </section>
  )
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-teal-600 hover:bg-teal-100 hover:text-teal-800 transition"
        aria-label="إزالة الفلتر"
      >
        <X className="w-3 h-3" aria-hidden="true" />
      </button>
    </span>
  )
}
