import Link from 'next/link'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { StatusBadge } from '@/components/StatusBadge'
import { CopyLinkButton } from '../../CopyLinkButton'
import { StatusFilterBar } from '../../StatusFilterBar'
import type { ApplicationStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Row = {
  id: string
  status: ApplicationStatus
  applied_at: string
  candidates: {
    id: string
    legal_first_name: string
    legal_last_name: string
    mobile_phone: string | null
    primary_email: string | null
    classification_preference: 'W-2' | '1099' | null
    primary_practice_area: string | null
    cpa_track: boolean | null
    licenses_held: string[] | null
    locale: string
  } | null
  job_requisitions: { title: string } | null
}

export default async function ApplicationsPage({ searchParams }: { searchParams: { status?: string } }) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const svc = createSupabaseService()
  const { data: profile } = await svc.from('users').select('tenant_id, tenants(name, slug)').eq('email', user.email!).maybeSingle()
  if (!profile) return null

  const tenantId = profile.tenant_id as string
  const tenant = Array.isArray(profile.tenants) ? profile.tenants[0] : profile.tenants
  const tenantSlug = tenant?.slug as string

  let query = svc
    .from('applications')
    .select('id, status, applied_at, candidates(id, legal_first_name, legal_last_name, mobile_phone, primary_email, classification_preference, primary_practice_area, cpa_track, licenses_held, locale), job_requisitions(title)')
    .eq('tenant_id', tenantId)
    .order('applied_at', { ascending: false })
    .limit(100)

  if (searchParams.status && searchParams.status !== 'all') {
    query = query.eq('status', searchParams.status)
  }

  const { data, error } = await query
  if (error) console.error('[applications] query', error)
  const rows = (data ?? []) as unknown as Row[]

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const newToday = rows.filter(r => new Date(r.applied_at) >= today).length
  const publicApplyUrl = `/apply/${tenantSlug}`

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="serif font-black text-3xl tracking-tight">Applications</h1>
          <p className="text-ink/60 text-sm mt-1">{newToday} new today · {rows.length} shown</p>
        </div>
        <CopyLinkButton href={publicApplyUrl} />
      </div>

      <StatusFilterBar active={searchParams.status ?? 'all'} />

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-10 text-center text-ink/60">
            <p className="font-semibold">No candidates match this filter.</p>
            <p className="text-sm mt-1">Share your public application link or adjust the filter above.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink/5 text-start text-xs uppercase tracking-wider">
              <tr>
                <th className="p-3 font-semibold text-start">Candidate</th>
                <th className="p-3 font-semibold text-start">Role</th>
                <th className="p-3 font-semibold text-start">Practice</th>
                <th className="p-3 font-semibold text-start">Licenses</th>
                <th className="p-3 font-semibold text-start">Applied</th>
                <th className="p-3 font-semibold text-start">Status</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-ink/5 hover:bg-slate-50">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-ink text-white flex items-center justify-center font-bold text-xs">
                        {r.candidates?.legal_first_name[0]}{r.candidates?.legal_last_name[0]}
                      </div>
                      <div>
                        <div className="font-semibold">{r.candidates?.legal_first_name} {r.candidates?.legal_last_name}</div>
                        <div className="text-xs text-ink/50">{r.candidates?.mobile_phone} · {r.candidates?.locale?.toUpperCase()}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-ink/70">{r.job_requisitions?.title ?? '—'}</td>
                  <td className="p-3">
                    <span className="chip bg-slate-100 text-slate-700">{r.candidates?.primary_practice_area ?? '—'}</span>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {r.candidates?.cpa_track && <span className="chip bg-accent/10 text-accent">CPA-track</span>}
                      {(r.candidates?.licenses_held ?? []).slice(0, 3).map(lic => (
                        <span key={lic} className="chip bg-slate-100 text-slate-700">{lic}</span>
                      ))}
                    </div>
                  </td>
                  <td className="p-3 text-ink/70 whitespace-nowrap">{formatRelative(r.applied_at)}</td>
                  <td className="p-3"><StatusBadge status={r.status} /></td>
                  <td className="p-3 text-end">
                    <Link href={`/app/hr/applications/${r.candidates?.id}?app=${r.id}`} className="btn-ghost text-xs">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function formatRelative(iso: string) {
  const d = new Date(iso); const now = Date.now()
  const diffMs = now - d.getTime(); const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'; if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60); if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24); if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}
