'use client'
import type { ApplicationStatus } from '@/lib/types'
import { useLocale } from '@/lib/i18n/LocaleContext'

const COLORS: Record<ApplicationStatus, string> = {
  applied: 'bg-blue-100 text-blue-800',
  in_review: 'bg-amber-100 text-amber-800',
  interview_pending: 'bg-violet-100 text-violet-800',
  interview_scheduled: 'bg-indigo-100 text-indigo-800',
  interview_completed: 'bg-sky-100 text-sky-800',
  decision_pending: 'bg-yellow-100 text-yellow-800',
  offer_extended: 'bg-emerald-100 text-emerald-800',
  offer_accepted: 'bg-emerald-200 text-emerald-900',
  hired: 'bg-green-600 text-white',
  rejected: 'bg-gray-200 text-gray-700',
  withdrawn: 'bg-gray-200 text-gray-700',
}

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  const { t } = useLocale()
  return <span className={`chip ${COLORS[status] ?? 'bg-gray-100'}`}>{t(`status.${status}`)}</span>
}
