'use server'

/**
 * Tenant settings — owner-only server actions.
 *
 * Persists the tenant-level fields that drive the REGA delivery-notice
 * generator (accountant office identity + default recipient emails).
 * Adding a new field here means: (a) add a column in a migration, (b) add
 * the field to `TenantSettingsInput` below, (c) surface an input in
 * `TenantSettingsForm.tsx`.
 */
import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export interface TenantSettingsInput {
  accountant_office_name:        string | null
  accountant_office_license:     string | null
  accountant_signer_name:        string | null
  accountant_signer_title:       string | null
  accountant_signer_email:       string | null
  // Multiple recipient emails. Stored as text[] on tenants. UI sends them
  // as a newline / comma-separated string; we parse here.
  rega_default_recipients_raw:   string | null
}

function parseEmailList(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(/[\n,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes('@'))
}

export async function updateTenantSettings(
  input: TenantSettingsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, error: 'لم يتم تسجيل الدخول.' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) return { ok: false, error: 'حسابك غير مرتبط بمستأجر.' }
  if ((profile.dsb_role as string | null) !== 'owner') {
    return { ok: false, error: 'هذا الإجراء متاح للمدير فقط.' }
  }

  const tenantId = profile.tenant_id as string
  const recipients = parseEmailList(input.rega_default_recipients_raw)

  const { error } = await svc
    .from('tenants')
    .update({
      accountant_office_name:        (input.accountant_office_name    ?? '').trim() || null,
      accountant_office_license:     (input.accountant_office_license ?? '').trim() || null,
      accountant_signer_name:        (input.accountant_signer_name    ?? '').trim() || null,
      accountant_signer_title:       (input.accountant_signer_title   ?? '').trim() || null,
      accountant_signer_email:       (input.accountant_signer_email   ?? '').trim() || null,
      rega_default_recipient_emails: recipients.length > 0 ? recipients : null,
    })
    .eq('id', tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/app/disbursements/admin/settings')
  return { ok: true }
}
