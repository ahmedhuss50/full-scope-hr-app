/**
 * Project segment layout — wraps every route under
 * /app/disbursements/admin/projects/[projectId]/**.
 *
 * The only thing this layout owns is the persistent chip nav. Because
 * Next.js App Router keeps layouts mounted while `{children}` swap on
 * navigation, the nav stays put (no reload, no flicker) as the user
 * moves between overview / setup / units / buyer-contracts / vendors /
 * reports.
 *
 * Auth and project-scoped access checks are intentionally left inside
 * each page.tsx — every subpage already gates on its own role (owner-only
 * setup, etc.) and re-doing them here would be redundant. If we later
 * consolidate the breadcrumb + h1 into this layout, this is the spot.
 */
import { ProjectChipNav } from './_v2/ProjectChipNav'

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { projectId: string }
}) {
  return (
    <div className="space-y-4">
      <div className="max-w-6xl mx-auto px-4 pt-2" dir="rtl">
        <ProjectChipNav projectId={params.projectId} />
      </div>
      {children}
    </div>
  )
}
