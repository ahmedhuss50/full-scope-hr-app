import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Project-scoped access control for Full Scope disbursements.
 *
 * Rules (August 2026):
 *   - owner         → sees every project in the tenant
 *   - supervisor    → sees only projects listed in dsb_project_employees
 *   - employee      → sees only projects listed in dsb_project_employees
 *   - deliverer     → same as employee (project assignment gates their queue)
 *   - viewer        → same as employee (read-only within their scope)
 *   - developer     → out-of-scope for this file — they view via their own portal
 *
 * When someone has zero assigned projects the caller should return an empty
 * result set (never fall through to "show everything"). That's what the
 * `IMPOSSIBLE_UUID` sentinel is for — pass it into `.in('project_id', […])`
 * to force a no-match result set without dropping the query entirely.
 */

export const IMPOSSIBLE_UUID = '00000000-0000-0000-0000-000000000000'

/** dsb roles that see every project in the tenant. */
export const UNRESTRICTED_ROLES: readonly string[] = ['owner']

/** dsb roles that must be scoped to their assigned projects. */
export const PROJECT_SCOPED_ROLES: readonly string[] = [
  'supervisor',
  'employee',
  'viewer',
  'deliverer',
]

/**
 * Return the list of project_ids this user is allowed to see.
 *
 * @returns
 *   - `null` when the user is unrestricted (owner) — caller should skip any
 *     project filter and query the whole tenant.
 *   - `string[]` when the user is scoped — caller should apply
 *     `.in('project_id', ids)` (or use `IMPOSSIBLE_UUID` when the array is
 *     empty to force a no-match result).
 */
export async function assignedProjectIds(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: SupabaseClient<any, 'public', any>
  tenantId: string
  userId: string
  dsbRole: string | null
}): Promise<string[] | null> {
  const role = args.dsbRole ?? ''
  if (UNRESTRICTED_ROLES.includes(role)) return null

  // Junction table — the source of truth once migration 113 landed. May be
  // empty for unmigrated projects; we fall back to the legacy pointer.
  const { data: junctionRows } = await args.svc
    .from('dsb_project_employees')
    .select('project_id')
    .eq('tenant_id', args.tenantId)
    .eq('user_id', args.userId)
  const fromJunction = ((junctionRows ?? []) as { project_id: string }[]).map(
    (r) => r.project_id,
  )

  // Legacy single-pointer: dsb_projects.assigned_employee_id. Still respected
  // so an owner who hasn't migrated to the junction UI doesn't accidentally
  // lock everyone out.
  const { data: legacyRows } = await args.svc
    .from('dsb_projects')
    .select('id')
    .eq('tenant_id', args.tenantId)
    .eq('assigned_employee_id', args.userId)
  const fromLegacy = ((legacyRows ?? []) as { id: string }[]).map((r) => r.id)

  // De-dupe.
  return Array.from(new Set([...fromJunction, ...fromLegacy]))
}

/**
 * Helper: given the assigned-project-ids result, return a value safe to pass
 * to a Supabase `.in('project_id', …)` filter. Handles the three cases:
 *   - null (unrestricted) → the caller should NOT apply any filter; use
 *     `applyProjectScope` instead of this helper for that flow.
 *   - []   (scoped, no access) → returns [IMPOSSIBLE_UUID] so `.in()`
 *     returns zero rows instead of everything.
 *   - [id, …] → returns the ids as-is.
 */
export function scopeInList(ids: string[] | null): string[] | null {
  if (ids === null) return null
  return ids.length > 0 ? ids : [IMPOSSIBLE_UUID]
}

/**
 * Apply the project-scope filter to a Supabase query builder in one call.
 * Owner (`ids === null`) → returns the query unchanged.
 * Scoped users → adds `.in('project_id', ids or [IMPOSSIBLE_UUID])`.
 *
 * The generic type keeps whatever specialised builder shape the caller has.
 */
export function applyProjectScope<Q extends { in: (col: string, values: string[]) => Q }>(
  query: Q,
  ids: string[] | null,
  column = 'project_id',
): Q {
  if (ids === null) return query
  return query.in(column, ids.length > 0 ? ids : [IMPOSSIBLE_UUID])
}

/**
 * True when a scoped user is allowed to view/act on a specific project.
 * Owners always return true. Scoped users must have the project in their
 * assigned list.
 */
export function canAccessProject(
  ids: string[] | null,
  projectId: string,
): boolean {
  if (ids === null) return true
  return ids.includes(projectId)
}
