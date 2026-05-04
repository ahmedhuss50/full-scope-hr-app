// Shared types + small helpers for the workflows UI.
// Client-safe (no server imports).

import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'

export type WorkflowRunStatus = 'in_progress' | 'awaiting_signer' | 'completed' | 'rejected' | 'cancelled' | 'expired'
export type WorkflowStepStatus = 'pending' | 'awaiting' | 'approved' | 'rejected' | 'skipped'
export type WorkflowStageKind = 'intake' | 'client_signature' | 'end_customer' | 'internal_review' | 'final_approval' | 'archived'
export type WorkflowSignerKind = 'internal_user' | 'external'

export function statusChipClasses(status: WorkflowRunStatus): string {
  switch (status) {
    case 'in_progress':     return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200'
    case 'awaiting_signer': return 'bg-blue-50  text-blue-700  ring-1 ring-inset ring-blue-200'
    case 'completed':       return 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-200'
    case 'rejected':        return 'bg-red-50   text-red-700   ring-1 ring-inset ring-red-200'
    case 'cancelled':       return 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200'
    case 'expired':         return 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200'
  }
}

export function stepStatusChipClasses(status: WorkflowStepStatus): string {
  switch (status) {
    case 'pending':  return 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200'
    case 'awaiting': return 'bg-blue-50   text-blue-700  ring-1 ring-inset ring-blue-200'
    case 'approved': return 'bg-green-50  text-green-700 ring-1 ring-inset ring-green-200'
    case 'rejected': return 'bg-red-50    text-red-700   ring-1 ring-inset ring-red-200'
    case 'skipped':  return 'bg-slate-50  text-slate-500 ring-1 ring-inset ring-slate-200'
  }
}

export function statusLabel(status: WorkflowRunStatus, locale: Locale): string {
  return tFn(`workflows.status.${status}` as StringKey, locale)
}

export function stepStatusLabel(status: WorkflowStepStatus, locale: Locale): string {
  return tFn(`workflows.step.status.${status}` as StringKey, locale)
}

export function stageLabel(kind: WorkflowStageKind, locale: Locale): string {
  return tFn(`workflows.stage.${kind}` as StringKey, locale)
}

export function fmtDateTime(s: string | null | undefined, locale: Locale): string {
  if (!s) return '—'
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: 'numeric',
    }).format(new Date(s))
  } catch {
    return s
  }
}

export function fmtDate(s: string | null | undefined, locale: Locale): string {
  if (!s) return '—'
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      day: 'numeric', month: 'short', year: 'numeric',
    }).format(new Date(s))
  } catch {
    return s
  }
}

export function daysBetween(startIso: string, endIso?: string | null): number {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  return Math.max(0, Math.floor((end - start) / (24 * 60 * 60 * 1000)))
}

export function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}
