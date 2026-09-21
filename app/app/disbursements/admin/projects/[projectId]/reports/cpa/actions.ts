'use server'

/**
 * CPA quarterly report — server actions.
 * Owner-only writes.
 */
import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

export interface ForecastRow {
  seq: number
  label_ar: string
  side: 'debit' | 'credit'
  amount_sar: number
}

export interface CpaReportInput {
  project_id: string
  period_year: number
  period_quarter: number
  preparer_name?: string | null
  preparer_phone?: string | null
  preparer_email?: string | null
  opening_balance_sar?: number | null
  forecast_rows?: ForecastRow[] | null
  notes_sales?: string | null
  notes_expenses?: string | null
  notes_collection?: string | null
  notes_current_risks?: string | null
  notes_future_risks?: string | null
  notes_other?: string | null
}

async function ownerGuard(): Promise<
  | { tenantId: string; userId: string }
  | { error: string }
> {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: 'لم يتم تسجيل الدخول.' }
  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users').select('id, tenant_id, dsb_role').eq('email', user.email).maybeSingle()
  if (!profile) return { error: 'حسابك غير مرتبط بمستأجر.' }
  if ((profile.dsb_role as string | null) !== 'owner') {
    return { error: 'هذا الإجراء متاح للمدير فقط.' }
  }
  return { tenantId: profile.tenant_id as string, userId: profile.id as string }
}

function cleanForecast(rows: ForecastRow[] | null | undefined): ForecastRow[] {
  const out: ForecastRow[] = []
  for (const r of Array.isArray(rows) ? rows : []) {
    const seq  = Number(r.seq)
    const amt  = Number(r.amount_sar)
    const lb   = String(r.label_ar ?? '').trim()
    const side = r.side === 'credit' ? 'credit' : 'debit'
    if (!Number.isFinite(seq) || seq < 1) continue
    if (!lb) continue
    if (!Number.isFinite(amt) || amt < 0) continue
    out.push({ seq, label_ar: lb, side, amount_sar: amt })
  }
  out.sort((a, b) => a.seq - b.seq)
  return out
}

/** Upsert a CPA report row (identified by project + year + quarter). */
export async function upsertCpaReport(
  input: CpaReportInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const guard = await ownerGuard()
  if ('error' in guard) return { ok: false, error: guard.error }
  const svc = createSupabaseService()

  const year    = Math.trunc(Number(input.period_year))
  const quarter = Math.trunc(Number(input.period_quarter))
  if (!Number.isFinite(year) || year < 2020 || year > 2100) return { ok: false, error: 'السنة غير صالحة.' }
  if (![1, 2, 3, 4].includes(quarter)) return { ok: false, error: 'الربع غير صالح.' }
  if (!input.project_id) return { ok: false, error: 'المشروع مطلوب.' }

  // Verify project ownership
  const { data: proj } = await svc
    .from('dsb_projects').select('id, tenant_id').eq('id', input.project_id).maybeSingle()
  if (!proj || (proj as { tenant_id: string }).tenant_id !== guard.tenantId) {
    return { ok: false, error: 'المشروع غير موجود.' }
  }

  const row = {
    tenant_id: guard.tenantId,
    project_id: input.project_id,
    period_year: year,
    period_quarter: quarter,
    preparer_name:  input.preparer_name?.trim() || null,
    preparer_phone: input.preparer_phone?.trim() || null,
    preparer_email: input.preparer_email?.trim() || null,
    opening_balance_sar: Number(input.opening_balance_sar ?? 0) || 0,
    forecast_rows: cleanForecast(input.forecast_rows ?? []),
    notes_sales:         input.notes_sales?.trim() || null,
    notes_expenses:      input.notes_expenses?.trim() || null,
    notes_collection:    input.notes_collection?.trim() || null,
    notes_current_risks: input.notes_current_risks?.trim() || null,
    notes_future_risks:  input.notes_future_risks?.trim() || null,
    notes_other:         input.notes_other?.trim() || null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await svc
    .from('dsb_cpa_reports')
    .upsert(row, { onConflict: 'tenant_id,project_id,period_year,period_quarter' })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/app/disbursements/admin/projects/${input.project_id}/reports/cpa`)
  return { ok: true, id: (data as { id: string }).id }
}
