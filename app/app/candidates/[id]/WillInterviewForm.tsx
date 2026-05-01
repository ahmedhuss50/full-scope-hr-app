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
      router.refresh()
    })
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
