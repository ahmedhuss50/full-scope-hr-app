import Link from 'next/link'

/**
 * Persistent per-project sub-nav. Renders under the project title on every
 * subpage (overview / units / contracts / …). One chip per surface;
 * active chip is filled teal, others are subtle borders.
 *
 * Kept in the _v2 folder so the whole reorg is one directory and can be
 * removed cleanly if we roll back.
 */
type Chip = { label: string; href: string; key: string }

export function ProjectChipNav({
  projectId,
  active,
}: {
  projectId: string
  active:
    | 'overview'
    | 'setup'
    | 'units'
    | 'contracts'
    | 'payments'
    | 'vendors'
    | 'reports'
}) {
  const chips: Chip[] = [
    { key: 'overview',  label: 'نظرة عامة', href: `/app/disbursements/admin/projects/${projectId}?layout=new` },
    { key: 'setup',     label: 'التهيئة',   href: `/app/disbursements/admin/projects/${projectId}/setup` },
    { key: 'units',     label: 'الوحدات',   href: `/app/disbursements/admin/projects/${projectId}/units` },
    { key: 'contracts', label: 'العقود',    href: `/app/disbursements/admin/projects/${projectId}/buyer-contracts` },
    { key: 'payments',  label: 'الدفعات',   href: `/app/disbursements/admin/projects/${projectId}/payments` },
    { key: 'vendors',   label: 'الموردين',  href: `/app/disbursements/admin/projects/${projectId}/vendors` },
    { key: 'reports',   label: 'التقارير',  href: `/app/disbursements/admin/projects/${projectId}/reports` },
  ]

  return (
    <nav className="flex gap-1 border-b border-slate-200 overflow-x-auto -mx-1 px-1" dir="rtl">
      {chips.map((c) => {
        const isActive = c.key === active
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
