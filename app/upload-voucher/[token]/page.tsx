import Link from 'next/link'
import { headers } from 'next/headers'
import crypto from 'crypto'
import { createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import { LanguageToggle } from '@/components/LanguageToggle'
import {
  DeveloperUploadForm,
  type SupplierOption,
  type AccountOption,
  type SignerOption,
} from './DeveloperUploadForm'

export const dynamic = 'force-dynamic'

function pickLocaleFromAcceptLanguage(header: string | null): Locale {
  if (!header) return 'ar'
  // crude parse: take the first locale tag, check for "ar" first since the
  // page defaults Arabic for KSA developers.
  const tags = header.toLowerCase().split(',').map((t) => t.split(';')[0].trim())
  for (const tag of tags) {
    if (tag.startsWith('ar')) return 'ar'
    if (tag.startsWith('en')) return 'en'
  }
  return 'ar'
}

function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

type InvalidReason = 'not_found' | 'expired' | 'used' | 'revoked'

type ProjectRow = {
  id: string
  name_en: string
  name_ar: string | null
  developer_id: string
  tenant_id: string
  developer:
    | { id: string; name_en: string; name_ar: string | null }
    | { id: string; name_en: string; name_ar: string | null }[]
    | null
}

type AccountRow = {
  id: string
  account_type: 'construction' | 'non_construction' | 'preservation'
  bank_name: string | null
  iban: string | null
}

type SupplierRow = {
  id: string
  name_en: string
  name_ar: string | null
}

type SignerRow = {
  id: string
  name: string
  title: string | null
}

export default async function UploadVoucherPage({
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
    .from('escrow_voucher_upload_tokens')
    .select('id, tenant_id, project_id, recipient_name, recipient_email, expires_at, used_at, revoked_at')
    .eq('token_hash', hash)
    .maybeSingle()

  if (!tokenRow) {
    return <InvalidLinkScreen locale={locale} reason="not_found" />
  }
  if (tokenRow.revoked_at) {
    return <InvalidLinkScreen locale={locale} reason="revoked" />
  }
  if (tokenRow.used_at) {
    return <InvalidLinkScreen locale={locale} reason="used" />
  }
  if (new Date(tokenRow.expires_at as string).getTime() < Date.now()) {
    return <InvalidLinkScreen locale={locale} reason="expired" />
  }

  // 2) Load project + developer + master data (same shape as the internal
  //    new-voucher page).
  const tenantId = tokenRow.tenant_id as string
  const projectId = tokenRow.project_id as string

  const { data: projectRaw } = await svc
    .from('escrow_projects')
    .select(`id, name_en, name_ar, developer_id, tenant_id,
             developer:escrow_developers!escrow_projects_developer_id_fkey(id, name_en, name_ar)`)
    .eq('tenant_id', tenantId)
    .eq('id', projectId)
    .maybeSingle()
  const project = projectRaw as ProjectRow | null
  if (!project) return <InvalidLinkScreen locale={locale} reason="not_found" />

  const [accountsRes, suppliersRes, signersRes] = await Promise.all([
    svc
      .from('escrow_accounts')
      .select('id, account_type, bank_name, iban')
      .eq('tenant_id', tenantId)
      .eq('project_id', project.id)
      .order('account_type', { ascending: true }),
    svc
      .from('escrow_suppliers')
      .select('id, name_en, name_ar')
      .eq('tenant_id', tenantId)
      .eq('status', 'approved')
      .order('name_en', { ascending: true }),
    svc
      .from('escrow_authorized_signers')
      .select('id, name, title')
      .eq('tenant_id', tenantId)
      .eq('developer_id', project.developer_id)
      .eq('status', 'active')
      .order('name', { ascending: true }),
  ])

  const accounts: AccountOption[] = ((accountsRes.data ?? []) as AccountRow[]).map((a) => ({
    id: a.id,
    account_type: a.account_type,
    bank_name: a.bank_name,
    iban: a.iban,
  }))

  const suppliers: SupplierOption[] = ((suppliersRes.data ?? []) as SupplierRow[]).map((s) => ({
    id: s.id,
    name_en: s.name_en,
    name_ar: s.name_ar,
  }))

  const signers: SignerOption[] = ((signersRes.data ?? []) as SignerRow[]).map((s) => ({
    id: s.id,
    name: s.name,
    title: s.title,
  }))

  const dev = pickOne(project.developer)
  const projectName = locale === 'ar' ? (project.name_ar ?? project.name_en) : project.name_en
  const devName = locale === 'ar' ? (dev?.name_ar ?? dev?.name_en ?? '') : (dev?.name_en ?? '')
  const recipientName = tokenRow.recipient_name as string

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
                {tFn('escrow.public.brand_subtitle', locale, { project: projectName, developer: devName })}
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
              {tFn('escrow.public.form.title', locale)}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {tFn('escrow.public.form.subtitle', locale, { name: recipientName, project: projectName })}
            </p>
          </div>

          <section className="p-6 sm:p-8">
            <DeveloperUploadForm
              locale={locale}
              tokenRaw={tokenRaw}
              suppliers={suppliers}
              accounts={accounts}
              signers={signers}
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
      not_found: 'escrow.public.invalid.not_found',
      expired: 'escrow.public.invalid.expired',
      used: 'escrow.public.invalid.used',
      revoked: 'escrow.public.invalid.revoked',
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
            {tFn('escrow.public.invalid.title', locale)}
          </h1>
          <p className="text-sm text-slate-700 mb-4">{tFn(reasonKey, locale)}</p>
          <p className="text-xs text-slate-500">{tFn('escrow.public.invalid.body', locale)}</p>
        </div>
      </main>
    </>
  )
}
