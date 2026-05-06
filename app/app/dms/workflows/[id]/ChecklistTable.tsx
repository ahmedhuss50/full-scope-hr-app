'use client'
import { useState, useTransition } from 'react'
import { Sparkles, Pencil, Check, X } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleContext'
import { saveChecklistResponse } from './checklist-actions'

export type ChecklistStatus = 'verified' | 'issue' | 'not_mentioned' | 'not_attached' | 'pending'

export interface ChecklistRow {
  item_id: string
  order_index: number
  code: string | null
  prompt_en: string
  prompt_ar: string
  /** present once admin/auditor has answered */
  status: ChecklistStatus | null
  notes: string | null
  ai_status: ChecklistStatus | null
  ai_notes: string | null
  ai_confidence: number | null
}

export function ChecklistTable({
  rows,
  runId,
  runStepId,
  editable,
}: {
  rows: ChecklistRow[]
  runId: string
  runStepId: string
  editable: boolean
}) {
  const { t, locale } = useLocale()
  const isRtl = locale === 'ar'

  const answered = rows.filter((r) => r.status && r.status !== 'pending').length

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h4 className="text-sm font-bold text-slate-900">
          {t('disbursement.checklist.header')}
        </h4>
        <span className="text-xs text-slate-500 font-mono">
          {t('disbursement.checklist.subtitle', { answered, total: rows.length })}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold text-start w-10">{t('disbursement.checklist.col.num')}</th>
              <th className="px-3 py-2 font-semibold text-start">{t('disbursement.checklist.col.question')}</th>
              <th className="px-3 py-2 font-semibold text-start whitespace-nowrap">{t('disbursement.checklist.col.ai_suggested')}</th>
              <th className="px-3 py-2 font-semibold text-start whitespace-nowrap">{t('disbursement.checklist.col.status')}</th>
              <th className="px-3 py-2 font-semibold text-start">{t('disbursement.checklist.col.notes')}</th>
              {editable && (
                <th className="px-3 py-2 font-semibold text-start w-16">{t('disbursement.checklist.col.actions')}</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <ChecklistRowView
                key={row.item_id}
                row={row}
                runId={runId}
                runStepId={runStepId}
                editable={editable}
                isRtl={isRtl}
              />
            ))}
          </tbody>
        </table>
      </div>

      {!editable && (
        <p className="mt-2 text-xs text-slate-400 italic">
          {t('disbursement.checklist.read_only_complete')}
        </p>
      )}
    </div>
  )
}

function ChecklistRowView({
  row,
  runId,
  runStepId,
  editable,
  isRtl,
}: {
  row: ChecklistRow
  runId: string
  runStepId: string
  editable: boolean
  isRtl: boolean
}) {
  const { t } = useLocale()
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState<ChecklistStatus>(row.status ?? 'pending')
  const [notes, setNotes] = useState(row.notes ?? '')
  const [pending, startTransition] = useTransition()

  const finalStatus: ChecklistStatus = row.status ?? 'pending'

  function onSave() {
    startTransition(async () => {
      await saveChecklistResponse({
        run_id: runId,
        run_step_id: runStepId,
        checklist_item_id: row.item_id,
        status,
        notes: notes || null,
      })
      setEditing(false)
    })
  }

  return (
    <tr className={statusRowBg(finalStatus)}>
      <td className="px-3 py-2 align-top text-slate-500 font-mono text-xs">{row.order_index}</td>
      <td className="px-3 py-2 align-top">
        <div className="font-semibold text-slate-900 text-[13px] leading-snug" dir={isRtl ? 'rtl' : 'ltr'}>
          {isRtl ? row.prompt_ar : row.prompt_en}
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5" dir={isRtl ? 'ltr' : 'rtl'}>
          {isRtl ? row.prompt_en : row.prompt_ar}
        </div>
        {row.code && (
          <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{row.code}</div>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        {row.ai_status ? (
          <div className="space-y-1">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusChipClasses(row.ai_status)}`}
            >
              <Sparkles className="w-3 h-3" />
              {t(`disbursement.checklist.status.${row.ai_status}`)}
            </span>
            {row.ai_confidence != null && (
              <div className="text-[10px] text-slate-500 font-mono">
                {t('disbursement.checklist.ai_confidence', { pct: Math.round(row.ai_confidence * 100) })}
              </div>
            )}
          </div>
        ) : (
          <span className="text-[10px] text-slate-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        {editing ? (
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ChecklistStatus)}
            className="text-[11px] rounded border border-slate-300 px-2 py-1 bg-white"
          >
            <option value="verified">{t('disbursement.checklist.status.verified')}</option>
            <option value="issue">{t('disbursement.checklist.status.issue')}</option>
            <option value="not_mentioned">{t('disbursement.checklist.status.not_mentioned')}</option>
            <option value="not_attached">{t('disbursement.checklist.status.not_attached')}</option>
            <option value="pending">{t('disbursement.checklist.status.pending')}</option>
          </select>
        ) : (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusChipClasses(finalStatus)}`}>
            {t(`disbursement.checklist.status.${finalStatus}`)}
          </span>
        )}
      </td>
      <td className="px-3 py-2 align-top text-[12px] text-slate-700 max-w-xs">
        {editing ? (
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('disbursement.checklist.notes_placeholder')}
            className="w-full text-[11px] rounded border border-slate-300 px-2 py-1 bg-white"
          />
        ) : (
          row.notes ? <span className="whitespace-pre-wrap">{row.notes}</span> : <span className="text-slate-400">—</span>
        )}
      </td>
      {editable && (
        <td className="px-3 py-2 align-top">
          {editing ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onSave}
                disabled={pending}
                className="p-1 rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60"
                title={t('disbursement.checklist.save')}
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setStatus(row.status ?? 'pending')
                  setNotes(row.notes ?? '')
                }}
                disabled={pending}
                className="p-1 rounded bg-white text-slate-600 border border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                title={t('disbursement.checklist.cancel')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              title={t('disbursement.checklist.edit')}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </td>
      )}
    </tr>
  )
}

function statusChipClasses(s: ChecklistStatus): string {
  switch (s) {
    case 'verified':      return 'bg-green-50  text-green-700  ring-1 ring-inset ring-green-200'
    case 'issue':         return 'bg-red-50    text-red-700    ring-1 ring-inset ring-red-200'
    case 'not_mentioned': return 'bg-slate-100 text-slate-600  ring-1 ring-inset ring-slate-200'
    case 'not_attached':  return 'bg-amber-50  text-amber-700  ring-1 ring-inset ring-amber-200'
    case 'pending':       return 'bg-slate-50  text-slate-500  ring-1 ring-inset ring-slate-200'
  }
}

function statusRowBg(s: ChecklistStatus): string {
  switch (s) {
    case 'verified':      return 'bg-green-50/30'
    case 'issue':         return 'bg-red-50/40'
    case 'not_mentioned': return 'bg-slate-50/40'
    case 'not_attached':  return 'bg-amber-50/30'
    case 'pending':       return ''
  }
}
