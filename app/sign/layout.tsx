/**
 * Public layout for /sign/[token] tokenized signer pages. NO AUTH.
 *
 * Visual identity is intentionally distinct from /app and /portal:
 * a single centered card on a soft slate canvas, full-width header
 * with brand + locale toggle. The signer never logs in — they came
 * from an email link and only need to approve/reject.
 */
import { LocaleProvider } from '@/lib/i18n/LocaleContext'

export const dynamic = 'force-dynamic'

export default function SignRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider initial="en">
      <div className="min-h-screen bg-slate-50">{children}</div>
    </LocaleProvider>
  )
}
