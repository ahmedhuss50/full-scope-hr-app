'use client'
import { useLocale } from '@/lib/i18n/LocaleContext'

export function Confirmed({ when }: { when: string }) {
  const { t } = useLocale()
  return (
    <div className="card p-8 text-center">
      <div className="w-14 h-14 rounded-full bg-ok/15 text-ok flex items-center justify-center text-3xl mx-auto mb-4">✓</div>
      <h1 className="serif font-bold text-2xl mb-2">{t('schedule.confirmed.title')}</h1>
      <p className="text-ink/70">{t('schedule.confirmed.body', { when })}</p>
    </div>
  )
}
