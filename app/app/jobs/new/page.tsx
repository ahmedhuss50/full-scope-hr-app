import { redirect } from 'next/navigation'

/** Legacy route — moved to /app/hr/jobs/new under the multi-module suite. */
export default function LegacyNewJobRedirect() {
  redirect('/app/hr/jobs/new')
}
