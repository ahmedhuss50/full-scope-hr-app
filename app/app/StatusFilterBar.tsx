'use client'
import Link from 'next/link'
import { useLocale } from '@/lib/i18n/LocaleContext'

const FILTERS = [
  { value: 'all', labelKey: 'dashboard.filter_all' as const },
  { value: 'applied', labelKey: 'dashboard.filter_new' as const },
  { value: 'in_review', labelKey: 'dashboard.filter_review' as const },
  { value: 'interview_scheduled', labelKey: 'dashboard.filter_interview' as const },
  { value: 'hired', labelKey: 'dashboard.filter_hired' as const },
]

export function StatusFilterBar({ active }: { active: string }) {
  const { t } = useLocale()
  return (
    <div className="flex gap-2 mb-4 flex-wrap">
      {FILTERS.map(f => (
        <Link
          key={f.value}
          href={f.value === 'all' ? '/app/applications' : `/app/applications?status=${f.value}`}
          className={`px-4 py-2 rounded-full text-sm font-semibold transition ${active === f.value ? 'bg-ink text-white' : 'bg-white border border-ink/10 text-ink/70 hover:bg-ink/5'}`}
        >{t(f.labelKey)}</Link>
      ))}
    </div>
  )
}
