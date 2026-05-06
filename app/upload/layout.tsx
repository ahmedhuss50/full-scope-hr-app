/**
 * Public layout for /upload/[token] tokenized developer-upload pages.
 * NO AUTH. Mirrors the /sign/[token] visual identity:
 * single centered card on a soft slate canvas, full-width header
 * with brand + locale toggle.
 */
import { LocaleProvider } from '@/lib/i18n/LocaleContext'

export const dynamic = 'force-dynamic'

export default function UploadRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider initial="en">
      <div className="min-h-screen bg-slate-50">{children}</div>
    </LocaleProvider>
  )
}
