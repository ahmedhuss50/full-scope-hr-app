import { redirect } from 'next/navigation'

/** Legacy route — moved to /app/hr/employees under the multi-module suite. */
export default function LegacyEmployeesRedirect() {
  redirect('/app/hr/employees')
}
