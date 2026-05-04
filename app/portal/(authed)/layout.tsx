import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { LocaleProvider } from '@/lib/i18n/LocaleContext'
import { LanguageToggle } from '@/components/LanguageToggle'
import { PortalNav } from '../_components/PortalNav'
import { PortalSignOutButton } from '../_components/PortalSignOutButton'

export const dynamic = 'force-dynamic'

/**
 * Authenticated Client Portal layout.
 *
 * Wraps every /portal/dashboard, /portal/engagements, /portal/documents,
 * /portal/invoices route. Performs the auth + invitation check ONCE and
 * redirects unauthorized users out before any nested page renders.
 *
 * Visual identity (intentionally different from /app):
 *   - Centered max-w-5xl container (firm app is full-width sidebar).
 *   - Top horizontal nav (firm app uses left sidebar).
 *   - Lighter background, more whitespace.
 */
export default async function PortalAuthedLayout({ children }: { children: React.ReactNode }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/portal/login')

  const svc = createSupabaseService()

  // Look up the invitation row for this email. Service-role bypasses RLS,
  // which is important because portal contacts are NOT in the `users` table
  // and so don't carry a tenant binding via auth.uid().
  const { data: invitation } = await svc
    .from('portal_invitations')
    .select(`
      id, tenant_id, client_id, contact_id, email, active,
      contact:crm_contacts(full_name, job_title, email),
      client:clients(name, legal_name, industry),
      tenant:tenants(name)
    `)
    .eq('email', user.email!)
    .eq('active', true)
    .maybeSingle()

  if (!invitation) redirect('/portal/no-access')

  // Supabase joined relations are typed as T | T[] | null when the join is
  // ambiguous. Normalize defensively.
  type Named = { full_name?: string | null; name?: string | null; legal_name?: string | null; industry?: string | null; job_title?: string | null; email?: string | null }
  function pickOne<T>(rel: T | T[] | null | undefined): T | null {
    if (!rel) return null
    return Array.isArray(rel) ? (rel[0] ?? null) : rel
  }

  const contact = pickOne<Named>(invitation.contact as Named | Named[] | null)
  const client = pickOne<Named>(invitation.client as Named | Named[] | null)
  const tenant = pickOne<Named>(invitation.tenant as Named | Named[] | null)

  const contactName = contact?.full_name ?? user.email ?? ''
  const clientName = client?.name ?? client?.legal_name ?? ''
  const firmName = tenant?.name ?? 'Full Scope'

  return (
    <LocaleProvider initial="en">
      <div className="min-h-screen bg-slate-50">
        {/* Top header — firm brand on the left, client identity on the right. */}
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <Link href="/portal/dashboard" className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-ink text-white font-black text-sm">F</span>
              <span className="serif text-base font-bold text-slate-900 truncate">{firmName}</span>
              <span className="text-slate-300 mx-2">/</span>
              <span className="text-sm font-semibold text-slate-700 truncate">{clientName}</span>
            </Link>
            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:inline text-xs text-slate-500 truncate max-w-[160px]">
                {contactName}
              </span>
              <LanguageToggle />
              <PortalSignOutButton />
            </div>
          </div>
        </header>

        <PortalNav />

        <main className="max-w-5xl mx-auto px-6 py-10 min-w-0">
          {children}
        </main>
      </div>
    </LocaleProvider>
  )
}
