import Link from 'next/link'
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react'
import { ListToolbarClient } from './ListToolbarClient'

/**
 * URL-driven list controls shared by the three tenant-wide list pages
 * (units, buyers, contracts). Everything is server-render friendly:
 *   - ListToolbar renders a form that GETs back to `basePath` with the
 *     search string + filter dropdowns as query params.
 *   - SortHeader renders a <th> link that flips ?sort= and ?dir=.
 *   - buildSortHref is a URL builder used by pagination + SortHeader.
 *
 * Deliberately NO client-side state — each interaction produces a URL,
 * the page re-renders server-side. Keeps the pages simple to reason
 * about and lets deep links work out of the box.
 */

export type ListProjectOption = { id: string; name_ar: string }
export type ListDropdownOption = { value: string; label: string }

// ---------------------------------------------------------------------------
// Toolbar — search + filter dropdowns, wrapped in a native <form>.
// ---------------------------------------------------------------------------

export function ListToolbar({
  basePath,
  q,
  projectFilter,
  projects,
  searchPlaceholder,
  extraSelects,
  preservedParams,
}: {
  basePath: string
  q: string
  projectFilter: string
  projects: ListProjectOption[]
  searchPlaceholder: string
  /** Extra dropdowns beyond the project filter (e.g. sale_status). */
  extraSelects?: Array<{
    name: string
    label: string
    value: string
    options: ListDropdownOption[]
  }>
  /** URL params to preserve on submit (sort/dir). Rendered as hidden
   *  inputs so the form re-submits with them intact. */
  preservedParams?: Record<string, string>
}) {
  return (
    <ListToolbarClient
      basePath={basePath}
      initialQ={q}
      initialProjectFilter={projectFilter}
      projects={projects}
      searchPlaceholder={searchPlaceholder}
      extraSelects={extraSelects ?? []}
      preservedParams={preservedParams ?? {}}
    />
  )
}

// ---------------------------------------------------------------------------
// Sortable column header — a <th> that renders a Link. Clicking flips
// the sort direction if the column is already active; otherwise sets it
// to asc.
// ---------------------------------------------------------------------------

export function SortHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  basePath,
  otherParams,
}: {
  label: string
  sortKey: string
  currentSort: string
  currentDir: 'asc' | 'desc'
  basePath: string
  /** All other query params to preserve (q, project, filters). Values
   *  are cast to string; empty strings are dropped from the URL. */
  otherParams: Record<string, string | undefined>
}) {
  const isActive = currentSort === sortKey
  const nextDir: 'asc' | 'desc' = isActive && currentDir === 'asc' ? 'desc' : 'asc'
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(otherParams)) {
    if (v && v.length > 0) params.set(k, v)
  }
  params.set('sort', sortKey)
  params.set('dir', nextDir)
  // Reset page — a re-sort should land on page 1.
  params.delete('page')
  const href = `${basePath}?${params.toString()}`

  return (
    <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
      <Link
        href={href}
        className={`inline-flex items-center gap-1 ${isActive ? 'text-teal-700' : 'hover:text-slate-800'}`}
      >
        {label}
        {isActive ? (
          currentDir === 'asc' ? (
            <ChevronUp className="w-3 h-3" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-3 h-3" aria-hidden="true" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-40" aria-hidden="true" />
        )}
      </Link>
    </th>
  )
}

// ---------------------------------------------------------------------------
// URL builder — merges base params with overrides. Used by pagination.
// ---------------------------------------------------------------------------

export function buildSortHref(
  basePath: string,
  baseParams: URLSearchParams,
  overrides: Record<string, string>,
): string {
  const p = new URLSearchParams(baseParams)
  for (const [k, v] of Object.entries(overrides)) {
    if (v && v.length > 0) p.set(k, v)
    else p.delete(k)
  }
  return `${basePath}?${p.toString()}`
}
