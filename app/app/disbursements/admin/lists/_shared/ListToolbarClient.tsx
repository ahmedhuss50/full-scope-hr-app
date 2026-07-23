'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'

/**
 * Client-side wrapper for the tenant-wide list toolbars. Keeps the input
 * value live so users can type freely; submits GET to `basePath` with the
 * current values on Enter, form submit, or a filter change.
 *
 * We avoid `<form action=…>` on server components because we need to
 * preserve auxiliary URL params (sort, dir) as hidden inputs while giving
 * dropdown changes the same "submit and re-fetch" behavior. Building the
 * URL manually + `router.push` keeps the URL clean.
 */

export type ListProjectOption = { id: string; name_ar: string }
export type ListDropdownOption = { value: string; label: string }

export interface ExtraSelect {
  name: string
  label: string
  value: string
  options: ListDropdownOption[]
}

export function ListToolbarClient({
  basePath,
  initialQ,
  initialProjectFilter,
  projects,
  searchPlaceholder,
  extraSelects,
  preservedParams,
}: {
  basePath: string
  initialQ: string
  initialProjectFilter: string
  projects: ListProjectOption[]
  searchPlaceholder: string
  extraSelects: ExtraSelect[]
  preservedParams: Record<string, string>
}) {
  const router = useRouter()
  const [q, setQ] = useState(initialQ)
  const [projectFilter, setProjectFilter] = useState(initialProjectFilter)
  const [extras, setExtras] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const s of extraSelects) init[s.name] = s.value
    return init
  })

  function submit(overrides: Partial<{ q: string; project: string; extras: Record<string, string> }> = {}) {
    const params = new URLSearchParams()
    const nextQ = overrides.q ?? q
    const nextProject = overrides.project ?? projectFilter
    const nextExtras = overrides.extras ?? extras
    if (nextQ) params.set('q', nextQ)
    if (nextProject) params.set('project', nextProject)
    for (const [k, v] of Object.entries(nextExtras)) {
      if (v) params.set(k, v)
    }
    for (const [k, v] of Object.entries(preservedParams)) {
      if (v) params.set(k, v)
    }
    // Any change resets pagination.
    params.delete('page')
    router.push(`${basePath}?${params.toString()}`)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-3"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[16rem] bg-slate-50 border border-slate-200 rounded-lg px-3">
          <Search className="w-4 h-4 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent text-sm text-slate-900 py-2 focus:outline-none placeholder:text-slate-400"
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ('')
                submit({ q: '' })
              }}
              className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              aria-label="مسح البحث"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <select
          value={projectFilter}
          onChange={(e) => {
            const v = e.target.value
            setProjectFilter(v)
            submit({ project: v })
          }}
          className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        >
          <option value="">جميع المشاريع</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name_ar}
            </option>
          ))}
        </select>

        {extraSelects.map((s) => (
          <select
            key={s.name}
            value={extras[s.name] ?? ''}
            onChange={(e) => {
              const v = e.target.value
              const next = { ...extras, [s.name]: v }
              setExtras(next)
              submit({ extras: next })
            }}
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          >
            <option value="">{s.label}</option>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}

        <button
          type="submit"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold shadow-sm hover:bg-teal-700 transition"
        >
          بحث
        </button>
      </div>
    </form>
  )
}
