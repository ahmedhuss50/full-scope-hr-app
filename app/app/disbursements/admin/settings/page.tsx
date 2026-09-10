/**
 * تهيئة النظام — Tenant Settings page (owner-only).
 *
 * First-wave admin panel. Currently exposes just the fields that unlock
 * the REGA delivery-notice generator (accountant office identity +
 * default recipients). Later slices add more panels here (lists &
 * percentages, disbursement types, company logo, sender-email settings).
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Sliders } from 'lucide-react'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { TenantSettingsForm, type TenantSettings } from './TenantSettingsForm'

export const dynamic = 'force-dynamic'

export default async function TenantSettingsPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile) redirect('/login')
  if ((profile.dsb_role as string | null) !== 'owner') {
    redirect('/app/disbursements/admin')
  }

  const tenantId = profile.tenant_id as string
  const { data: tenantRow } = await svc
    .from('tenants')
    .select('id, name, accountant_office_name, accountant_office_license, accountant_signer_name, accountant_signer_title, accountant_signer_email, accountant_signer_phone, rega_default_recipient_emails')
    .eq('id', tenantId)
    .maybeSingle()

  const settings: TenantSettings = {
    accountant_office_name:        (tenantRow?.accountant_office_name    as string | null) ?? null,
    accountant_office_license:     (tenantRow?.accountant_office_license as string | null) ?? null,
    accountant_signer_name:        (tenantRow?.accountant_signer_name    as string | null) ?? null,
    accountant_signer_title:       (tenantRow?.accountant_signer_title   as string | null) ?? null,
    accountant_signer_email:       (tenantRow?.accountant_signer_email   as string | null) ?? null,
    accountant_signer_phone:       (tenantRow?.accountant_signer_phone   as string | null) ?? null,
    rega_default_recipient_emails: (tenantRow?.rega_default_recipient_emails as string[] | null) ?? null,
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto" dir="rtl">
      <Link
        href="/app/disbursements/admin"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        العودة إلى الإدارة
      </Link>

      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
          <Sliders className="w-4 h-4" aria-hidden="true" />
          الإدارة
        </div>
        <h1 className="serif font-black text-3xl tracking-tight text-slate-900">
          تهيئة النظام
        </h1>
        <p className="text-sm text-slate-600">
          الإعدادات على مستوى المكتب — تُستخدم لتوليد التقارير الربعية والوثائق الرسمية.
        </p>
      </header>

      <TenantSettingsForm initial={settings} />
    </div>
  )
}
