'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/LocaleContext'
import { confirmSlot } from './actions'

type Slot = { id: string; slot_start: string; slot_end: string }

export function SlotPicker({
  interviewId, candidateName, roleTitle, slots,
}: {
  interviewId: string
  candidateName: string
  roleTitle: string
  slots: Slot[]
}) {
  const { t, locale } = useLocale()
  const router = useRouter()
  const [selected, setSelected] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const localeTag = locale === 'ar' ? 'ar-SA' : 'en-US'

  const onConfirm = () => {
    if (!selected) return
    setError(null)
    startTransition(async () => {
      const res = await confirmSlot({ interview_id: interviewId, slot_id: selected })
      if (!res.ok) { setError(res.error); return }
      const chosen = slots.find(s => s.id === selected)
      const when = chosen ? new Date(chosen.slot_start).toLocaleString(localeTag, {
        weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      }) : ''
      router.push(`/schedule/${interviewId}/confirmed?when=${encodeURIComponent(when)}`)
    })
  }

  return (
    <div className="card p-6 md:p-8">
      <h1 className="serif font-bold text-2xl mb-1">{t('schedule.title')}</h1>
      <p className="text-ink/70 text-sm mb-4">{t('schedule.subtitle')}</p>
      <div className="mb-6 p-3 rounded-lg bg-slate-100 text-sm">
        <div className="font-semibold">{candidateName} · {roleTitle}</div>
      </div>

      <div className="space-y-2">
        {slots.map(s => (
          <label
            key={s.id}
            className={`flex items-center gap-3 p-4 card cursor-pointer border-2 transition ${selected === s.id ? 'border-accent bg-accent/5' : 'border-ink/10 hover:bg-ink/5'}`}
          >
            <input
              type="radio"
              name="slot"
              value={s.id}
              checked={selected === s.id}
              onChange={() => setSelected(s.id)}
              className="w-4 h-4 accent-accent"
            />
            <div className="flex-1">
              <div className="font-semibold">
                {new Date(s.slot_start).toLocaleString(localeTag, {
                  weekday: 'long', month: 'short', day: 'numeric',
                })}
              </div>
              <div className="text-sm text-ink/60">
                {new Date(s.slot_start).toLocaleTimeString(localeTag, { hour: 'numeric', minute: '2-digit' })}
                {' – '}
                {new Date(s.slot_end).toLocaleTimeString(localeTag, { hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
          </label>
        ))}
      </div>

      {error && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

      <button
        onClick={onConfirm}
        disabled={!selected || isPending}
        className="mt-6 btn-primary w-full"
      >{isPending ? '…' : t('schedule.confirm')}</button>
    </div>
  )
}
