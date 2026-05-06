import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { t as tFn, type Locale } from '@/lib/i18n/translations'
import { LanguageToggle } from '@/components/LanguageToggle'

export const dynamic = 'force-dynamic'

const SERVER_LOCALE: Locale = 'en'

export default function UploadDonePage() {
  return (
    <>
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <Link href="#" className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-slate-900 text-white font-black text-sm">
              F
            </span>
            <span className="serif text-base font-bold text-slate-900">
              {tFn('sign.brand_label', SERVER_LOCALE)}
            </span>
          </Link>
          <LanguageToggle />
        </div>
      </header>

      <main className="max-w-md mx-auto px-6 py-20 text-center">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-green-100 text-green-700 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8" />
            </div>
          </div>
          <h1 className="serif font-black text-2xl text-slate-900 mb-2">
            {tFn('sign.done.title', SERVER_LOCALE)}
          </h1>
          <p className="text-sm text-slate-600">
            {tFn('disbursement.upload.success', SERVER_LOCALE)}
          </p>
          <div className="mt-6 text-xs text-slate-400">
            {tFn('sign.done.return_home', SERVER_LOCALE)}
          </div>
        </div>
      </main>
    </>
  )
}
