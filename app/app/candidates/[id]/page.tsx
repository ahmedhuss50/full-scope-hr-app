import { redirect } from 'next/navigation'

/**
 * Legacy route — the candidate detail view moved to /app/applications/[id].
 * Preserve any `?app=...` query so deep links from older emails still work.
 */
export default function LegacyCandidateRedirect({
  params, searchParams,
}: {
  params: { id: string }
  searchParams: { app?: string }
}) {
  const qs = searchParams.app ? `?app=${searchParams.app}` : ''
  redirect(`/app/applications/${params.id}${qs}`)
}
