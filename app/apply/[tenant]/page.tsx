import { notFound } from 'next/navigation'
import { getTenantBySlug, getOpenRequisitions } from '@/lib/tenant/resolve'
import { LocaleProvider } from '@/lib/i18n/LocaleContext'
import { LanguageToggle } from '@/components/LanguageToggle'
import { ApplicationForm } from '@/components/ApplicationForm'
import type { Locale } from '@/lib/i18n/translations'

export const dynamic = 'force-dynamic'

export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: { tenant: string }
  searchParams: { job?: string }
}) {
  const tenant = await getTenantBySlug(params.tenant)
  if (!tenant) notFound()

  const requisitions = await getOpenRequisitions(tenant.id)

  // If ?job=<uuid> is passed, pull the full job record so we can show its description
  const preselectedJobId = searchParams.job ?? null
  const preselectedJob = preselectedJobId
    ? requisitions.find((r) => r.id === preselectedJobId) ?? null
    : null

  const initialLocale = (tenant.locale_default as Locale) ?? 'ar'

  return (
    <LocaleProvider initial={initialLocale}>
      <main className="min-h-screen py-10 px-4 md:px-6">
        <div className="max-w-2xl mx-auto">
          <header className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-ink text-white font-black">
                {(tenant.name?.charAt(0) ?? 'M').toUpperCase()}
              </span>
              <span className="serif text-lg font-bold">{tenant.name}</span>
            </div>
            <LanguageToggle />
          </header>

          {preselectedJob && (
            <div className="card p-5 mb-4 bg-accent/5 border-s-4 border-accent">
              <div className="text-xs uppercase tracking-wider text-accent font-bold mb-1">
                Applying for
              </div>
              <h2 className="serif font-bold text-xl">{preselectedJob.title}</h2>
              {(preselectedJob as { description?: string | null }).description && (
                <div className="mt-3 text-sm text-ink/80 whitespace-pre-wrap leading-relaxed">
                  {(preselectedJob as { description?: string | null }).description}
                </div>
              )}
            </div>
          )}

          <ApplicationForm
            tenantSlug={tenant.slug}
            tenantName={tenant.name}
            requisitions={requisitions}
            preselectedJobId={preselectedJobId}
          />

          <footer className="mt-10 text-center text-xs text-ink/40">
            {tenant.name} · powered by Full Scope
          </footer>
        </div>
      </main>
    </LocaleProvider>
  )
}
