import { LocaleProvider } from '@/lib/i18n/LocaleContext'
import { LanguageToggle } from '@/components/LanguageToggle'
import { Submitted } from './Submitted'

export default function Page({ searchParams }: { searchParams: { name?: string } }) {
  const name = searchParams.name ?? ''
  return (
    <LocaleProvider>
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          <div className="flex justify-end mb-6"><LanguageToggle /></div>
          <Submitted name={name} />
        </div>
      </main>
    </LocaleProvider>
  )
}
