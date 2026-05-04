// Shared formatters/types/helpers for CRM routes.
// Keep this client-safe (no server imports) so it can be imported from anywhere.

import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'

export type CrmStage =
  | 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'on_hold' | 'won' | 'lost'

export type CrmContactRole =
  | 'primary' | 'finance' | 'technical' | 'executive' | 'legal' | 'procurement' | 'assistant' | 'other'

export type CrmActivityKind =
  | 'call' | 'email' | 'meeting' | 'note' | 'task' | 'proposal_sent' | 'engagement_started'

export const PIPELINE_STAGES: CrmStage[] = [
  'lead', 'qualified', 'proposal', 'negotiation', 'on_hold', 'won', 'lost',
]

/** Stages that count as "open" in the funnel (not yet closed). */
export const OPEN_STAGES: CrmStage[] = ['lead', 'qualified', 'proposal', 'negotiation', 'on_hold']

export function stageClasses(s: CrmStage): string {
  switch (s) {
    case 'lead':        return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
    case 'qualified':   return 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
    case 'proposal':    return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200'
    case 'negotiation': return 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200'
    case 'on_hold':     return 'bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200'
    case 'won':         return 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-200'
    case 'lost':        return 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200'
  }
}

/** Background color for the bar inside the "pipeline by stage" widget. */
export function stageBarClass(s: CrmStage): string {
  switch (s) {
    case 'lead':        return 'bg-slate-400'
    case 'qualified':   return 'bg-blue-500'
    case 'proposal':    return 'bg-amber-500'
    case 'negotiation': return 'bg-teal-500'
    case 'on_hold':     return 'bg-gray-400'
    case 'won':         return 'bg-green-500'
    case 'lost':        return 'bg-red-500'
  }
}

export function stageLabel(s: CrmStage, locale: Locale): string {
  return tFn(`crm.stage.${s}` as StringKey, locale)
}

export function roleLabel(r: CrmContactRole, locale: Locale): string {
  return tFn(`crm.role.${r}` as StringKey, locale)
}

export function roleClasses(r: CrmContactRole): string {
  switch (r) {
    case 'primary':     return 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200'
    case 'finance':     return 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
    case 'technical':   return 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200'
    case 'executive':   return 'bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-200'
    case 'legal':       return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200'
    case 'procurement': return 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
    case 'assistant':   return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
    case 'other':       return 'bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200'
  }
}

export function activityKindLabel(k: CrmActivityKind, locale: Locale): string {
  return tFn(`crm.activity.kind.${k}` as StringKey, locale)
}

export function activityKindClasses(k: CrmActivityKind): string {
  switch (k) {
    case 'call':               return 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
    case 'email':              return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
    case 'meeting':            return 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200'
    case 'note':               return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200'
    case 'task':               return 'bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-200'
    case 'proposal_sent':      return 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200'
    case 'engagement_started': return 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-200'
  }
}

export function fmtSar(amount: number | null | undefined, locale: Locale): string {
  if (amount === null || amount === undefined) return '—'
  const n = Number(amount)
  if (!Number.isFinite(n)) return '—'
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      style: 'currency', currency: 'SAR', maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${n.toLocaleString()} SAR`
  }
}

/** Compact SAR — drops the SAR suffix for tight kanban cards. */
export function fmtSarCompact(amount: number | null | undefined, locale: Locale): string {
  if (amount === null || amount === undefined) return '—'
  const n = Number(amount)
  if (!Number.isFinite(n)) return '—'
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      maximumFractionDigits: 0,
    }).format(n) + ' SAR'
  } catch {
    return `${n.toLocaleString()} SAR`
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

/** Returns { start, end } ISO dates for the current calendar quarter. */
export function currentQuarterRange(now: Date = new Date()): { startIso: string; endIso: string } {
  const y = now.getFullYear()
  const q = Math.floor(now.getMonth() / 3) // 0..3
  const start = new Date(y, q * 3, 1)
  const end   = new Date(y, q * 3 + 3, 1) // first day of next quarter (exclusive)
  return {
    startIso: start.toISOString().slice(0, 10),
    endIso:   end.toISOString().slice(0, 10),
  }
}

export function isOverdue(expectedClose: string | null | undefined, stage: CrmStage): boolean {
  if (!expectedClose) return false
  if (stage === 'won' || stage === 'lost') return false
  const today = new Date().toISOString().slice(0, 10)
  return expectedClose < today
}
