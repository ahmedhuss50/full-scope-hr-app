import { redirect } from 'next/navigation'

/** Legacy route — moved to /app/hr/jobs under the multi-module suite. */
export default function LegacyJobsRedirect() {
  redirect('/app/hr/jobs')
}
