'use client'
/**
 * Client Portal — public landing.
 *
 * Marketing-style intro that explains what the portal IS for clients of the
 * firm. Sits at /portal so a client can land here from a firm partner's email
 * link or a printed business card. Bilingual EN/AR (LocaleProvider).
 *
 * NOT the firm app at /app. The two share Supabase Auth but have separate
 * URLs, separate layouts, separate visual identity.
 */
import Link from 'next/link'
import { ArrowRight, Shield, FileText, Briefcase } from 'lucide-react'
import { LocaleProvider, useLocale } from '@/lib/i18n/LocaleContext'
import { LanguageToggle } from '@/components/LanguageToggle'

function LandingInner() {
  const { t } = useLocale()
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-50">
      {/* Top bar */}
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-ink text-white font-black text-sm">F</span>
            <span className="serif text-lg font-bold">Full Scope</span>
            <span className="ms-3 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200">
              {t('portal.nav.dashboard')}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <Link href="/portal/login" className="btn-primary text-sm">
              {t('portal.landing.signin')}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-12 text-center">
        <h1 className="serif font-black text-4xl md:text-5xl tracking-tight text-slate-900 leading-tight">
          {t('portal.landing.title')}
        </h1>
        <p className="mt-5 text-lg text-slate-600 leading-relaxed">
          {t('portal.landing.subtitle')}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/portal/login" className="btn-primary">
            {t('portal.landing.signin')}
            <ArrowRight className="w-4 h-4 ms-2" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* Feature strip */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-teal-50 mb-3">
              <Briefcase className="w-5 h-5 text-teal-600" aria-hidden="true" />
            </div>
            <div className="text-sm font-semibold text-slate-900 mb-1">
              {t('portal.nav.engagements')}
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {t('portal.engagements.subtitle')}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-teal-50 mb-3">
              <FileText className="w-5 h-5 text-teal-600" aria-hidden="true" />
            </div>
            <div className="text-sm font-semibold text-slate-900 mb-1">
              {t('portal.nav.documents')}
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {t('portal.documents.subtitle')}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-teal-50 mb-3">
              <Shield className="w-5 h-5 text-teal-600" aria-hidden="true" />
            </div>
            <div className="text-sm font-semibold text-slate-900 mb-1">
              {t('portal.nav.invoices')}
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {t('portal.invoices.subtitle')}
            </p>
          </div>
        </div>

        <div className="mt-10 text-center text-xs text-slate-500">
          <span>{t('portal.landing.firm_link')} </span>
          <Link href="/login" className="font-semibold text-teal-700 hover:text-teal-800 ms-1">
            {t('portal.landing.firm_cta')}
          </Link>
        </div>
      </section>
    </main>
  )
}

export default function PortalLandingPage() {
  return (
    <LocaleProvider>
      <LandingInner />
    </LocaleProvider>
  )
}
