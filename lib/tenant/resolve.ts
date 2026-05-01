import { unstable_noStore as noStore } from 'next/cache'
import { createSupabaseService } from '@/lib/supabase/server'

/**
 * Resolve a tenant by its URL slug. Uses the service role because tenant
 * lookup happens on public routes (candidate application) before any user
 * is signed in.
 *
 * Calls noStore() to opt out of Next.js's fetch data cache — without this,
 * Supabase queries (which use fetch internally) can be cached indefinitely
 * even on force-dynamic pages.
 */
export async function getTenantBySlug(slug: string) {
  noStore()
  const svc = createSupabaseService()
  const { data, error } = await svc
    .from('tenants')
    .select('id, name, slug, subdomain, locale_default, active')
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle()
  if (error) {
    console.error('[tenant] lookup failed', error)
    return null
  }
  return data
}

export async function getOpenRequisitions(tenantId: string) {
  noStore()
  const svc = createSupabaseService()
  const { data, error } = await svc
    .from('job_requisitions')
    .select('id, title, classification, pay_type, pay_rate_min, pay_rate_max, pay_currency, openings_count, description')
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
  if (error) { console.error('[tenant] reqs', error); return [] }
  return data ?? []
}
