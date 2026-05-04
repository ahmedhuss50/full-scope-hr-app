import { redirect } from 'next/navigation'

/**
 * Legacy route — the candidate detail view first moved to /app/applications/[id]
 * (consolidating with applications) and now lives at /app/hr/applications/[id]
 * under the multi-module suite. Preserve `?app=...` for older email deep links.
 */
export default function LegacyCandidateRedirect({
  params, searchParams,
}: {
  params: { id: string }
  searchParams: { app?: string }
}) {
  const qs = searchParams.app ? `?app=${searchParams.app}` : ''
  redirect(`/app/hr/applications/${params.id}${qs}`)
}
