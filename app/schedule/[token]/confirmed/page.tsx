import { LocaleProvider } from '@/lib/i18n/LocaleContext'
import { LanguageToggle } from '@/components/LanguageToggle'
import { Confirmed } from './Confirmed'

export default function ConfirmedPage({ searchParams }: { searchParams: { when?: string } }) {
  return (
    <LocaleProvider>
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          <div className="flex justify-end mb-6"><LanguageToggle /></div>
          <Confirmed when={searchParams.when ?? ''} />
        </div>
      </main>
    </LocaleProvider>
  )
}
