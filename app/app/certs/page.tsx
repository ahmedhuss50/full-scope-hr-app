import { redirect } from 'next/navigation'

/** Legacy route — moved to /app/hr/certs under the multi-module suite. */
export default function LegacyCertsRedirect() {
  redirect('/app/hr/certs')
}
