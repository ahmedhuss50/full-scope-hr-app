import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { t as tFn, type Locale, type StringKey } from '@/lib/i18n/translations'
import {
  StartVoucherForm,
  type SupplierOption,
  type AccountOption,
  type SignerOption,
} from './StartVoucherForm'

export const dynamic = 'force-dynamic'

function tServer(key: StringKey, locale: Locale, vars?: Record<string, string | number>) {
  return tFn(key, locale, vars)
}

type ProjectRow = {
  id: string
  name_en: string
  name_ar: string | null
  developer_id: string
  tenant_id: string
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

/**
 * Start a new voucher — fetches the project's escrow accounts, the tenant's
 * approved suppliers, and the developer's active authorized signers, then
 * renders the StartVoucherForm. Mirrors the structure of
 * /app/app/dms/workflows/new/page.tsx.
 */
export default async function NewVoucherPage({
  params,
}: {
  params: { projectId: string }
}) {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('tenant_id, locale')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) redirect('/login')

  const tenantId = profile.tenant_id as string
  const locale = ((profile.locale as Locale) ?? 'ar')

  // Project (404 if not in this tenant or missing).
  const { data: projectRaw } = await svc
    .from('escrow_projects')
    .select('id, name_en, name_ar, developer_id, tenant_id')
    .eq('tenant_id', tenantId)
    .eq('id', params.projectId)
    .maybeSingle()
  const project = projectRaw as ProjectRow | null
  if (!project) notFound()

  // Fetch accounts, suppliers, signers in parallel.
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

  const projectName = locale === 'ar' ? (project.name_ar ?? project.name_en) : project.name_en

  return (
    <div className="space-y-6 max-w-3xl">
      <Link
        href={`/app/escrow/${project.id}`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" />
        {projectName}
      </Link>

      <header className="space-y-2">
        <h1 className="serif font-black text-2xl sm:text-3xl tracking-tight text-slate-900">
          {tServer('escrow.voucher.new.title', locale)}
        </h1>
        <p className="text-sm text-slate-500 max-w-2xl leading-relaxed">
          {tServer('escrow.voucher.new.subtitle', locale)}
        </p>
      </header>

      <StartVoucherForm
        locale={locale}
        projectId={project.id}
        suppliers={suppliers}
        accounts={accounts}
        signers={signers}
      />
    </div>
  )
}
