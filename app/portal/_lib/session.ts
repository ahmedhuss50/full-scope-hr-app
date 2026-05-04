/**
 * Server-side helper used by every authenticated /portal/(authed)/* page to
 * resolve the signed-in client contact + invitation.
 *
 * Always uses the service-role client because portal contacts are NOT in the
 * `users` table and so RLS based on auth.uid() doesn't grant them anything.
 * The CALLER is responsible for scoping every subsequent query to the
 * returned client_id and tenant_id (read-only is enforced by us never
 * exposing mutating operations from the portal).
 */
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export type PortalSession = {
  userEmail: string
  invitationId: string
  tenantId: string
  clientId: string
  contactId: string
  contactName: string
  contactFirstName: string
  contactJobTitle: string | null
  clientName: string
  clientLegalName: string | null
  clientIndustry: string | null
  firmName: string
}

type Named = {
  full_name?: string | null
  name?: string | null
  legal_name?: string | null
  industry?: string | null
  job_title?: string | null
  email?: string | null
}

function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

export async function requirePortalSession(): Promise<PortalSession> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect('/portal/login')

  const svc = createSupabaseService()
  const { data: invitation } = await svc
    .from('portal_invitations')
    .select(`
      id, tenant_id, client_id, contact_id, email, active,
      contact:crm_contacts(full_name, job_title, email),
      client:clients(name, legal_name, industry),
      tenant:tenants(name)
    `)
    .eq('email', user.email)
    .eq('active', true)
    .maybeSingle()

  if (!invitation) redirect('/portal/no-access')

  const contact = pickOne<Named>(invitation.contact as Named | Named[] | null)
  const client  = pickOne<Named>(invitation.client  as Named | Named[] | null)
  const tenant  = pickOne<Named>(invitation.tenant  as Named | Named[] | null)

  const contactName = contact?.full_name ?? user.email
  const contactFirstName = contactName.split(' ')[0] ?? contactName

  return {
    userEmail: user.email,
    invitationId: invitation.id as string,
    tenantId: invitation.tenant_id as string,
    clientId: invitation.client_id as string,
    contactId: invitation.contact_id as string,
    contactName,
    contactFirstName,
    contactJobTitle: contact?.job_title ?? null,
    clientName: client?.name ?? client?.legal_name ?? '',
    clientLegalName: client?.legal_name ?? null,
    clientIndustry: client?.industry ?? null,
    firmName: tenant?.name ?? 'Full Scope',
  }
}
