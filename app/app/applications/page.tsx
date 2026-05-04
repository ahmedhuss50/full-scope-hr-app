import { redirect } from 'next/navigation'

/**
 * Legacy route — Applications moved to /app/hr/applications when the app
 * pivoted from "Full Scope HR" (single product) to "Full Scope" (suite of
 * HR + CRM + Accounting). Preserve any `?status=...` query.
 */
export default function LegacyApplicationsRedirect({ searchParams }: { searchParams: { status?: string } }) {
  const qs = searchParams.status ? `?status=${searchParams.status}` : ''
  redirect(`/app/hr/applications${qs}`)
}
