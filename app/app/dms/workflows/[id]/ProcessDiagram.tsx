/**
 * ProcessDiagram — top-of-page horizontal flow diagram for a workflow run.
 *
 * Server component (no 'use client'). Renders one card per stage in
 * left-to-right order, with chevron connectors, and a single progress bar
 * underneath. Cards wrap to a 2x2 grid on small screens.
 *
 * % complete = (approved_stages * 1.0 + active_stage * 0.5) / total_stages
 */
import { Fragment } from 'react'
import { ChevronRight, Check, X, Circle, User } from 'lucide-react'
import { t as tFn, type Locale } from '@/lib/i18n/translations'
import { fmtDateTime } from '../_shared'

export type ProcessStageStatus = 'pending' | 'awaiting' | 'approved' | 'rejected' | 'skipped'

export interface Stage {
  order_index: number
  name: string
  status: ProcessStageStatus
  signer_name?: string | null
  signer_kind?: 'internal_user' | 'external' | null
  activated_at?: string | null
  completed_at?: string | null
  is_active?: boolean
}

export interface ProcessDiagramProps {
  stages: Stage[]
  locale: Locale
  /** Optional — full name of the signed-in user, used to render "You" on
   *  internal-signer cards belonging to the viewer. */
  currentUserName?: string | null
}

interface VisualTokens {
  card: string
  numberCircle: string
  iconWrap: string
  icon: React.ReactNode
  statusText: string
  statusLabel: string
}

function tokensForStatus(status: ProcessStageStatus, locale: Locale): VisualTokens {
  if (status === 'approved') {
    return {
      card: 'bg-green-50 border-green-200',
      numberCircle: 'bg-green-100 text-green-800 ring-2 ring-white',
      iconWrap: 'bg-green-100 text-green-700',
      icon: <Check className="w-3.5 h-3.5" aria-hidden="true" />,
      statusText: 'text-green-700',
      statusLabel: tFn('process.done', locale),
    }
  }
  if (status === 'rejected') {
    return {
      card: 'bg-red-50 border-red-200',
      numberCircle: 'bg-red-100 text-red-800 ring-2 ring-white',
      iconWrap: 'bg-red-100 text-red-700',
      icon: <X className="w-3.5 h-3.5" aria-hidden="true" />,
      statusText: 'text-red-700',
      statusLabel: tFn('process.rejected', locale),
    }
  }
  if (status === 'awaiting') {
    return {
      card: 'bg-teal-50 border-teal-200 ring-2 ring-teal-100',
      numberCircle: 'bg-teal-600 text-white ring-2 ring-white',
      iconWrap: 'bg-teal-100 text-teal-700',
      // Active stage: animated pulsing dot
      icon: <span className="block w-2 h-2 rounded-full bg-teal-600 animate-pulse" aria-hidden="true" />,
      statusText: 'text-teal-700',
      statusLabel: tFn('process.in_progress', locale),
    }
  }
  // pending / skipped
  return {
    card: 'bg-slate-50 border-slate-200',
    numberCircle: 'bg-slate-200 text-slate-600 ring-2 ring-white',
    iconWrap: 'bg-slate-100 text-slate-500',
    icon: <Circle className="w-3.5 h-3.5" aria-hidden="true" />,
    statusText: 'text-slate-500',
    statusLabel: tFn('process.pending', locale),
  }
}

function relativeTime(iso: string, locale: Locale): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = now - then
  const minutes = Math.floor(diffMs / (60 * 1000))
  const hours = Math.floor(diffMs / (60 * 60 * 1000))
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  const isAr = locale === 'ar'
  if (minutes < 1) return isAr ? 'الآن' : 'just now'
  if (minutes < 60) return isAr ? `قبل ${minutes} دقيقة` : `${minutes}m ago`
  if (hours < 24) return isAr ? `قبل ${hours} ساعة` : `${hours}h ago`
  if (days < 30) return isAr ? `قبل ${days} يوم` : `${days}d ago`
  // Fall back to absolute date for older events
  return fmtDateTime(iso, locale)
}

/** Decide what time/status text to show under the signer name on a card. */
function timeText(stage: Stage, locale: Locale): string | null {
  if (stage.status === 'approved' && stage.completed_at) {
    return relativeTime(stage.completed_at, locale)
  }
  if (stage.status === 'rejected' && stage.completed_at) {
    return relativeTime(stage.completed_at, locale)
  }
  if (stage.status === 'awaiting') {
    return tFn('process.in_progress', locale)
  }
  if (stage.status === 'pending') {
    return tFn('process.pending', locale)
  }
  return null
}

function signerLabel(stage: Stage, locale: Locale, currentUserName?: string | null): string {
  if (!stage.signer_name) return tFn('process.no_signer', locale)
  if (
    stage.signer_kind === 'internal_user' &&
    currentUserName &&
    stage.signer_name.trim() === currentUserName.trim()
  ) {
    // "Ahmed (you)"
    const youLabel = tFn('process.signer.you', locale)
    const first = stage.signer_name.split(/[\s—-]/)[0]
    return `${first} (${youLabel})`
  }
  return stage.signer_name
}

export function ProcessDiagram({ stages, locale, currentUserName }: ProcessDiagramProps) {
  const total = stages.length
  if (total === 0) return null

  const approvedCount = stages.filter((s) => s.status === 'approved').length
  const hasActive = stages.some((s) => s.status === 'awaiting')
  const activeWeight = hasActive ? 0.5 : 0
  const completedFractional = approvedCount + activeWeight
  const pct = Math.max(0, Math.min(100, Math.round((completedFractional / total) * 100)))
  const doneDisplay =
    Number.isInteger(completedFractional)
      ? String(completedFractional)
      : completedFractional.toFixed(1)

  return (
    <section
      className="bg-white border border-slate-200 rounded-xl shadow-sm p-5"
      aria-label={tFn('workflows.detail.activity_timeline', locale)}
    >
      {/* Cards row — flex on desktop, 2-col grid on mobile */}
      <div className="grid grid-cols-2 sm:flex sm:flex-row sm:flex-nowrap items-stretch gap-3 sm:gap-2">
        {stages.map((stage, idx) => {
          const tokens = tokensForStatus(stage.status, locale)
          const isLast = idx === stages.length - 1
          const time = timeText(stage, locale)
          return (
            <Fragment key={`${stage.order_index}-${stage.name}`}>
              <div
                className={`flex-1 min-w-0 rounded-xl border p-3 sm:p-4 transition ${tokens.card}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold shadow-sm ${tokens.numberCircle}`}
                    aria-hidden="true"
                  >
                    {stage.order_index}
                  </span>
                  <div
                    className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full ${tokens.iconWrap}`}
                  >
                    {tokens.icon}
                  </div>
                </div>
                <div className="mt-2 text-sm font-bold text-slate-900 leading-tight truncate">
                  {stage.name}
                </div>
                <div className={`mt-0.5 text-[11px] font-semibold uppercase tracking-wider ${tokens.statusText}`}>
                  {tokens.statusLabel}
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-700 min-w-0">
                  <User className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />
                  <span className="truncate">{signerLabel(stage, locale, currentUserName)}</span>
                </div>
                {time && (
                  <div className="mt-0.5 text-[11px] text-slate-500 truncate">{time}</div>
                )}
              </div>
              {/* Chevron connector — only between cards on the desktop row */}
              {!isLast && (
                <div
                  className="hidden sm:flex items-center justify-center text-slate-300 shrink-0"
                  aria-hidden="true"
                >
                  <ChevronRight className="w-5 h-5 rtl:rotate-180" />
                </div>
              )}
            </Fragment>
          )
        })}
      </div>

      {/* Progress bar */}
      <div className="mt-5">
        <div
          className="h-2 w-full rounded-full bg-slate-200 overflow-hidden"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-teal-600 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-2 text-xs text-slate-600 font-medium">
          {tFn('process.percent_complete', locale, {
            pct,
            done: doneDisplay,
            total,
          })}
        </div>
      </div>
    </section>
  )
}
