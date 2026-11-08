/**
 * Project · الوثائق — redirects to the tenant-wide documents register
 * pre-filtered to this project. See the sibling payments route for rationale.
 */
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function ProjectDocumentsPage({
  params,
}: {
  params: { projectId: string }
}) {
  redirect(`/app/disbursements/documents?project=${encodeURIComponent(params.projectId)}`)
}
