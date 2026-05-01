'use client'
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { t as tFn, type Locale, type StringKey } from './translations'

type Direction = 'ltr' | 'rtl'

type Ctx = {
  locale: Locale
  setLocale: (l: Locale) => void
  dir: Direction
  t: (key: StringKey, vars?: Record<string, string | number>) => string
}

const LocaleCtx = createContext<Ctx | null>(null)

function dirFor(locale: Locale): Direction {
  return locale === 'ar' ? 'rtl' : 'ltr'
}

export function LocaleProvider({ initial = 'ar', children }: { initial?: Locale; children: ReactNode }) {
  // Full Scope HR defaults to Arabic — KSA-primary tenant.
  const [locale, setLocale] = useState<Locale>(initial)

  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem('full-scope-hr.locale') : null
      if (saved === 'en' || saved === 'ar') setLocale(saved)
    } catch {}
  }, [])

  useEffect(() => {
    try { window.localStorage.setItem('full-scope-hr.locale', locale) } catch {}
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale
      document.documentElement.dir = dirFor(locale)
    }
  }, [locale])

  const value: Ctx = {
    locale,
    setLocale,
    dir: dirFor(locale),
    t: (key, vars) => tFn(key, locale, vars),
  }
  return <LocaleCtx.Provider value={value}>{children}</LocaleCtx.Provider>
}

export function useLocale() {
  const ctx = useContext(LocaleCtx)
  if (!ctx) throw new Error('useLocale must be used inside <LocaleProvider>')
  return ctx
}
