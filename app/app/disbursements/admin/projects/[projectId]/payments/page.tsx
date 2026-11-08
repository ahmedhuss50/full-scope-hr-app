/**
 * Project · الدفعات — redirects to the tenant-wide payments list pre-filtered
 * to this project. Lets the chip-nav drop the user straight into the big
 * payments table with everything else they expect (bulk delete, auto-link,
 * category tabs) instead of forking a project-scoped variant we'd have to
 * maintain separately.
 */
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function ProjectPaymentsPage({
  params,
}: {
  params: { projectId: string }
}) {
  redirect(`/app/disbursements/admin/lists/payments?project=${encodeURIComponent(params.projectId)}`)
}
