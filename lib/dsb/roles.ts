/**
 * Central role-permission groups for the disbursement module.
 *
 * The previous convention scattered `['employee', 'supervisor', 'owner']`
 * literals across many files. Adding `viewer` (read-only) and `deliverer`
 * (delivery-only) made this brittle, so we centralise the canonical buckets
 * here. Use the smallest group that captures the intent at each call site —
 * narrowing later is much easier with named constants than with inline lists.
 *
 * Conventions:
 *   - WRITE_ROLES  : full read + write (uploads, approvals, signing, edits)
 *   - DELIVER_ROLES: who can mark a signed case as delivered
 *   - READ_ROLES   : everyone who's allowed to see the module at all
 */

export type DsbRole =
  | 'developer'
  | 'employee'
  | 'supervisor'
  | 'owner'
  | 'viewer'
  | 'deliverer'

/** Roles that can mutate cases (approve, reject, sign, edit, attach, comment).
 *  These are the original three "staff" roles before viewer/deliverer existed. */
export const WRITE_ROLES: DsbRole[] = ['employee', 'supervisor', 'owner']

/** Roles allowed to mark a signed case as delivered.
 *  All WRITE_ROLES can deliver; deliverer can do nothing but deliver. */
export const DELIVER_ROLES: DsbRole[] = [...WRITE_ROLES, 'deliverer']

/** Roles that may navigate the disbursement module at all.
 *  Developers are excluded — they have their own developer-portal surface. */
export const READ_ROLES: DsbRole[] = [...DELIVER_ROLES, 'viewer']

export function isWriteRole(r: string | null | undefined): boolean {
  return !!r && (WRITE_ROLES as string[]).includes(r)
}
export function isDeliverRole(r: string | null | undefined): boolean {
  return !!r && (DELIVER_ROLES as string[]).includes(r)
}
export function isReadRole(r: string | null | undefined): boolean {
  return !!r && (READ_ROLES as string[]).includes(r)
}
