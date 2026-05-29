import Link from 'next/link'
import { headers } from 'next/headers'
import crypto from 'crypto'
import { createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import { LanguageToggle } from '@/components/LanguageToggle'
import { DeveloperDsbUploadForm, type DsbProjectOption } from './DeveloperDsbUploadForm'

export const dynamic = 'force-dynamic'

function pickLocaleFromAcceptLanguage(header: string | null): Locale {
  if (!header) return 'ar'
  const tags = header.toLowerCase().split(',').map((t) => t.split(';')[0].trim())
  for (const tag of tags) {
    if (tag.startsWith('ar')) return 'ar'
    if (tag.startsWith('en')) return 'en'
  }
  return 'ar'
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

type InvalidReason = 'not_found' | 'expired' | 'used' | 'revoked'

export default async function UploadDisbursementPage({
  params,
}: {
  params: { token: string }
}) {
  const tokenRaw = params.token
  const svc = createSupabaseService()
  const hdrs = headers()
  const locale = pickLocaleFromAcceptLanguage(hdrs.get('accept-language'))

  // 1) Resolve token by hash.
  const hash = hashToken(tokenRaw)
  const { data: tokenRow } = await svc
    .from('dsb_upload_tokens')
    .select(
      'id, tenant_id, developer_id, project_id, recipient_name, recipient_email, expires_at, used_at, revoked_at',
    )
    .eq('token_hash', hash)
    .maybeSingle()

  if (!tokenRow) return <InvalidLinkScreen locale={locale} reason="not_found" />
  if (tokenRow.revoked_at) return <InvalidLinkScreen locale={locale} reason="revoked" />
  if (tokenRow.used_at) return <InvalidLinkScreen locale={locale} reason="used" />
  if (new Date(tokenRow.expires_at as string).getTime() < Date.now()) {
    return <InvalidLinkScreen locale={locale} reason="expired" />
  }

  const tenantId = tokenRow.tenant_id as string
  const developerId = tokenRow.developer_id as string
  const preselectProjectId = (tokenRow.project_id as string | null) ?? null

  // 2) Load developer + its projects (any project in tenant scoped to this dev, plus
  //    legacy untied projects).
  const { data: devRow } = await svc
    .from('dsb_developers')
    .select('id, company_name_ar, tenant_id')
    .eq('tenant_id', tenantId)
    .eq('id', developerId)
    .maybeSingle()
  if (!devRow) return <InvalidLinkScreen locale={locale} reason="not_found" />

  const { data: projectsRaw } = await svc
    .from('dsb_projects')
    .select('id, code, name_ar, developer_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('code', { ascending: true })

  type ProjRaw = { id: string; code: string; name_ar: string; developer_id: string | null }
  const projects: DsbProjectOption[] = ((projectsRaw ?? []) as ProjRaw[])
    .filter((p) => p.developer_id === developerId || p.developer_id === null)
    .map((p) => ({ id: p.id, code: p.code, name_ar: p.name_ar }))

  const recipientName = tokenRow.recipient_name as string
  const developerName = devRow.company_name_ar as string

  return (
    <>
      {/* Brand bar */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <Link href="#" className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-slate-900 text-white font-black text-sm">
              F
            </span>
            <div className="min-w-0">
              <div className="serif text-base font-bold text-slate-900 truncate leading-tight">
                {tFn('sign.brand_label', locale)}
              </div>
              <div className="text-[10px] text-slate-500 truncate leading-tight">
                {developerName}
              </div>
            </div>
          </Link>
          <LanguageToggle />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 min-w-0">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-6 sm:p-8 border-b border-slate-100">
            <h1 className="serif font-black text-2xl sm:text-3xl tracking-tight text-slate-900">
              {tFn('dsb.public.title', locale)}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {tFn('dsb.public.subtitle', locale)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {locale === 'ar' ? 'مرحبًا ' : 'Hi '}
              <span className="font-semibold text-slate-700">{recipientName}</span>
              {locale === 'ar' ? '،' : ','}
            </p>
          </div>

          <section className="p-6 sm:p-8">
            <DeveloperDsbUploadForm
              locale={locale}
              tokenRaw={tokenRaw}
              projects={projects}
              preselectProjectId={preselectProjectId}
            />
          </section>
        </div>
      </main>
    </>
  )
}

function InvalidLinkScreen({ locale, reason }: { locale: Locale; reason: InvalidReason }) {
  const reasonKey: StringKey = (
    {
      not_found: 'dsb.public.invalid.not_found',
      expired: 'dsb.public.invalid.expired',
      used: 'dsb.public.invalid.used',
      revoked: 'dsb.public.invalid.revoked',
    } as const
  )[reason]

  return (
    <>
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <Link href="#" className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-slate-900 text-white font-black text-sm">
              F
            </span>
            <span className="serif text-base font-bold text-slate-900 truncate">
              {tFn('sign.brand_label', locale)}
            </span>
          </Link>
          <LanguageToggle />
        </div>
      </header>
      <main className="max-w-md mx-auto px-6 py-20 text-center">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
          <h1 className="serif font-black text-2xl text-slate-900 mb-2">
            {tFn('dsb.public.invalid.title', locale)}
          </h1>
          <p className="text-sm text-slate-700 mb-4">{tFn(reasonKey, locale)}</p>
        </div>
      </main>
    </>
  )
}
