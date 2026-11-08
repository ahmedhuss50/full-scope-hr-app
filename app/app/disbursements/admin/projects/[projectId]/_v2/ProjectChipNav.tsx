'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Persistent per-project sub-nav. Rendered by the project layout so it
 * stays mounted while `{children}` swap between overview / setup / units /
 * … — clicking a chip does not re-render the nav.
 *
 * Active chip is auto-detected from `usePathname()` against each chip's
 * href prefix (longest match wins so `/reports/cpa` selects the reports
 * chip, not overview). The optional `active` prop overrides detection.
 *
 * Kept in the _v2 folder so the whole reorg is one directory and can be
 * removed cleanly if we roll back.
 */
type ChipKey =
  | 'overview'
  | 'units'
  | 'contracts'
  | 'vendors'
  | 'accounts'
  | 'payments'
  | 'documents'
  | 'reports'
  | 'setup'

type Chip = { key: ChipKey; label: string; href: string; match: string }

export function ProjectChipNav({
  projectId,
  active,
}: {
  projectId: string
  /** Force a specific chip active — otherwise the pathname decides. */
  active?: ChipKey
}) {
  const base = `/app/disbursements/admin/projects/${projectId}`
  // Order reflects frequency-of-use for owners: overview → data entities
  // → money → derived outputs → one-time config.
  const chips: Chip[] = [
    { key: 'overview',  label: 'نظرة عامة',    href: base,                             match: base },
    { key: 'units',     label: 'الوحدات',       href: `${base}/units`,                  match: `${base}/units` },
    { key: 'contracts', label: 'العقود',        href: `${base}/buyer-contracts`,        match: `${base}/buyer-contracts` },
    { key: 'vendors',   label: 'الموردون',      href: `${base}/vendors`,                match: `${base}/vendors` },
    { key: 'accounts',  label: 'الحسابات',      href: `${base}/accounts`,               match: `${base}/accounts` },
    { key: 'payments',  label: 'الدفعات',       href: `${base}/payments`,               match: `${base}/payments` },
    { key: 'documents', label: 'الوثائق',       href: `${base}/documents`,              match: `${base}/documents` },
    { key: 'reports',   label: 'التقارير',      href: `${base}/reports/cpa`,            match: `${base}/reports` },
    { key: 'setup',     label: 'التهيئة',       href: `${base}/setup`,                  match: `${base}/setup` },
  ]

  const pathname = usePathname() ?? base
  // Longest match wins so `/reports/cpa` picks reports, not overview
  // (which would match any path starting with the base).
  const detected: ChipKey =
    active ??
    (chips
      .filter((c) => pathname === c.match || pathname.startsWith(`${c.match}/`))
      .sort((a, b) => b.match.length - a.match.length)[0]?.key ?? 'overview')

  return (
    <nav className="flex gap-1 border-b border-slate-200 overflow-x-auto -mx-1 px-1" dir="rtl">
      {chips.map((c) => {
        const isActive = c.key === detected
        return (
          <Link
            key={c.key}
            href={c.href}
            className={
              'px-3 py-2 text-xs font-semibold whitespace-nowrap transition ' +
              (isActive
                ? 'text-teal-700 border-b-2 border-teal-600 -mb-px'
                : 'text-slate-500 hover:text-slate-900 border-b-2 border-transparent -mb-px')
            }
          >
            {c.label}
          </Link>
        )
      })}
    </nav>
  )
}
