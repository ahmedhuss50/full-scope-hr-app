'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

// ----------------------------------------------------------------------------
// Historical cases + payments — bulk importer server actions.
//
// Both live here (rather than under units/actions.ts) because they touch a
// different pair of tables (dsb_cases as archive-only + dsb_payments ledger)
// and are pure inserts — no interaction with the case-workflow status
// transitions handled elsewhere.
//
// Owner-only. Tenant-scoped on every query — the service client bypasses
// RLS so we re-verify tenant_id manually.
// ----------------------------------------------------------------------------

interface OwnerCtx {
  tenantId: string
  userId: string
}

async function resolveOwner(): Promise<OwnerCtx | { error: string }> {
  const supabase = createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return { error: 'لم يتم تسجيل الدخول.' }

  const svc = createSupabaseService()
  const { data: profile } = await svc
    .from('users')
    .select('id, tenant_id, dsb_role')
    .eq('email', user.email)
    .maybeSingle()
  if (!profile) return { error: 'حسابك غير مرتبط بمستأجر.' }
  if ((profile.dsb_role as string | null) !== 'owner') {
    return { error: 'هذه العملية متاحة للمدير فقط.' }
  }
  return { tenantId: profile.tenant_id as string, userId: profile.id as string }
}

// ---------------------------------------------------------------------------
// Case-number generator — same "max + 1" pattern as
// /app/disbursements/new/actions.ts::nextCaseNumber. Kept private here so
// the historical importer isn't coupled to the workflow module.
// ---------------------------------------------------------------------------
async function nextCaseNumberBatch(
  tenantId: string,
  count: number,
): Promise<string[]> {
  if (count <= 0) return []
  const svc = createSupabaseService()
  // Only look at DSB-#### numbers when computing the max. Foreign
  // identifiers imported from historical Excels (e.g. "ST001", "4924") sort
  // above the DSB series and would collapse the counter, causing new
  // auto-generated numbers to collide with existing DSB rows.
  const { data } = await svc
    .from('dsb_cases')
    .select('case_number')
    .eq('tenant_id', tenantId)
    .like('case_number', 'DSB-%')
    .order('case_number', { ascending: false })
    .limit(1)
  const last = (data?.[0]?.case_number as string | undefined) ?? null
  let n = 1
  if (last) {
    const m = /(\d+)\s*$/.exec(last)
    if (m) n = parseInt(m[1], 10) + 1
  }
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    out.push(`DSB-${String(n + i).padStart(4, '0')}`)
  }
  return out
}

// ---------------------------------------------------------------------------
// bulkImportHistoricalCases — owner only
// ---------------------------------------------------------------------------
// One row per historical voucher/disbursement record. INSERTed straight into
// dsb_cases as `status = 'delivered'` + `is_historical = true` — bypasses
// the entire review workflow. Each row is stamped as if the delivering user
// were the owner running the import.
//
// If `unit_number` is provided and matches a dsb_project_units row for the
// same project, the case is linked via the new dsb_cases.unit_id column
// (migration 056). Otherwise the case still imports without a unit link.
// ---------------------------------------------------------------------------

export interface HistoricalCaseRow {
  project_id: string
  unit_number?: string | null
  case_number?: string | null
  voucher_number_text?: string | null
  voucher_date?: string | null            // YYYY-MM-DD
  amount_sar?: number | null
  disbursement_type_ar?: string | null
  beneficiary_name?: string | null
  sale_date?: string | null               // YYYY-MM-DD
  delivery_date?: string | null           // YYYY-MM-DD
  delivered_at?: string | null            // full timestamptz or YYYY-MM-DD
  recipient_name?: string | null
  recipient_phone?: string | null
  historical_source_note?: string | null

  // Extended voucher schema — see HistoricalCasesImporter.parseRow.
  account_label?: string | null          // "الحساب المسدد منه" — matched to
                                         // dsb_project_accounts.label to set
                                         // dsb_cases.paid_from_account_id, so
                                         // the escrow report deducts it.
  beneficiary_role?: string | null       // مقاول / مورد / موظف / …
  approval_date?: string | null          // تاريخ اعتماد الوثيقة (YYYY-MM-DD)
  payment_date?: string | null           // تاريخ الدفع → dsb_cases.paid_at
  delivery_status_raw?: string | null    // حالة التسليم (raw text — مسلمة/…)
  invoice_number?: string | null
  invoice_date?: string | null
  invoice_payment_type?: string | null   // كامل / جزئي
  description?: string | null            // بيان الصرف (goes into notes)
}

export interface HistoricalCaseSkip {
  row: number
  reason: string
}

export async function bulkImportHistoricalCases(input: {
  rows: HistoricalCaseRow[]
}): Promise<
  | { ok: true; inserted: number; skipped: HistoricalCaseSkip[] }
  | { ok: false; error: string }
> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }

  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return { ok: false, error: 'لا توجد صفوف للاستيراد.' }
  }

  const svc = createSupabaseService()

  // ---- Tenant-isolation: every referenced project must belong to caller ----
  const uniqueProjectIds = Array.from(
    new Set(input.rows.map((r) => (r.project_id ?? '').trim()).filter((x) => x)),
  )
  if (uniqueProjectIds.length === 0) {
    return { ok: false, error: 'كل الصفوف تفتقد المشروع.' }
  }
  const { data: projRows, error: projErr } = await svc
    .from('dsb_projects')
    .select('id, developer_id')
    .eq('tenant_id', caller.tenantId)
    .in('id', uniqueProjectIds)
  if (projErr) return { ok: false, error: projErr.message }
  const developerByProject = new Map<string, string | null>()
  for (const p of ((projRows ?? []) as Array<{ id: string; developer_id: string | null }>)) {
    developerByProject.set(p.id, p.developer_id ?? null)
  }

  // ---- Unit lookup (once, per project) ----
  type UnitLite = { id: string; project_id: string; unit_number: string }
  const unitByKey = new Map<string, UnitLite>()
  const CHUNK = 300
  for (let i = 0; i < uniqueProjectIds.length; i += CHUNK) {
    const slice = uniqueProjectIds.slice(i, i + CHUNK)
    const { data: units } = await svc
      .from('dsb_project_units')
      .select('id, project_id, unit_number')
      .eq('tenant_id', caller.tenantId)
      .in('project_id', slice)
    for (const u of (units ?? []) as UnitLite[]) {
      unitByKey.set(`${u.project_id}::${u.unit_number}`, u)
    }
  }

  // ---- Project account lookup by label — powers the escrow-account link.
  // The developer's «الحساب المسدد منه» value ("حساب الانشاءات") is text; we
  // match it (normalized) to dsb_project_accounts.label for the same
  // project. When matched, we set dsb_cases.paid_from_account_id so the
  // حساب الضمان report deducts this voucher from the right account.
  type AcctLite = { id: string; project_id: string; label: string }
  const acctByLabelByProject = new Map<string, Map<string, string>>()
  for (let i = 0; i < uniqueProjectIds.length; i += CHUNK) {
    const slice = uniqueProjectIds.slice(i, i + CHUNK)
    const { data: accts } = await svc
      .from('dsb_project_accounts')
      .select('id, project_id, label')
      .eq('tenant_id', caller.tenantId)
      .in('project_id', slice)
    for (const a of ((accts ?? []) as AcctLite[])) {
      if (!a.label) continue
      const map = acctByLabelByProject.get(a.project_id) ?? new Map<string, string>()
      // Normalized key: strip whitespace + lowercase for tolerance vs. the
      // "حساب الانشاءات " vs "حساب الانشاءات" kind of variation.
      const norm = a.label.replace(/[\sـ]+/g, '').toLowerCase()
      map.set(norm, a.id)
      acctByLabelByProject.set(a.project_id, map)
    }
  }

  // ---- Existing case_number set for this tenant (to spot dup/user-supplied) ----
  const providedNumbers = input.rows
    .map((r) => (r.case_number ?? '').trim())
    .filter((x) => !!x)
  const existingNumbers = new Set<string>()
  if (providedNumbers.length > 0) {
    for (let i = 0; i < providedNumbers.length; i += CHUNK) {
      const slice = providedNumbers.slice(i, i + CHUNK)
      const { data: found } = await svc
        .from('dsb_cases')
        .select('case_number')
        .eq('tenant_id', caller.tenantId)
        .in('case_number', slice)
      for (const c of (found ?? []) as Array<{ case_number: string }>) {
        existingNumbers.add(c.case_number)
      }
    }
  }

  // ---- Build insert set ----
  const skipped: HistoricalCaseSkip[] = []
  const toInsert: Array<Record<string, unknown>> = []
  const rowsNeedingGeneratedNumbers: number[] = [] // indices into toInsert

  input.rows.forEach((r, idx) => {
    const rowNum = idx + 1
    const projectId = (r.project_id ?? '').trim()
    if (!projectId) {
      skipped.push({ row: rowNum, reason: 'المشروع فارغ' })
      return
    }
    if (!developerByProject.has(projectId)) {
      skipped.push({ row: rowNum, reason: 'مشروع خارج مؤسستك' })
      return
    }
    const developerId = developerByProject.get(projectId) ?? null
    if (!developerId) {
      // dsb_cases.developer_id is NOT NULL — a project without a developer
      // cannot host cases at all.
      skipped.push({ row: rowNum, reason: 'المشروع بدون مطور مرتبط' })
      return
    }

    const providedCase = (r.case_number ?? '').trim() || null
    if (providedCase && existingNumbers.has(providedCase)) {
      skipped.push({ row: rowNum, reason: `رقم الطلب مكرر: ${providedCase}` })
      return
    }

    // Optional unit link — only set when a match exists for THIS project.
    let unitId: string | null = null
    const unitNum = (r.unit_number ?? '').trim()
    if (unitNum) {
      const u = unitByKey.get(`${projectId}::${unitNum}`)
      if (u) unitId = u.id
      // Silent when the unit doesn't exist — the historical case still lands.
    }

    // Normalize timestamps. `delivered_at` accepts either a full ISO string
    // or a bare date; the DB column is timestamptz so a bare date gets
    // interpreted as midnight UTC, which is fine for an archived row.
    const deliveredAtInput =
      (r.delivered_at ?? '').trim() ||
      (r.delivery_date ?? '').trim() ||
      new Date().toISOString()
    // signed_at is what the archive/register queries use to slice by time.
    // Prefer explicit delivery_date, fall back to voucher_date, then now.
    const signedAt =
      (r.delivery_date ?? '').trim() ||
      (r.voucher_date ?? '').trim() ||
      new Date().toISOString()

    // Escrow account link — this is what makes the حساب الضمان report deduct.
    let paidFromAccountId: string | null = null
    const acctLabelRaw = (r.account_label ?? '').trim()
    if (acctLabelRaw) {
      const norm = acctLabelRaw.replace(/[\sـ]+/g, '').toLowerCase()
      paidFromAccountId = acctByLabelByProject.get(projectId)?.get(norm) ?? null
      // Silent miss: the row still lands as a historical case; only the
      // escrow-account deduction is skipped. Owner can attach manually
      // from the case page later.
    }

    // Compose the notes field from بيان الصرف + role/context, so operators
    // can read voucher context on the case page without opening the JSONB.
    const notesBits: string[] = []
    if (r.description) notesBits.push(r.description)
    if (r.beneficiary_role) notesBits.push(`صفة المستفيد: ${r.beneficiary_role}`)
    if (r.invoice_payment_type) notesBits.push(`السداد: ${r.invoice_payment_type}`)

    const insertRow: Record<string, unknown> = {
      tenant_id: caller.tenantId,
      project_id: projectId,
      developer_id: developerId,
      // case_number filled below (either provided or generated).
      case_number: providedCase,
      voucher_number_text: (r.voucher_number_text ?? '').trim() || null,
      voucher_date: (r.voucher_date ?? '').trim() || null,
      amount_sar: r.amount_sar ?? null,
      status: 'delivered',
      is_historical: true,
      historical_source_note: (r.historical_source_note ?? '').trim() || null,
      unit_id: unitId,
      signed_at: signedAt,
      signed_by_user_id: caller.userId,
      delivered_at: deliveredAtInput,
      delivered_by_user_id: caller.userId,
      recipient_name: (r.recipient_name ?? '').trim() || null,
      recipient_phone: (r.recipient_phone ?? '').trim() || null,
      // Extended voucher fields — real dsb_cases columns.
      paid_from_account_id: paidFromAccountId,
      paid_at: (r.payment_date ?? '').trim() || null,
      notes: notesBits.length > 0 ? notesBits.join(' · ') : null,
    }

    // Everything else lands in extracted_fields JSONB so it surfaces on the
    // case page's AI-extracted panel without adding more columns.
    const extracted: Record<string, unknown> = {}
    if (r.disbursement_type_ar) extracted.disbursement_type_ar = r.disbursement_type_ar
    if (r.beneficiary_name) extracted.beneficiary_name_ar = r.beneficiary_name
    if (r.beneficiary_role) extracted.beneficiary_role = r.beneficiary_role
    if (r.sale_date) extracted.sale_date = r.sale_date
    if (r.approval_date) extracted.approval_date = r.approval_date
    if (r.delivery_status_raw) extracted.delivery_status_ar = r.delivery_status_raw
    if (r.invoice_number) extracted.invoice_number = r.invoice_number
    if (r.invoice_date) extracted.invoice_date = r.invoice_date
    if (r.invoice_payment_type) extracted.invoice_payment_type = r.invoice_payment_type
    if (acctLabelRaw) extracted.paid_from_account_label = acctLabelRaw
    if (Object.keys(extracted).length > 0) {
      insertRow.extracted_fields = extracted
    }

    toInsert.push(insertRow)
    if (!providedCase) rowsNeedingGeneratedNumbers.push(toInsert.length - 1)
  })

  // ---- Fill in generated case numbers ----
  if (rowsNeedingGeneratedNumbers.length > 0) {
    const generated = await nextCaseNumberBatch(
      caller.tenantId,
      rowsNeedingGeneratedNumbers.length,
    )
    rowsNeedingGeneratedNumbers.forEach((rowIdx, i) => {
      toInsert[rowIdx].case_number = generated[i]
    })
  }

  if (toInsert.length === 0) {
    return { ok: true, inserted: 0, skipped }
  }

  const { error: insErr } = await svc.from('dsb_cases').insert(toInsert)
  if (insErr) return { ok: false, error: insErr.message }

  revalidatePath('/app/disbursements/archive')
  revalidatePath('/app/disbursements/admin')

  return { ok: true, inserted: toInsert.length, skipped }
}

// ---------------------------------------------------------------------------
// bulkImportPayments — owner only
// ---------------------------------------------------------------------------
// Pure INSERT into the standalone dsb_payments ledger. Every FK is optional;
// the importer tries to link project / account / case / unit via string
// lookups (account_number → account_id, case_number → case_id,
// unit_number + project → unit_id) but a row still lands even if a lookup
// misses.
// ---------------------------------------------------------------------------

export interface PaymentRow {
  project_id?: string | null

  // Optional link strings — resolved server-side to ids.
  account_number?: string | null
  account_label?: string | null
  case_number?: string | null
  unit_number?: string | null

  payment_date: string             // YYYY-MM-DD (required)
  amount_sar: number               // required, > 0
  vat_sar?: number | null
  currency?: string | null

  beneficiary_name?: string | null
  description?: string | null
  reference_number?: string | null
  payment_method?: string | null
  notes?: string | null
}

export interface PaymentUnmatched {
  row: number
  field: 'project' | 'account' | 'case' | 'unit'
  value: string
}

export async function bulkImportPayments(input: {
  rows: PaymentRow[]
}): Promise<
  | { ok: true; inserted: number; skipped: HistoricalCaseSkip[]; unmatched: PaymentUnmatched[] }
  | { ok: false; error: string }
> {
  const caller = await resolveOwner()
  if ('error' in caller) return { ok: false, error: caller.error }

  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return { ok: false, error: 'لا توجد صفوف للاستيراد.' }
  }

  const svc = createSupabaseService()

  // ---- Project scoping ----
  const projectIds = Array.from(
    new Set(input.rows.map((r) => (r.project_id ?? '').trim()).filter((x) => !!x)),
  )
  const validProjectIds = new Set<string>()
  if (projectIds.length > 0) {
    const { data: projRows, error: projErr } = await svc
      .from('dsb_projects')
      .select('id')
      .eq('tenant_id', caller.tenantId)
      .in('id', projectIds)
    if (projErr) return { ok: false, error: projErr.message }
    for (const p of (projRows ?? []) as Array<{ id: string }>) {
      validProjectIds.add(p.id)
    }
  }

  // ---- Account lookup — build maps for both account_number and label ----
  type AcctLite = { id: string; project_id: string; label: string; account_number: string | null }
  const { data: acctRows } = await svc
    .from('dsb_project_accounts')
    .select('id, project_id, label, account_number')
    .eq('tenant_id', caller.tenantId)
  const acctByNumberByProject = new Map<string, Map<string, string>>()
  const acctByLabelByProject = new Map<string, Map<string, string>>()
  for (const a of ((acctRows ?? []) as AcctLite[])) {
    if (a.account_number) {
      const m = acctByNumberByProject.get(a.project_id) ?? new Map()
      m.set(a.account_number.trim(), a.id)
      acctByNumberByProject.set(a.project_id, m)
    }
    if (a.label) {
      const m = acctByLabelByProject.get(a.project_id) ?? new Map()
      m.set(a.label.trim(), a.id)
      acctByLabelByProject.set(a.project_id, m)
    }
  }

  // ---- Case lookup (by case_number, tenant-scoped) ----
  const providedCaseNumbers = Array.from(
    new Set(input.rows.map((r) => (r.case_number ?? '').trim()).filter((x) => !!x)),
  )
  const caseIdByNumber = new Map<string, string>()
  if (providedCaseNumbers.length > 0) {
    const CHUNK = 300
    for (let i = 0; i < providedCaseNumbers.length; i += CHUNK) {
      const slice = providedCaseNumbers.slice(i, i + CHUNK)
      const { data: cases } = await svc
        .from('dsb_cases')
        .select('id, case_number')
        .eq('tenant_id', caller.tenantId)
        .in('case_number', slice)
      for (const c of ((cases ?? []) as Array<{ id: string; case_number: string }>)) {
        caseIdByNumber.set(c.case_number, c.id)
      }
    }
  }

  // ---- Unit lookup (by project_id + unit_number) ----
  type UnitLite = { id: string; project_id: string; unit_number: string }
  const unitByKey = new Map<string, UnitLite>()
  if (projectIds.length > 0) {
    const CHUNK = 300
    for (let i = 0; i < projectIds.length; i += CHUNK) {
      const slice = projectIds.slice(i, i + CHUNK)
      const { data: units } = await svc
        .from('dsb_project_units')
        .select('id, project_id, unit_number')
        .eq('tenant_id', caller.tenantId)
        .in('project_id', slice)
      for (const u of ((units ?? []) as UnitLite[])) {
        unitByKey.set(`${u.project_id}::${u.unit_number}`, u)
      }
    }
  }

  // ---- Build insert set ----
  const skipped: HistoricalCaseSkip[] = []
  const unmatched: PaymentUnmatched[] = []
  const toInsert: Array<Record<string, unknown>> = []

  input.rows.forEach((r, idx) => {
    const rowNum = idx + 1
    const paymentDate = (r.payment_date ?? '').trim()
    if (!paymentDate) {
      skipped.push({ row: rowNum, reason: 'تاريخ الدفع فارغ' })
      return
    }
    const amount = typeof r.amount_sar === 'number' ? r.amount_sar : Number(r.amount_sar)
    if (!Number.isFinite(amount) || amount <= 0) {
      skipped.push({ row: rowNum, reason: 'المبلغ غير صالح (يجب > 0)' })
      return
    }

    let projectId: string | null = null
    const rawProject = (r.project_id ?? '').trim()
    if (rawProject) {
      if (validProjectIds.has(rawProject)) {
        projectId = rawProject
      } else {
        unmatched.push({ row: rowNum, field: 'project', value: rawProject })
        // Row still lands — orphan payments are allowed.
      }
    }

    // Account link — try number, then label. Only meaningful when project
    // is known (accounts belong to a specific project).
    let accountId: string | null = null
    const acctNum = (r.account_number ?? '').trim()
    const acctLabel = (r.account_label ?? '').trim()
    if (projectId && (acctNum || acctLabel)) {
      const byNum = acctByNumberByProject.get(projectId)
      const byLabel = acctByLabelByProject.get(projectId)
      if (acctNum && byNum?.get(acctNum)) {
        accountId = byNum.get(acctNum)!
      } else if (acctLabel && byLabel?.get(acctLabel)) {
        accountId = byLabel.get(acctLabel)!
      }
      if (!accountId) {
        unmatched.push({
          row: rowNum,
          field: 'account',
          value: acctNum || acctLabel,
        })
      }
    }

    // Case link — global (by tenant + case_number).
    let caseId: string | null = null
    const caseNum = (r.case_number ?? '').trim()
    if (caseNum) {
      caseId = caseIdByNumber.get(caseNum) ?? null
      if (!caseId) unmatched.push({ row: rowNum, field: 'case', value: caseNum })
    }

    // Unit link — scoped by project.
    let unitId: string | null = null
    const unitNum = (r.unit_number ?? '').trim()
    if (projectId && unitNum) {
      const u = unitByKey.get(`${projectId}::${unitNum}`)
      unitId = u?.id ?? null
      if (!unitId) unmatched.push({ row: rowNum, field: 'unit', value: unitNum })
    }

    toInsert.push({
      tenant_id: caller.tenantId,
      project_id: projectId,
      account_id: accountId,
      case_id: caseId,
      unit_id: unitId,
      payment_date: paymentDate,
      amount_sar: amount,
      vat_sar: r.vat_sar ?? null,
      currency: (r.currency ?? '').trim() || 'SAR',
      beneficiary_name: (r.beneficiary_name ?? '').trim() || null,
      description: (r.description ?? '').trim() || null,
      reference_number: (r.reference_number ?? '').trim() || null,
      payment_method: (r.payment_method ?? '').trim() || null,
      notes: (r.notes ?? '').trim() || null,
      imported_from: 'ledger_import',
      created_by_user_id: caller.userId,
    })
  })

  if (toInsert.length === 0) {
    return { ok: true, inserted: 0, skipped, unmatched }
  }

  const { error: insErr } = await svc.from('dsb_payments').insert(toInsert)
  if (insErr) return { ok: false, error: insErr.message }

  revalidatePath('/app/disbursements/admin/lists/payments')

  return { ok: true, inserted: toInsert.length, skipped, unmatched }
}
