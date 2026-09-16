import Link from 'next/link'

/**
 * Simple breadcrumb bar. Every segment except the last is clickable.
 * Rendered at the very top of any subpage below the sidebar.
 */
export function Breadcrumb({
  items,
}: {
  items: Array<{ label: string; href?: string }>
}) {
  return (
    <nav
      className="text-xs text-slate-500 flex items-center flex-wrap gap-1 mb-3"
      aria-label="مسار التنقل"
      dir="rtl"
    >
      {items.map((it, i) => {
        const isLast = i === items.length - 1
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-slate-300">›</span>}
            {isLast || !it.href ? (
              <span className="text-slate-900 font-semibold">{it.label}</span>
            ) : (
              <Link href={it.href} className="hover:text-slate-800 hover:underline decoration-dotted underline-offset-2">
                {it.label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
