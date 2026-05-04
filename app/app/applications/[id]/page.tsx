import { redirect } from 'next/navigation'

/**
 * Legacy route — Application detail moved to /app/hr/applications/[id] under
 * the new suite shell (HR is one of three modules). Preserve `?app=...`.
 */
export default function LegacyApplicationDetailRedirect({
  params, searchParams,
}: {
  params: { id: string }
  searchParams: { app?: string }
}) {
  const qs = searchParams.app ? `?app=${searchParams.app}` : ''
  redirect(`/app/hr/applications/${params.id}${qs}`)
}
