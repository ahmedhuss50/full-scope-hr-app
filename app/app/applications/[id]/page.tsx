import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { StatusBadge } from '@/components/StatusBadge'
import { WillInterviewForm } from './WillInterviewForm'
import type { ApplicationStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function ApplicationDetailPage({
  params, searchParams,
}: {
  params: { id: string }
  searchParams: { app?: string }
}) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const svc = createSupabaseService()
  const { data: profile } = await svc.from('users').select('tenant_id').eq('email', user.email!).maybeSingle()
  if (!profile) return null
  const tenantId = profile.tenant_id as string

  const { data: candidate } = await svc.from('candidates').select('*').eq('tenant_id', tenantId).eq('id', params.id).maybeSingle()
  if (!candidate) notFound()

  const { data: applications } = await svc
    .from('applications')
    .select('id, status, applied_at, resume_file_ref, answers, job_requisitions(id, title, classification, pay_type, pay_rate_min, pay_rate_max, pay_currency, openings_count)')
    .eq('tenant_id', tenantId)
    .eq('candidate_id', params.id)
    .order('applied_at', { ascending: false })

  const activeAppId = searchParams.app ?? applications?.[0]?.id
  const activeApp = applications?.find(a => a.id === activeAppId)
  const activeReq = activeApp?.job_requisitions as { title: string; classification: string; pay_type: string | null; pay_rate_min: number | null; pay_rate_max: number | null; pay_currency: string | null; openings_count: number } | null | undefined

  let resumeSignedUrl: string | null = null
  if (activeApp?.resume_file_ref) {
    const { data: signed } = await svc.storage.from('resumes').createSignedUrl(activeApp.resume_file_ref, 60 * 10)
    resumeSignedUrl = signed?.signedUrl ?? null
  }

  const { data: history } = activeAppId ? await svc
    .from('application_status_history')
    .select('from_status, to_status, at, notes')
    .eq('application_id', activeAppId)
    .order('at', { ascending: false })
    : { data: [] as { from_status: ApplicationStatus | null; to_status: ApplicationStatus; at: string; notes: string | null }[] }

  const { data: interviews } = activeAppId ? await svc
    .from('interviews')
    .select('id, status, scheduled_start, scheduled_end, interviewer_user_id, interview_slots(id, slot_start, slot_end, selected)')
    .eq('application_id', activeAppId)
    .order('created_at', { ascending: false })
    : { data: [] as Array<{ id: string; status: string; scheduled_start: string | null; scheduled_end: string | null; interviewer_user_id: string | null; interview_slots: Array<{ id: string; slot_start: string; slot_end: string; selected: boolean }> | null }> }

  const { data: hiringManagers } = await svc.from('users').select('id, full_name, email').eq('tenant_id', tenantId).eq('active', true)

  const payDisplay = (req: typeof activeReq) => {
    if (!req) return null
    const cur = req.pay_currency ?? 'SAR'
    if (req.pay_rate_min && req.pay_rate_max) {
      if (req.pay_type === 'Salary') return `${req.pay_rate_min.toLocaleString()} – ${req.pay_rate_max.toLocaleString()} ${cur}/mo`
      const unit = req.pay_type === 'Hourly' ? '/hr' : ''
      return `${req.pay_rate_min}–${req.pay_rate_max} ${cur}${unit}`
    }
    return req.pay_type || 'Negotiable'
  }

  const licenses = (candidate.licenses_held ?? []) as string[]
  const jurisdictions = (candidate.jurisdictions ?? []) as string[]

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="md:col-span-2 space-y-6">
        <Link href="/app/applications" className="text-sm text-ink/60 hover:text-ink">← Back to applications</Link>

        <div className="card p-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-full bg-ink text-white flex items-center justify-center font-bold">
              {candidate.legal_first_name[0]}{candidate.legal_last_name[0]}
            </div>
            <div className="flex-1">
              <h1 className="serif font-bold text-2xl">
                {candidate.legal_first_name} {candidate.legal_last_name}
                {candidate.preferred_name && <span className="text-ink/50"> · &quot;{candidate.preferred_name}&quot;</span>}
              </h1>
              <div className="mt-1 text-sm text-ink/60 flex flex-wrap gap-3">
                <span>{candidate.mobile_phone}</span>
                {candidate.primary_email && <span>· {candidate.primary_email}</span>}
                {(candidate.home_city || candidate.home_country_code) && (
                  <span>· {[candidate.home_city, candidate.home_country_code].filter(Boolean).join(', ')}</span>
                )}
              </div>
              <div className="mt-3 flex gap-2 flex-wrap">
                <span className={`chip ${candidate.classification_preference === '1099' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                  {candidate.classification_preference}
                </span>
                <span className="chip bg-slate-100 text-slate-700">{candidate.work_auth_status}</span>
                <span className="chip bg-slate-100 text-slate-700">Language: {candidate.locale?.toUpperCase()}</span>
                <span className="chip bg-slate-100 text-slate-700">Source: {candidate.source}</span>
                {candidate.cpa_track && <span className="chip bg-accent/10 text-accent">CPA-track</span>}
                {candidate.primary_practice_area && (
                  <span className="chip bg-slate-100 text-slate-700">Practice: {candidate.primary_practice_area}</span>
                )}
                {resumeSignedUrl && (
                  <a href={resumeSignedUrl} target="_blank" rel="noopener noreferrer" className="chip bg-accent/10 text-accent font-semibold hover:bg-accent/20">View CV</a>
                )}
              </div>
              {(licenses.length > 0 || jurisdictions.length > 0) && (
                <div className="mt-4 grid md:grid-cols-2 gap-3 text-sm">
                  {licenses.length > 0 && (
                    <div>
                      <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold mb-1">Licenses</div>
                      <div className="flex flex-wrap gap-1.5">
                        {licenses.map((lic) => (
                          <span key={lic} className="chip bg-ink/5 text-ink border border-ink/10">{lic}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {jurisdictions.length > 0 && (
                    <div>
                      <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold mb-1">Jurisdictions</div>
                      <div className="flex flex-wrap gap-1.5">
                        {jurisdictions.map((jur) => (
                          <span key={jur} className="chip bg-ink/5 text-ink border border-ink/10">{jur}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {candidate.years_experience != null && (
                <div className="mt-3 text-sm text-ink/70">
                  {candidate.years_experience} years experience
                  {candidate.audit_hours ? ` · ${candidate.audit_hours} audit hours` : ''}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Role applied for */}
        {activeReq && (
          <div className="card p-6">
            <h2 className="serif font-bold text-lg mb-3">Role they applied for</h2>
            <div className="flex items-baseline justify-between mb-2">
              <span className="font-bold text-xl">{activeReq.title}</span>
              <span className={`chip ${activeReq.classification === '1099' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>{activeReq.classification}</span>
            </div>
            <div className="text-sm text-ink/70 flex flex-wrap gap-4">
              {payDisplay(activeReq) && <span><span className="font-semibold">{payDisplay(activeReq)}</span></span>}
              {activeReq.openings_count && <span className="text-ink/50">{activeReq.openings_count} opening{activeReq.openings_count !== 1 ? 's' : ''}</span>}
              {activeApp?.applied_at && <span className="text-ink/50">Applied {new Date(activeApp.applied_at).toLocaleDateString()}</span>}
            </div>
          </div>
        )}

        {activeApp && activeApp.status === 'applied' && (
          <div className="card p-6 border-s-4 border-accent">
            <h2 className="serif font-bold text-lg mb-3">Move this candidate forward</h2>
            <WillInterviewForm
              applicationId={activeApp.id}
              candidateId={candidate.id}
              hiringManagers={hiringManagers ?? []}
              candidateLocale={candidate.locale as 'en' | 'ar'}
            />
          </div>
        )}

        {(interviews ?? []).length > 0 && (
          <div className="space-y-4">
            <h2 className="serif font-bold text-lg">Interviews ({(interviews ?? []).length})</h2>
            {(interviews ?? []).map((intv) => {
              const scheduleUrl = `/schedule/${intv.id}`
              const isAwaiting = intv.status === 'slots_proposed'
              const selected = (intv.interview_slots ?? []).find(s => s.selected)
              return (
                <div key={intv.id} className={`card p-6 ${isAwaiting ? 'border-2 border-amber-300 bg-amber-50' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-semibold text-lg">
                        {isAwaiting ? '⏳ Waiting on candidate' : intv.status === 'scheduled' ? '✓ Scheduled' : intv.status}
                      </div>
                      {intv.scheduled_start && (
                        <div className="text-sm text-ink/70 mt-1">
                          {new Date(intv.scheduled_start).toLocaleString()}
                        </div>
                      )}
                      {selected && (
                        <div className="text-sm text-ink/70 mt-1">
                          Candidate picked: <strong>{new Date(selected.slot_start).toLocaleString()}</strong>
                        </div>
                      )}
                    </div>
                  </div>

                  {isAwaiting && (intv.interview_slots ?? []).length > 0 && (
                    <>
                      <div className="mt-4 rounded-md bg-white border border-amber-200 p-3 space-y-2">
                        <div className="text-xs uppercase tracking-wider font-semibold text-amber-800">Candidate slot-picker link</div>
                        <a
                          href={scheduleUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block break-all rounded bg-slate-100 px-3 py-2 font-mono text-xs text-slate-800 hover:bg-slate-200"
                        >
                          {scheduleUrl}
                        </a>
                        <p className="text-xs text-amber-800/80">Open in incognito to test as the candidate. In production, this is sent via email/WhatsApp.</p>
                      </div>
                      <div className="mt-4 p-3 rounded bg-white border border-amber-200 text-xs text-ink/60">
                        <div className="font-semibold mb-1 text-ink/80">Proposed slots:</div>
                        <ul className="space-y-0.5">
                          {(intv.interview_slots ?? []).map(s => (
                            <li key={s.id}>• {new Date(s.slot_start).toLocaleString()}</li>
                          ))}
                        </ul>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <aside className="space-y-6">
        <div className="card p-5">
          <h3 className="text-xs uppercase tracking-wider font-semibold text-ink/50 mb-3">Applications</h3>
          <div className="space-y-3">
            {applications?.map((a) => {
              const jr = Array.isArray(a.job_requisitions) ? a.job_requisitions[0] : a.job_requisitions
              return (
                <Link
                  key={a.id}
                  href={`/app/applications/${candidate.id}?app=${a.id}`}
                  className={`block p-3 rounded-lg border transition ${a.id === activeAppId ? 'border-accent bg-accent/5' : 'border-ink/10 hover:bg-ink/5'}`}
                >
                  <div className="font-semibold text-sm">{jr?.title ?? 'Unknown role'}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <StatusBadge status={a.status as ApplicationStatus} />
                    <span className="text-xs text-ink/50">{new Date(a.applied_at).toLocaleDateString()}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="text-xs uppercase tracking-wider font-semibold text-ink/50 mb-3">Status history</h3>
          {history && history.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {history.map((h, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-ink/40 font-mono text-xs mt-0.5">{new Date(h.at).toLocaleDateString()}</span>
                  <span>{h.from_status ?? 'start'} → <strong>{h.to_status}</strong></span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink/50">No transitions logged yet.</p>}
        </div>
      </aside>
    </div>
  )
}
