/**
 * Public layout for /upload-voucher/[token] tokenized developer-upload pages.
 * NO AUTH. KSA-primary tenant, so default locale = 'ar'.
 */
import { LocaleProvider } from '@/lib/i18n/LocaleContext'

export const dynamic = 'force-dynamic'

export default function UploadVoucherRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider initial="ar">
      <div className="min-h-screen bg-slate-50">{children}</div>
    </LocaleProvider>
  )
}
