'use client'
/**
 * AgentPanel — UI for kicking off + monitoring a Disbursement AI Agent run.
 *
 * Renders only when the workflow is the disbursement template.
 *  - Threshold slider (0.50–0.99) controls auto-fill cutoff.
 *  - Auto-advance toggle gates whether the agent moves the stage on completion.
 *  - "Run AI Agent" button calls the startAgentRun server action; while in
 *    flight, we show a polling view that tails the agent_actions feed.
 *  - When done, a success summary + a list of recent runs is displayed.
 */
import { useEffect, useRef, useState, useTransition } from 'react'
import { Bot, Sparkles, Play, AlertTriangle, CheckCircle2, Loader2, Activity, Pencil, Wand2 } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleContext'
import {
  startAgentRun,
  getAgentRunStatus,
  listRecentAgentRuns,
  type AgentActionView,
  type AgentRunView,
  type AgentRunHistoryView,
} from './agent-actions'

interface Props {
  runId: string
  stepId: string
  totalChecklistItems: number
}

export function AgentPanel({ runId, stepId, totalChecklistItems }: Props) {
  const { t, locale } = useLocale()
  const [threshold, setThreshold] = useState(0.85)
  const [autoAdvance, setAutoAdvance] = useState(false)
  const [pending, startTransition] = useTransition()
  const [agentRunId, setAgentRunId] = useState<string | null>(null)
  const [run, setRun] = useState<AgentRunView | null>(null)
  const [actions, setActions] = useState<AgentActionView[]>([])
  const [recent, setRecent] = useState<AgentRunHistoryView[]>([])
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)

  // Initial fetch of recent runs.
  useEffect(() => {
    listRecentAgentRuns(runId).then((r) => {
      if (r.ok && r.runs) setRecent(r.runs)
    })
  }, [runId])

  // Poll while a run is active.
  useEffect(() => {
    if (!agentRunId) return
    if (run?.status === 'completed' || run?.status === 'failed') {
      if (pollRef.current) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    if (pollRef.current) return
    const tick = async () => {
      const r = await getAgentRunStatus(agentRunId)
      if (r.ok) {
        setRun(r.run ?? null)
        setActions(r.actions ?? [])
      }
    }
    void tick()
    pollRef.current = window.setInterval(() => void tick(), 2000)
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [agentRunId, run?.status])

  function onRun() {
    setError(null)
    startTransition(async () => {
      const res = await startAgentRun({
        run_id: runId,
        step_id: stepId,
        confidence_threshold: threshold,
        auto_advance: autoAdvance,
      })
      if (!res.ok) {
        setError(res.error ?? 'Failed')
        if (res.agent_run_id) setAgentRunId(res.agent_run_id)
        return
      }
      setAgentRunId(res.agent_run_id)
      // refresh recent runs
      const r = await listRecentAgentRuns(runId)
      if (r.ok && r.runs) setRecent(r.runs)
    })
  }

  const analyzedCount = actions.filter((a) => a.kind === 'analyze_checklist_item' && a.status === 'success').length
  const filledCount = actions.filter((a) => a.kind === 'fill_checklist_response').length
  const flaggedCount = actions.filter(
    (a) => a.kind === 'log_observation' && a.target_kind === 'checklist_item',
  ).length

  const statusKey = (run?.status ?? 'queued') as 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  const isRunning = pending || statusKey === 'running' || statusKey === 'queued'

  const cost = Number(run?.cost_usd ?? 0)
  const tokIn = run?.total_tokens_in ?? 0
  const tokOut = run?.total_tokens_out ?? 0

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-teal-50 ring-1 ring-inset ring-teal-100 flex items-center justify-center">
            <Bot className="w-5 h-5 text-teal-700" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">{t('agent.title')}</h3>
            <p className="text-xs text-slate-500">{t('agent.subtitle')}</p>
          </div>
        </div>
        {run && (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
              statusKey === 'completed'
                ? 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-200'
                : statusKey === 'failed'
                ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200'
                : 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
            }`}
          >
            {t(`agent.status.${statusKey}` as 'agent.status.completed')}
          </span>
        )}
      </div>

      <div className="p-5 space-y-5">
        {/* Settings */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
              <span>{t('agent.settings.threshold')}</span>
              <span className="font-mono text-teal-700">{Math.round(threshold * 100)}%</span>
            </label>
            <input
              type="range"
              min={0.5}
              max={0.99}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              disabled={isRunning}
              className="w-full mt-2 accent-teal-600"
              dir="ltr"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              {locale === 'ar'
                ? 'يملأ الوكيل تلقائيًا البنود التي تتجاوز ثقتها هذه النسبة.'
                : 'Agent only auto-fills items above this confidence.'}
            </p>
          </div>
          <div className="flex flex-col">
            <label className="text-xs font-semibold text-slate-700">
              {t('agent.settings.auto_advance')}
            </label>
            <label className="mt-2 inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoAdvance}
                onChange={(e) => setAutoAdvance(e.target.checked)}
                disabled={isRunning}
                className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-slate-800">
                {autoAdvance
                  ? locale === 'ar' ? 'مفعَّل' : 'Enabled'
                  : locale === 'ar' ? 'مُعطَّل' : 'Disabled'}
              </span>
            </label>
            <p className="text-[10px] text-slate-500 mt-1">
              {locale === 'ar'
                ? 'لن يتم التقدّم إذا وُجدت ملاحظات حرجة.'
                : 'Never advances if any item is flagged as an issue.'}
            </p>
          </div>
        </div>

        {/* Big run button */}
        <button
          type="button"
          onClick={onRun}
          disabled={isRunning}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-700 disabled:opacity-60 disabled:cursor-wait shadow-sm"
        >
          {isRunning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('agent.actions.running')}
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              {t('agent.actions.run')}
            </>
          )}
        </button>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>{error}</div>
          </div>
        )}

        {/* Live progress (visible while a run exists) */}
        {agentRunId && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-white flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs font-semibold text-slate-700 flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-teal-600" />
                {t('agent.progress.analyzed', { x: analyzedCount, total: totalChecklistItems })}
                <span className="text-slate-400">·</span>
                {t('agent.progress.filled', { y: filledCount })}
                <span className="text-slate-400">·</span>
                {t('agent.progress.flagged', { z: flaggedCount })}
              </div>
              <div className="text-[11px] font-mono text-slate-500 flex items-center gap-3">
                <span>{t('agent.cost.tokens_in', { n: tokIn })}</span>
                <span>{t('agent.cost.tokens_out', { n: tokOut })}</span>
                <span className="text-teal-700">{t('agent.cost.usd', { v: cost.toFixed(4) })}</span>
              </div>
            </div>

            <ol className="divide-y divide-slate-100 max-h-72 overflow-y-auto bg-white">
              {actions.length === 0 && (
                <li className="px-4 py-3 text-xs text-slate-500 italic">
                  {locale === 'ar' ? 'يجري تشغيل الوكيل…' : 'Agent is starting up…'}
                </li>
              )}
              {actions.map((a) => (
                <li key={a.id} className="px-4 py-2.5 text-xs">
                  <div className="flex items-start gap-2">
                    <ActionIcon kind={a.kind} status={a.status} />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900 truncate">
                        {actionLabel(a.kind, locale)}
                        {a.input_summary && (
                          <span className="text-slate-500 font-normal"> — {a.input_summary}</span>
                        )}
                      </div>
                      {a.output_summary && (
                        <div className="text-slate-600 leading-snug mt-0.5">{a.output_summary}</div>
                      )}
                      {a.reasoning && (
                        <div className="text-slate-500 italic leading-snug mt-0.5 line-clamp-2">
                          {a.reasoning}
                        </div>
                      )}
                    </div>
                    {a.confidence != null && (
                      <span className="font-mono text-[10px] text-slate-500 shrink-0">
                        {Math.round(Number(a.confidence) * 100)}%
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            {statusKey === 'completed' && (
              <div className="px-4 py-3 bg-green-50 border-t border-green-100 text-xs text-green-900 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  {locale === 'ar'
                    ? `اكتمل الوكيل: مَلأ ${filledCount} بند، وضع علامة على ${flaggedCount} بند للمراجعة البشرية.`
                    : `Agent completed: filled ${filledCount} items, flagged ${flaggedCount} for human review.`}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Recent runs */}
        {recent.length > 0 && (
          <div>
            <h4 className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-2">
              {t('agent.recent_runs')}
            </h4>
            <ul className="space-y-1">
              {recent.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 text-xs bg-white border border-slate-200 rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                    <span className="font-mono text-[10px] text-slate-500 truncate">{r.id.slice(0, 8)}</span>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                        r.status === 'completed'
                          ? 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-200'
                          : r.status === 'failed'
                          ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200'
                          : 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200'
                      }`}
                    >
                      {t(`agent.status.${r.status}` as never)}
                    </span>
                    {r.auto_advance && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200">
                        {locale === 'ar' ? 'تلقائي' : 'auto'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-slate-500 shrink-0">
                    {r.started_at && (
                      <span className="hidden sm:inline">
                        {new Date(r.started_at).toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-GB')}
                      </span>
                    )}
                    {r.cost_usd != null && (
                      <span className="font-mono text-teal-700">${Number(r.cost_usd).toFixed(4)}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

function actionLabel(kind: string, locale: 'en' | 'ar'): string {
  switch (kind) {
    case 'read_document':
      return locale === 'ar' ? 'قراءة الوثائق' : 'Read documents'
    case 'analyze_checklist_item':
      return locale === 'ar' ? 'تحليل بند' : 'Analyze item'
    case 'fill_checklist_response':
      return locale === 'ar' ? 'تعبئة الإجابة' : 'Fill response'
    case 'advance_stage':
      return locale === 'ar' ? 'تقدّم المرحلة' : 'Advance stage'
    case 'reject_stage':
      return locale === 'ar' ? 'رفض المرحلة' : 'Reject stage'
    case 'send_notification':
      return locale === 'ar' ? 'إرسال إشعار' : 'Send notification'
    case 'log_observation':
      return locale === 'ar' ? 'ملاحظة' : 'Observation'
    default:
      return kind
  }
}

function ActionIcon({ kind, status }: { kind: string; status: string }) {
  if (status === 'failure') return <AlertTriangle className="w-3.5 h-3.5 text-red-600 mt-0.5 shrink-0" />
  if (kind === 'fill_checklist_response') return <Pencil className="w-3.5 h-3.5 text-teal-600 mt-0.5 shrink-0" />
  if (kind === 'advance_stage') return <CheckCircle2 className="w-3.5 h-3.5 text-green-600 mt-0.5 shrink-0" />
  if (kind === 'analyze_checklist_item') return <Wand2 className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
  return <Sparkles className="w-3.5 h-3.5 text-teal-600 mt-0.5 shrink-0" />
}
