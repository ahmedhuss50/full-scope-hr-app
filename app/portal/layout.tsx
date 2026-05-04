/**
 * Root layout for /portal/*.
 *
 * Intentionally a passthrough — no auth check, no shell. The PUBLIC portal
 * routes (/portal landing, /portal/login, /portal/no-access, /portal/auth/...)
 * each render their own LocaleProvider + main shell.
 *
 * The AUTHENTICATED portal routes live under the (authed) route group at
 * /portal/(authed)/{dashboard,engagements,documents,invoices}, where a second
 * layout enforces the portal_invitations gate.
 *
 * Splitting the auth boundary by route group (Next.js convention) keeps the
 * public landing reachable for marketing links and avoids redirect loops.
 */
export default function PortalRootLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
