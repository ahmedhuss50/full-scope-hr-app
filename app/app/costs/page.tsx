import { redirect } from 'next/navigation'

/** Legacy route — moved to /app/hr/costs under the multi-module suite. */
export default function LegacyCostsRedirect() {
  redirect('/app/hr/costs')
}
