'use client'
import { useLocale } from '@/lib/i18n/LocaleContext'

export function LanguageToggle({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useLocale()
  return (
    <div className={`inline-flex rounded-full border border-ink/10 bg-white p-0.5 text-xs font-semibold ${className}`}>
      <button
        onClick={() => setLocale('en')}
        className={`px-3 py-1 rounded-full transition ${locale === 'en' ? 'bg-ink text-white' : 'text-ink/70'}`}
      >EN</button>
      <button
        onClick={() => setLocale('ar')}
        className={`px-3 py-1 rounded-full transition ${locale === 'ar' ? 'bg-ink text-white' : 'text-ink/70'}`}
      >AR</button>
    </div>
  )
}
