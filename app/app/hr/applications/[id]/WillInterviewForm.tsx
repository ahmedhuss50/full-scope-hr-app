'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { proposeInterview } from './actions'

type HM = { id: string; full_name: string; email: string }

function defaultSlot(daysAhead: number, hour: number) {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString().slice(0, 16) // YYYY-MM-DDTHH:MM for <input type="datetime-local">
}

export function WillInterviewForm({
  applicationId,
  candidateId,
  hiringManagers,
  candidateLocale,
}: {
  applicationId: string
  candidateId: string
  hiringManagers: HM[]
  candidateLocale: 'en' | 'ar'
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [interviewer, setInterviewer] = useState(hiringManagers[0]?.id ?? '')
  const [slots, setSlots] = useState<string[]>([
    defaultSlot(1, 9),
    defaultSlot(1, 14),
    defaultSlot(2, 10),
  ])
  const [success, setSuccess] = useState<{ interviewId: string; emailSent: boolean; emailReason?: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const updateSlot = (i: number, v: string) => {
    const next = [...slots]; next[i] = v; setSlots(next)
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await proposeInterview({
        application_id: applicationId,
        candidate_id: candidateId,
        interviewer_user_id: interviewer,
        slots: slots.filter(Boolean).map(s => new Date(s).toISOString()),
      })
      if (!res.ok) { setError(res.error); return }
      setSuccess({
        interviewId: res.interview_id,
        emailSent: res.email?.sent ?? false,
        emailReason: res.email?.reason,
      })
      router.refresh()
    })
  }

  // Show the success card with prominent schedule link instead of the form.
  if (success) {
    const scheduleUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/schedule/${success.interviewId}`
    const onCopy = async () => {
      try {
        await navigator.clipboard.writeText(scheduleUrl)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        setCopied(false)
      }
    }
    return (
      <div className="space-y-4">
        <div className="rounded-lg border-2 border-green-200 bg-green-50 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 h-6 w-6 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-bold">✓</div>
            <div className="flex-1">
              <h3 className="font-bold text-green-900">Interview proposed</h3>
              <p className="text-sm text-green-800 mt-1">
                {success.emailSent
                  ? `Email sent to the candidate (in ${candidateLocale === 'ar' ? 'Arabic' : 'English'}). They'll pick a slot.`
                  : `Email NOT sent (${success.emailReason ?? 'unknown'}). Send the link below to the candidate manually.`}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <div className="text-xs uppercase tracking-wider font-semibold text-slate-500">Candidate slot-picker link</div>
          <div className="flex items-center gap-2">
            <a
              href={scheduleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 break-all rounded-md bg-slate-100 px-3 py-2 font-mono text-sm text-slate-800 hover:bg-slate-200"
            >
              {scheduleUrl}
            </a>
            <button
              type="button"
              onClick={onCopy}
              className="rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 whitespace-nowrap"
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Share this link with the candidate via email, WhatsApp, or SMS. They&rsquo;ll pick one of the 3 slots you proposed.
          </p>
        </div>

        <button
          type="button"
          onClick={() => router.refresh()}
          className="text-sm text-teal-600 hover:underline"
        >
          ← Refresh candidate page
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-ink/70">
        Propose 3 interview slots. The candidate will get an email in {candidateLocale === 'ar' ? 'Arabic' : 'English'} to pick one.
      </p>

      <div>
        <label className="label">Interviewer</label>
        <select className="input" value={interviewer} onChange={(e) => setInterviewer(e.target.value)}>
          {hiringManagers.map(hm => <option key={hm.id} value={hm.id}>{hm.full_name} ({hm.email})</option>)}
        </select>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {slots.map((s, i) => (
          <div key={i}>
            <label className="label">Slot {i + 1}</label>
            <input type="datetime-local" className="input" value={s} onChange={(e) => updateSlot(i, e.target.value)} />
          </div>
        ))}
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

      <div className="flex gap-2">
        <button type="submit" disabled={isPending} className="btn-primary">
          {isPending ? 'Proposing…' : 'Propose interview'}
        </button>
      </div>
    </form>
  )
}
