'use client'
import { useLocale } from '@/lib/i18n/LocaleContext'

export function Submitted({ name }: { name: string }) {
  const { t } = useLocale()
  return (
    <div className="card p-8 text-center">
      <div className="w-14 h-14 rounded-full bg-ok/15 text-ok flex items-center justify-center text-3xl mx-auto mb-4">✓</div>
      <h1 className="serif font-bold text-2xl mb-2">{t('apply.submitted.title')}</h1>
      <p className="text-ink/70">{t('apply.submitted.body', { name })}</p>
    </div>
  )
}
