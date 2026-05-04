// Shared formatters/types/components for DMS routes.
// Keep this client-safe (no server imports) so it can be imported from any page.

import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'

export type DmsSensitivity = 'public' | 'internal' | 'confidential' | 'restricted'
export type DmsStatus = 'draft' | 'final' | 'signed' | 'archived' | 'superseded'

export function fmtBytes(bytes: number | null | undefined, locale: Locale): string {
  if (bytes === null || bytes === undefined) return '—'
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const dp = v >= 100 || i === 0 ? 0 : 1
  try {
    const fmt = new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    }).format(v)
    return `${fmt} ${units[i]}`
  } catch {
    return `${v.toFixed(dp)} ${units[i]}`
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

export function sensitivityClasses(s: DmsSensitivity): string {
  switch (s) {
    case 'restricted':   return 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200'
    case 'confidential': return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200'
    case 'internal':     return 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
    case 'public':       return 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-200'
  }
}

export function statusClasses(s: DmsStatus): string {
  switch (s) {
    case 'draft':       return 'bg-yellow-50 text-yellow-800 ring-1 ring-inset ring-yellow-200'
    case 'final':       return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
    case 'signed':      return 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-200'
    case 'archived':    return 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200'
    case 'superseded':  return 'bg-slate-50 text-slate-500 ring-1 ring-inset ring-slate-200'
  }
}

export function sensitivityLabel(s: DmsSensitivity, locale: Locale): string {
  return tFn(`dms.sensitivity.${s}` as StringKey, locale)
}

export function statusLabel(s: DmsStatus, locale: Locale): string {
  return tFn(`dms.status.${s}` as StringKey, locale)
}

const KIND_KEYS: Record<string, StringKey> = {
  engagement_letter:    'dms.kind.engagement_letter',
  financial_statement:  'dms.kind.financial_statement',
  tax_return:           'dms.kind.tax_return',
  working_paper:        'dms.kind.working_paper',
  other:                'dms.kind.other',
}

export function kindLabel(kind: string | null | undefined, locale: Locale): string {
  if (!kind) return '—'
  const key = KIND_KEYS[kind]
  return key ? tFn(key, locale) : kind
}
