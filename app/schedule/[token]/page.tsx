import { notFound } from 'next/navigation'
import { createSupabaseService } from '@/lib/supabase/server'
import { LocaleProvider } from '@/lib/i18n/LocaleContext'
import { LanguageToggle } from '@/components/LanguageToggle'
import { SlotPicker } from './SlotPicker'
import type { Locale } from '@/lib/i18n/translations'

export const dynamic = 'force-dynamic'

export default async function SchedulePage({ params }: { params: { token: string } }) {
  // For the scaffold the token is the interview UUID. Future: signed JWT
  // with expiration, stored/verified via a dedicated schedule_tokens table.
  const svc = createSupabaseService()
  const { data: interview } = await svc
    .from('interviews')
    .select('id, status, tenant_id, application_id, interview_slots(id, slot_start, slot_end, selected)')
    .eq('id', params.token)
    .maybeSingle()

  if (!interview || interview.status !== 'slots_proposed') notFound()

  const { data: app } = await svc
    .from('applications')
    .select('id, candidates(legal_first_name, locale), job_requisitions(title), tenants:tenant_id(name, locale_default)')
    .eq('id', interview.application_id)
    .maybeSingle()

  if (!app) notFound()

  const candidate = Array.isArray(app.candidates) ? app.candidates[0] : app.candidates
  const job = Array.isArray(app.job_requisitions) ? app.job_requisitions[0] : app.job_requisitions
  const tenant = Array.isArray(app.tenants) ? app.tenants[0] : app.tenants

  const initialLocale = (candidate?.locale as Locale) ?? (tenant?.locale_default as Locale) ?? 'ar'

  return (
    <LocaleProvider initial={initialLocale}>
      <main className="min-h-screen py-10 px-4 md:px-6">
        <div className="max-w-xl mx-auto">
          <header className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-ink text-white font-black text-sm">
                {tenant?.name?.charAt(0) ?? '?'}
              </span>
              <span className="serif text-lg font-bold">{tenant?.name}</span>
            </div>
            <LanguageToggle />
          </header>

          <SlotPicker
            interviewId={interview.id}
            candidateName={candidate?.legal_first_name ?? ''}
            roleTitle={job?.title ?? ''}
            slots={(interview.interview_slots ?? []).map((s) => ({
              id: s.id,
              slot_start: s.slot_start,
              slot_end: s.slot_end,
            }))}
          />
        </div>
      </main>
    </LocaleProvider>
  )
}
