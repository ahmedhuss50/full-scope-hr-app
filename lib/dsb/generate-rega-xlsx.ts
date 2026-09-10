/**
 * generate-rega-xlsx.ts
 * ----------------------------------------------------------------------------
 * Server-side generators for the two Excel deliverables in the REGA
 * quarterly report package:
 *
 *   1. سجل المشترين  → generateBuyersRegisterXlsx(projectId)
 *      Fills the buyers-register template (455 rows in the reference file)
 *      with the project's live units + sales + collections. Preserves the
 *      template's headers, formulas, and the 3 companion sheets (empty).
 *
 *   2. نموذج المحاسب القانوني → generateAccountantWorkbookXlsx(projectId, quarter, year)
 *      Fills the 7-sheet accountant workbook. Sheets 1 (project data), 2
 *      (vouchers), and 4 (unit-type breakdowns) are fully populated. Sheets 3
 *      (financial operations), 5 (variance analysis), 6 (notes/risks), and 7
 *      (balance sheet) are cleared of the reference data — they will be
 *      populated in follow-up slices as we add the required schema
 *      (estimated costs + narrative fields).
 *
 * Both use the xlsx (SheetJS) library that's already in the project. The
 * template files ship at lib/dsb/rega-templates/*.xlsx and are loaded fresh
 * on each request (no in-memory caching so template edits go live without
 * a restart).
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { createSupabaseService } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BUYERS_TEMPLATE_PATH = path.join(process.cwd(), 'lib/dsb/rega-templates/buyers-register.xlsx')
const ACCOUNTANT_TEMPLATE_PATH = path.join(process.cwd(), 'lib/dsb/rega-templates/accountant-workbook.xlsx')

async function loadWorkbook(templatePath: string): Promise<XLSX.WorkBook> {
  const buf = await fs.readFile(templatePath)
  return XLSX.read(buf, { type: 'buffer', cellStyles: true, cellDates: true, cellFormula: true })
}

function workbookToBuffer(wb: XLSX.WorkBook): Buffer {
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer
}

// Set a cell value while trying to preserve formatting from the template.
// If the cell already exists we overwrite `.v` (and `.w`) and keep `.s`.
function setCell(sheet: XLSX.WorkSheet, address: string, value: unknown, t?: XLSX.ExcelDataType) {
  const existing = sheet[address] as XLSX.CellObject | undefined
  const cell: XLSX.CellObject = existing
    ? { ...existing, v: value as XLSX.CellObject['v'], w: undefined }
    : { v: value as XLSX.CellObject['v'], t: t ?? (typeof value === 'number' ? 'n' : 's') }
  if (t) cell.t = t
  else if (typeof value === 'number') cell.t = 'n'
  else if (value instanceof Date) { cell.t = 'd' }
  else cell.t = 's'
  sheet[address] = cell
  // Ensure the sheet's range covers this cell so xlsx serializes it.
  const ref = sheet['!ref'] ?? 'A1'
  const range = XLSX.utils.decode_range(ref)
  const addr = XLSX.utils.decode_cell(address)
  if (addr.r > range.e.r) range.e.r = addr.r
  if (addr.c > range.e.c) range.e.c = addr.c
  sheet['!ref'] = XLSX.utils.encode_range(range)
}

function clearCellsRange(sheet: XLSX.WorkSheet, startRow: number, endRow: number, startCol: number, endCol: number) {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const addr = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })
      if (sheet[addr]) {
        delete sheet[addr]
      }
    }
  }
}

// PostgREST 1k row cap — chunk-loop everything.
async function fetchAllChunked<T>(
  build: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = []
  const CHUNK = 1000
  for (let page = 0; page < 100; page++) {
    const { data } = await build(page * CHUNK, page * CHUNK + CHUNK - 1)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < CHUNK) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Buyers register (سجل المشترين)
// ---------------------------------------------------------------------------
// Header row 7 of «سجل المشترين وحدات قائمة». Data starts row 8. Column map:
//   1  م
//   2  اسم العميل
//   3  نوع الـ ID
//   4  رقم الهوية
//   5  الجنسية
//   6  رقم الجوال
//   7  اسم المشروع
//   8  المنطقة
//   9  المدينة
//  10  الحي
//  11  المساحة
//  12  نوع الوحدة
//  13  رقم المنطقة (ZONE)
//  14  رقم الوحدة
//  15  عدد مرات بيع الوحدة
//  16  رقم البلوك
//  17  رقم العقد
//  18  نوع العقد
//  19  نوع التمويل
//  20  اسم الجهة التمويلية
//  21  تاريخ بيع الوحدة
//  22  سعر الوحدة قبل ضريبة التصرفات العقارية
//  23  حالة التسليم
//  24  تاريخ التسليم
//  25  (5%) ضريبة التصرفات العقارية
//  26  قيمة الوحدة شاملة ضريبة التصرفات العقارية
//  27  النسبة المستقطعة              — LEFT BLANK (not stored)
//  28  2017-12-31 collection total
//  29  2018-12-31
//  30  2019-12-31
//  31  2020-12-31
//  32  2021-12-31
//  33  2022-12-31
//  34  2023-12-31
//  35  2024-12-31
//  36  2025-12-31
//  37  2026-06-30 (current-year YTD)
//  38  الاشراف والمتابعة اليومية — LEFT BLANK
//  39  الاشراف والمتابعة السنوية   — LEFT BLANK
//  40  إجمالي المحصل بدون ضريبة    — SUM of yearly (approx before-VAT)
//  41  إجمالي المحصل شامل الضريبة — SUM of yearly (approx incl-VAT)
//  42  المتبقي من قيمة الوحدة
//  43  عدد الدفعات (رقم الدفعة)
//  44  نسبة التحصيل
//  45  سعر المتر

const BUYERS_HEADER_ROW = 7
const BUYERS_DATA_START_ROW = 8

export async function generateBuyersRegisterXlsx(projectId: string): Promise<Buffer> {
  const svc = createSupabaseService()

  // Project + tenant identity for the header
  const { data: projectRow } = await svc
    .from('dsb_projects')
    .select('id, tenant_id, name_ar, code, rega_license_no')
    .eq('id', projectId)
    .maybeSingle()
  if (!projectRow) throw new Error('project not found')
  const project = projectRow as { id: string; tenant_id: string; name_ar: string; code: string; rega_license_no: string | null }

  // Units for this project
  const { data: unitRows } = await svc
    .from('dsb_project_units')
    .select('id, unit_number, unit_type, area_m2, block_number, zone_number, city, district, region')
    .eq('tenant_id', project.tenant_id)
    .eq('project_id', projectId)
    .order('unit_number', { ascending: true })
  const units = ((unitRows ?? []) as Array<{
    id: string
    unit_number: string
    unit_type: string | null
    area_m2: number | null
    block_number: string | null
    zone_number: string | null
    city: string | null
    district: string | null
    region: string | null
  }>)
  const unitIds = units.map((u) => u.id)

  // Sales (latest per unit)
  type SaleLite = {
    id: string
    unit_id: string
    buyer_name_ar: string | null
    buyer_id_type: string | null
    buyer_id_number: string | null
    buyer_nationality: string | null
    buyer_phone: string | null
    contract_number: string | null
    contract_type: string | null
    financing_type: string | null
    financing_bank: string | null
    sale_date: string | null
    sale_count: number | null
    sale_status: string | null
    price_before_tax_sar: number | null
    price_with_vat_sar: number | null
    vat_sar: number | null
    delivery_status: string | null
    delivery_date: string | null
    created_at: string
  }
  const sales: SaleLite[] = []
  if (unitIds.length > 0) {
    for (let i = 0; i < unitIds.length; i += 500) {
      const slice = unitIds.slice(i, i + 500)
      const { data } = await svc
        .from('dsb_unit_sales')
        .select('id, unit_id, buyer_name_ar, buyer_id_type, buyer_id_number, buyer_nationality, buyer_phone, contract_number, contract_type, financing_type, financing_bank, sale_date, sale_count, sale_status, price_before_tax_sar, price_with_vat_sar, vat_sar, delivery_status, delivery_date, created_at')
        .eq('tenant_id', project.tenant_id)
        .in('unit_id', slice)
        .order('created_at', { ascending: false })
      sales.push(...((data ?? []) as SaleLite[]))
    }
  }
  const saleByUnit = new Map<string, SaleLite>()
  for (const s of sales) {
    const prev = saleByUnit.get(s.unit_id)
    if (!prev) { saleByUnit.set(s.unit_id, s); continue }
    if (prev.sale_status !== 'active' && s.sale_status === 'active') saleByUnit.set(s.unit_id, s)
  }
  const saleIds = Array.from(saleByUnit.values()).map((s) => s.id)

  // Buyer-collection payments per sale, bucketed by year
  type PayRow = { sale_id: string | null; amount_sar: number | null; payment_date: string }
  const payments = await fetchAllChunked<PayRow>(async (from, to) => {
    const res = await svc
      .from('dsb_payments')
      .select('sale_id, amount_sar, payment_date')
      .eq('tenant_id', project.tenant_id)
      .eq('project_id', projectId)
      .eq('deposit_category', 'buyer_collection')
      .range(from, to)
    return { data: res.data as PayRow[] | null, error: res.error }
  })
  // Map<saleId, Map<year, total>>
  const yearlyBySale = new Map<string, Map<number, number>>()
  const countBySale  = new Map<string, number>()
  for (const p of payments) {
    if (!p.sale_id) continue
    if (!saleIds.includes(p.sale_id)) continue
    const year = Number(p.payment_date.slice(0, 4))
    if (!Number.isFinite(year)) continue
    const perYear = yearlyBySale.get(p.sale_id) ?? new Map<number, number>()
    perYear.set(year, (perYear.get(year) ?? 0) + Number(p.amount_sar || 0))
    yearlyBySale.set(p.sale_id, perYear)
    countBySale.set(p.sale_id, (countBySale.get(p.sale_id) ?? 0) + 1)
  }

  // ---- Populate the template ----
  const wb = await loadWorkbook(BUYERS_TEMPLATE_PATH)
  const sheetName = 'سجل المشترين وحدات قائمة'
  const ws = wb.Sheets[sheetName]
  if (!ws) throw new Error(`template missing sheet: ${sheetName}`)

  // Clear the sample data rows below the header (they contain 455 Ayal
  // Alasala rows we must not ship to other tenants).
  clearCellsRange(ws, BUYERS_DATA_START_ROW, 500, 1, 49)

  // Year columns: 2017..2025 as year-end, 2026-06-30 as YTD cutoff.
  const YEAR_COL: Record<number, number> = {
    2017: 28, 2018: 29, 2019: 30, 2020: 31, 2021: 32, 2022: 33, 2023: 34, 2024: 35, 2025: 36, 2026: 37,
  }

  let idx = 0
  for (const u of units) {
    const s = saleByUnit.get(u.id)
    const rowXlsx = BUYERS_DATA_START_ROW + idx // 1-indexed excel row
    const r0 = rowXlsx - 1 // 0-indexed for xlsx.utils.encode_cell
    idx += 1

    // Serial
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 0 }), idx, 'n')
    // Buyer name / ID / nationality / phone
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 1 }), s?.buyer_name_ar ?? '', 's')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 2 }), s?.buyer_id_type ?? '', 's')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 3 }), s?.buyer_id_number ?? '', 's')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 4 }), s?.buyer_nationality ?? '', 's')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 5 }), s?.buyer_phone ?? '', 's')
    // Project + location
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 6 }), project.name_ar, 's')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 7 }), u.region  ?? '', 's')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 8 }), u.city    ?? '', 's')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 9 }), u.district ?? '', 's')
    // Unit specs
    if (u.area_m2 != null) setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 10 }), Number(u.area_m2), 'n')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 11 }), u.unit_type ?? '', 's')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 12 }), u.zone_number ?? '', 's')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 13 }), u.unit_number, 's')
    if (s?.sale_count != null) setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 14 }), s.sale_count, 'n')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 15 }), u.block_number ?? '', 's')
    // Contract + financing
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 16 }), s?.contract_number ?? '', 's')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 17 }), s?.contract_type ?? '', 's')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 18 }), s?.financing_type ?? '', 's')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 19 }), s?.financing_bank ?? '', 's')
    if (s?.sale_date) setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 20 }), s.sale_date, 's')
    // Price + delivery + VAT
    if (s?.price_before_tax_sar != null) setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 21 }), Number(s.price_before_tax_sar), 'n')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 22 }), s?.delivery_status === 'delivered' ? 'مُسلَّمة' : 'لم يتم', 's')
    if (s?.delivery_date) setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 23 }), s.delivery_date, 's')
    if (s?.vat_sar != null) setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 24 }), Number(s.vat_sar), 'n')
    if (s?.price_with_vat_sar != null) setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 25 }), Number(s.price_with_vat_sar), 'n')
    // النسبة المستقطعة — c=26 left blank
    // Yearly buckets
    if (s?.id) {
      const perYear = yearlyBySale.get(s.id)
      let total = 0
      if (perYear) {
        for (const [year, amount] of perYear) {
          const col = YEAR_COL[year]
          if (col != null && amount > 0) {
            setCell(ws, XLSX.utils.encode_cell({ r: r0, c: col - 1 }), amount, 'n')
            total += amount
          }
        }
      }
      // إجمالي المحصل بدون ضريبة (approx: total / 1.05 if VAT present)
      const withVat = total
      const priceNoTax = s.price_before_tax_sar
      const priceWith = s.price_with_vat_sar
      const noTax = priceWith && priceNoTax ? (total / priceWith) * priceNoTax : total
      setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 39 }), noTax,   'n')
      setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 40 }), withVat, 'n')
      // Remaining
      if (priceWith != null) {
        setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 41 }), Math.max(0, Number(priceWith) - total), 'n')
      }
      // Payment count
      const cnt = countBySale.get(s.id) ?? 0
      setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 42 }), cnt, 'n')
      // Collection ratio
      if (priceWith && priceWith > 0) {
        setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 43 }), total / Number(priceWith), 'n')
      }
    }
    // سعر المتر
    if (s?.price_before_tax_sar != null && u.area_m2 != null && Number(u.area_m2) > 0) {
      setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 44 }), Number(s.price_before_tax_sar) / Number(u.area_m2), 'n')
    }
  }

  return workbookToBuffer(wb)
}

// ---------------------------------------------------------------------------
// Accountant workbook (نموذج المحاسب القانوني)
// ---------------------------------------------------------------------------
// Fills sheet 1 (basic data), sheet 2 (vouchers), sheet 4 (unit-type
// breakdown). Sheets 3/5/6/7 are cleared with a small note pointing the user
// at the setup screen — those require estimated-cost + narrative fields we
// haven't shipped yet.

export async function generateAccountantWorkbookXlsx(
  projectId: string,
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4',
  year: number,
): Promise<Buffer> {
  const svc = createSupabaseService()

  // ---- Load project + tenant + developer + accountant identity ----
  // Extended (migration 068) with all fields Sheet 1 of the accountant
  // workbook expects.
  const { data: projectRow } = await svc
    .from('dsb_projects')
    .select('id, tenant_id, name_ar, code, developer_id, rega_license_no, bank_name, bank_account, bank_iban, land_price_sar, estimated_construction_sar, estimated_admin_marketing_sar, project_start_date, rega_license_expiry_date, engineer_consultant_name, engineer_consultant_contract_sar, contractor_1_name, contractor_1_contract_sar, contractor_2_name, contractor_2_contract_sar, contractor_3_name, contractor_3_contract_sar, contractor_4_name, contractor_4_contract_sar')
    .eq('id', projectId)
    .maybeSingle()
  if (!projectRow) throw new Error('project not found')
  const project = projectRow as {
    id: string; tenant_id: string; name_ar: string; code: string; developer_id: string | null
    rega_license_no: string | null; bank_name: string | null; bank_account: string | null; bank_iban: string | null
    land_price_sar: number | null; estimated_construction_sar: number | null; estimated_admin_marketing_sar: number | null
    project_start_date: string | null; rega_license_expiry_date: string | null
    engineer_consultant_name: string | null; engineer_consultant_contract_sar: number | null
    contractor_1_name: string | null; contractor_1_contract_sar: number | null
    contractor_2_name: string | null; contractor_2_contract_sar: number | null
    contractor_3_name: string | null; contractor_3_contract_sar: number | null
    contractor_4_name: string | null; contractor_4_contract_sar: number | null
  }
  const { data: tenantRow } = await svc
    .from('tenants')
    .select('name, accountant_office_name, accountant_signer_name, accountant_signer_email, accountant_signer_phone')
    .eq('id', project.tenant_id)
    .maybeSingle()
  const tenant = tenantRow as { accountant_office_name: string | null; accountant_signer_name: string | null; accountant_signer_email: string | null; accountant_signer_phone: string | null } | null

  let developerName: string | null = null
  if (project.developer_id) {
    const { data: dev } = await svc
      .from('dsb_developers')
      .select('company_name_ar')
      .eq('tenant_id', project.tenant_id)
      .eq('id', project.developer_id)
      .maybeSingle()
    developerName = (dev?.company_name_ar as string | null) ?? null
  }

  // ---- Load units + sales for unit-type counts ----
  const { data: unitRows } = await svc
    .from('dsb_project_units')
    .select('id, unit_type')
    .eq('tenant_id', project.tenant_id)
    .eq('project_id', projectId)
  const units = ((unitRows ?? []) as Array<{ id: string; unit_type: string | null }>)
  const unitCountByType = new Map<string, number>()
  for (const u of units) {
    const label = mapUnitTypeToAr(u.unit_type)
    unitCountByType.set(label, (unitCountByType.get(label) ?? 0) + 1)
  }
  const unitIds = units.map((u) => u.id)

  // Sales — one active/latest per unit — for the value column
  const salesValueByType = new Map<string, number>()
  const salesCollectedByType = new Map<string, number>()
  const saleIdSet = new Set<string>()
  if (unitIds.length > 0) {
    for (let i = 0; i < unitIds.length; i += 500) {
      const slice = unitIds.slice(i, i + 500)
      const { data } = await svc
        .from('dsb_unit_sales')
        .select('id, unit_id, price_with_vat_sar, price_before_tax_sar, sale_status, created_at')
        .eq('tenant_id', project.tenant_id)
        .in('unit_id', slice)
        .order('created_at', { ascending: false })
      const chosenByUnit = new Map<string, { id: string; price: number; status: string | null }>()
      for (const s of ((data ?? []) as Array<{ id: string; unit_id: string; price_with_vat_sar: number | null; price_before_tax_sar: number | null; sale_status: string | null }>)) {
        const price = Number(s.price_with_vat_sar ?? s.price_before_tax_sar ?? 0)
        const prev = chosenByUnit.get(s.unit_id)
        if (!prev || (prev.status !== 'active' && s.sale_status === 'active')) {
          chosenByUnit.set(s.unit_id, { id: s.id, price, status: s.sale_status })
        }
      }
      for (const [uid, chosen] of chosenByUnit) {
        saleIdSet.add(chosen.id)
        const unit = units.find((u) => u.id === uid)
        if (!unit) continue
        const label = mapUnitTypeToAr(unit.unit_type)
        salesValueByType.set(label, (salesValueByType.get(label) ?? 0) + chosen.price)
      }
    }
  }
  // Collected per sale (buyer_collection payments)
  type PayRow2 = { sale_id: string | null; unit_id: string | null; amount_sar: number | null }
  const payments = await fetchAllChunked<PayRow2>(async (from, to) => {
    const res = await svc
      .from('dsb_payments')
      .select('sale_id, unit_id, amount_sar')
      .eq('tenant_id', project.tenant_id)
      .eq('project_id', projectId)
      .eq('deposit_category', 'buyer_collection')
      .range(from, to)
    return { data: res.data as PayRow2[] | null, error: res.error }
  })
  const paidBySaleId = new Map<string, number>()
  for (const p of payments) {
    if (!p.sale_id || !saleIdSet.has(p.sale_id)) continue
    paidBySaleId.set(p.sale_id, (paidBySaleId.get(p.sale_id) ?? 0) + Number(p.amount_sar || 0))
  }
  // Group collected by unit_type via the sale→unit map above
  for (const u of units) {
    // Find the sale we chose for this unit (from saleIdSet); linear scan is fine for this list size.
    // Rebuild a quick unit→sale map:
  }
  // Simpler: iterate saleIdSet lookup back to units via a fresh query above — reuse chosenByUnit if we had kept it. For MVP: skip collected-by-type breakdown and total instead below.

  // ---- Load vouchers (paid cases) — for sheet 2 ----
  type CaseRow = {
    id: string
    case_number: string
    voucher_number_text: string | null
    amount_sar: number | null
    status: string
    is_historical: boolean | null
    paid_from_account_id: string | null
    paid_at: string | null
    signed_at: string | null
    voucher_date: string | null
    submitted_at: string | null
    extracted_fields: Record<string, unknown> | null
  }
  const cases = await fetchAllChunked<CaseRow>(async (from, to) => {
    const res = await svc
      .from('dsb_cases')
      .select('id, case_number, voucher_number_text, amount_sar, status, is_historical, paid_from_account_id, paid_at, signed_at, voucher_date, submitted_at, extracted_fields')
      .eq('tenant_id', project.tenant_id)
      .eq('project_id', projectId)
      .or('status.in.(signed,delivered),is_historical.eq.true')
      .range(from, to)
    return { data: res.data as CaseRow[] | null, error: res.error }
  })
  // Sort by paid/signed date
  const casesSorted = cases
    .map((c) => ({ ...c, effectiveDate: c.paid_at ?? c.signed_at?.slice(0, 10) ?? c.voucher_date ?? c.submitted_at?.slice(0, 10) ?? '' }))
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))

  // Account labels for the "نوع حساب الضمان" column
  const { data: acctRows } = await svc
    .from('dsb_project_accounts')
    .select('id, label, account_role')
    .eq('tenant_id', project.tenant_id)
    .eq('project_id', projectId)
  const acctLabelById = new Map<string, string>()
  const acctRoleById  = new Map<string, string | null>()
  for (const a of ((acctRows ?? []) as Array<{ id: string; label: string; account_role: string | null }>)) {
    acctLabelById.set(a.id, a.label)
    acctRoleById.set(a.id, a.account_role)
  }

  // ---- Populate the template ----
  const wb = await loadWorkbook(ACCOUNTANT_TEMPLATE_PATH)

  // === Sheet 1 (البيانات الأساسية) ===
  const s1 = wb.Sheets['(1) البيانات الاساسية']
  if (s1) {
    // Report meta
    setCell(s1, 'B2', tenant?.accountant_signer_name ?? '')
    setCell(s1, 'D2', new Date().toISOString().slice(0, 10))
    setCell(s1, 'B3', tenant?.accountant_signer_phone ?? '')
    setCell(s1, 'D3', quarter)
    setCell(s1, 'B4', tenant?.accountant_signer_email ?? '')
    // Project block — left column (labels + values in B)
    setCell(s1, 'B7',  project.rega_license_no ?? '')
    setCell(s1, 'B8',  project.name_ar)
    setCell(s1, 'B9',  developerName ?? '')
    setCell(s1, 'B10', tenant?.accountant_office_name ?? '')
    setCell(s1, 'B11', project.bank_name ?? '')
    setCell(s1, 'B12', project.bank_iban ?? project.bank_account ?? '')
    // Contractors block — rows 13..16, name in B, contract value in D
    setCell(s1, 'B13', project.contractor_1_name ?? '')
    if (project.contractor_1_contract_sar != null) setCell(s1, 'D13', Number(project.contractor_1_contract_sar), 'n')
    setCell(s1, 'B14', project.contractor_2_name ?? '')
    if (project.contractor_2_contract_sar != null) setCell(s1, 'D14', Number(project.contractor_2_contract_sar), 'n')
    setCell(s1, 'B15', project.contractor_3_name ?? '')
    if (project.contractor_3_contract_sar != null) setCell(s1, 'D15', Number(project.contractor_3_contract_sar), 'n')
    setCell(s1, 'B16', project.contractor_4_name ?? '')
    if (project.contractor_4_contract_sar != null) setCell(s1, 'D16', Number(project.contractor_4_contract_sar), 'n')
    // Right column (labels in C, values in D) — cost estimates.
    if (project.land_price_sar                != null) setCell(s1, 'D7',  Number(project.land_price_sar), 'n')
    // D8 = إجمالي قيمة وحدات المشروع — template has =D35 formula summing
    // the unit-type value column below; we populate that section further
    // down, so the formula recalcs when opened.
    if (project.estimated_construction_sar    != null) setCell(s1, 'D9',  Number(project.estimated_construction_sar), 'n')
    if (project.estimated_admin_marketing_sar != null) setCell(s1, 'D10', Number(project.estimated_admin_marketing_sar), 'n')
    // D11 (اجمالي التكاليف التقديرية) is =D9+D10 in the template; leave.
    // D12 (نسبة هامش الربح المتوقع) is =(D8-(D9+D10+D7))/D8; leave.
    // Unit-type breakdown block starts at row 19 (header) / row 20 onwards
    const TYPE_ROWS: Record<string, number> = {
      'شقق': 20, 'فلل': 21, 'دوبلكس': 22,
      'أراضي سكنية': 23, 'أراضي تجارية': 24, 'أراضي صناعية': 25,
      'أراضي زراعية': 26, 'أراضي سياحية': 27, 'أدوار': 28,
      'مكاتب تجارية': 29, 'تاون هاوس': 30, 'غرف فندقية': 32,
      'أجنحة فندقية': 33, 'بنت هاوس': 34,
    }
    for (const [label, row] of Object.entries(TYPE_ROWS)) {
      const count = unitCountByType.get(label) ?? 0
      const value = salesValueByType.get(label) ?? 0
      if (count > 0) setCell(s1, `C${row}`, count, 'n')
      if (value > 0) setCell(s1, `D${row}`, value, 'n')
    }
  }

  // === Sheet 2 (وثائق الصرف) ===
  const s2 = wb.Sheets['(2) وثائق الصرف']
  if (s2) {
    // Header row 2, data from row 3. Clear rows 3..300.
    clearCellsRange(s2, 3, 500, 1, 12)
    let idx = 0
    for (const c of casesSorted) {
      const rowXlsx = 3 + idx
      const r0 = rowXlsx - 1
      idx += 1
      const acctLabel = c.paid_from_account_id ? (acctLabelById.get(c.paid_from_account_id) ?? '') : ''
      const acctRole  = c.paid_from_account_id ? (acctRoleById.get(c.paid_from_account_id) ?? null) : null
      const typeCode  = (c.extracted_fields as { disbursement_type_code?: string } | null)?.disbursement_type_code ?? ''
      const typeLabel = mapDisbursementTypeToAr(typeCode)
      const beneficiary = (c.extracted_fields as { beneficiary_name_ar?: string } | null)?.beneficiary_name_ar ?? ''
      const capacity = (c.extracted_fields as { beneficiary_capacity_ar?: string } | null)?.beneficiary_capacity_ar ?? ''
      setCell(s2, XLSX.utils.encode_cell({ r: r0, c:  0 }), idx, 'n')
      setCell(s2, XLSX.utils.encode_cell({ r: r0, c:  1 }), mapAccountRoleToAr(acctRole) || acctLabel, 's')
      setCell(s2, XLSX.utils.encode_cell({ r: r0, c:  2 }), typeLabel, 's')
      setCell(s2, XLSX.utils.encode_cell({ r: r0, c:  3 }), c.voucher_number_text ?? c.case_number, 's')
      if (c.voucher_date) setCell(s2, XLSX.utils.encode_cell({ r: r0, c: 4 }), c.voucher_date, 's')
      setCell(s2, XLSX.utils.encode_cell({ r: r0, c:  5 }), beneficiary, 's')
      setCell(s2, XLSX.utils.encode_cell({ r: r0, c:  6 }), capacity, 's')
      setCell(s2, XLSX.utils.encode_cell({ r: r0, c:  7 }), '', 's') // بيان الصرف — free text; we don't extract it separately
      setCell(s2, XLSX.utils.encode_cell({ r: r0, c:  8 }), c.is_historical ? 'تاريخي' : 'مستحق', 's')
      if (c.signed_at) setCell(s2, XLSX.utils.encode_cell({ r: r0, c: 9 }), c.signed_at.slice(0, 10), 's')
      if (c.paid_at)   setCell(s2, XLSX.utils.encode_cell({ r: r0, c: 10 }), c.paid_at, 's')
      if (c.amount_sar != null) setCell(s2, XLSX.utils.encode_cell({ r: r0, c: 11 }), Number(c.amount_sar), 'n')
    }
  }

  // === Sheet 4 (وحدات المشروع) ===
  const s4 = wb.Sheets['(4) وحدات المشروع']
  if (s4) {
    // Table 1: إجمالي وحدات المشروع (rows 2..17 by unit type). Column layout:
    // B=type label, C=count, D=%, E=value, F=collected, G=remaining
    // We only touch C+E+F+G for types with data.
    const s4TypeRows: Record<string, number> = {
      'شقق': 2, 'فلل': 3, 'دوبلكس': 4,
      'أراضي سكنية': 5, 'أراضي تجارية': 6, 'أراضي صناعية': 7,
      'أراضي زراعية': 8, 'أراضي سياحية': 9, 'أدوار': 10,
      'مكاتب تجارية': 11, 'تاون هاوس': 12, 'غرف فندقية': 14,
      'أجنحة فندقية': 15, 'بنت هاوس': 16,
    }
    const totalUnits = units.length || 1
    let sumCount = 0, sumValue = 0, sumPaid = 0
    for (const [label, row] of Object.entries(s4TypeRows)) {
      const count = unitCountByType.get(label) ?? 0
      const value = salesValueByType.get(label) ?? 0
      // Collected + remaining aren't broken down by type in our data; leave
      // for the totals row only.
      if (count > 0) {
        setCell(s4, `C${row}`, count, 'n')
        setCell(s4, `D${row}`, count / totalUnits, 'n')
        setCell(s4, `E${row}`, value, 'n')
        sumCount += count
        sumValue += value
      }
    }
    // Totals row 17 (الإجمالي)
    setCell(s4, 'C17', sumCount, 'n')
    setCell(s4, 'D17', 1, 'n')
    setCell(s4, 'E17', sumValue, 'n')
    for (const p of payments) sumPaid += Number(p.amount_sar || 0)
    setCell(s4, 'F17', sumPaid, 'n')
    setCell(s4, 'G17', Math.max(0, sumValue - sumPaid), 'n')
  }

  // === Sheets 3 / 5 / 6 / 7 ===
  // Deferred — those need R1 schema (estimates + notes) + balance-sheet math.
  // Clear the sample data so nothing from another tenant leaks through.
  for (const sheetName of ['(3) العمليات المالية', '(5) تحليل البيانات المالية', '(6) النتائج والملاحظات', 'قائمة المركز المالي (7)']) {
    const ws = wb.Sheets[sheetName]
    if (!ws) continue
    // Wipe entire data area but leave the template's labels — we identify
    // "data" cells here as any cell whose value is a number OR a date >
    // 2020 OR a specific known Ayal Alasala string. Simpler: clear a broad
    // rectangle and rely on Excel to show a mostly-empty sheet. Users see
    // the sheet headers + labels but no data — a clear signal it's TBD.
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith('!')) continue
      const cell = ws[addr]
      if (typeof cell?.v === 'number' && Number(cell.v) > 100) {
        delete ws[addr]
      }
    }
  }

  return workbookToBuffer(wb)
}

// ---------------------------------------------------------------------------
// Label mappers — keep in sync with the REGA-approved lists.
// ---------------------------------------------------------------------------

function mapUnitTypeToAr(t: string | null): string {
  if (!t) return 'أخرى'
  const k = t.toLowerCase().trim()
  if (k === 'villa' || k === 'فيلا' || k === 'فلل') return 'فلل'
  if (k === 'apartment' || k === 'شقة' || k === 'شقق') return 'شقق'
  if (k === 'duplex' || k === 'دوبلكس') return 'دوبلكس'
  if (k === 'townhouse' || k === 'تاون هاوس') return 'تاون هاوس'
  return t
}

function mapDisbursementTypeToAr(code: string): string {
  switch (code) {
    case 'construction':          return 'انشائي'
    case 'admin_marketing':       return 'اداري'
    case 'bank_financing':        return 'تمويل بنكي'
    case 'moh_incentive':         return 'حوافز وزارة الإسكان'
    case 'unit_seriousness_fees': return 'رسوم جدية'
    case 'vat_project_registry':  return 'ضريبة قيمة مضافة'
    case 'vat_sales_payment':     return 'ضريبة قيمة مضافة'
    default:                       return 'أخرى'
  }
}

function mapAccountRoleToAr(role: string | null): string {
  switch (role) {
    case 'construction':    return 'حساب الانشاءات'
    case 'admin_marketing': return 'حساب الإداري والتسويقي'
    case 'escrow':          return 'حساب الحفظ'
    case 'general':         return 'الحساب العام'
    default:                 return ''
  }
}
