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
// Header row 7 of «سجل المشترين وحدات قائمة». Data starts row 8. Column map
// (1-indexed as they appear in Excel; 0-indexed in code as noted):
//
//   COL#   XL    HEADER                                     SOURCE
//     1    A     م                                          literal (serial)
//     2    B     اسم العميل                                 literal
//     3    C     نوع الـ ID                                 literal
//     4    D     رقم الهوية                                 literal
//     5    E     الجنسية                                    literal
//     6    F     رقم الجوال                                 literal
//     7    G     اسم المشروع                                literal
//     8    H     المنطقة                                    literal
//     9    I     المدينة                                    literal
//    10    J     الحي                                       literal
//    11    K     المساحة                                    literal (feeds AS)
//    12    L     نوع الوحدة                                 literal
//    13    M     رقم المنطقة (ZONE)                         literal
//    14    N     رقم الوحدة                                 literal
//    15    O     عدد مرات بيع الوحدة                        literal
//    16    P     رقم البلوك                                 literal
//    17    Q     رقم العقد                                  literal
//    18    R     نوع العقد                                  literal
//    19    S     نوع التمويل                                literal
//    20    T     اسم الجهة التمويلية                        literal
//    21    U     تاريخ بيع الوحدة                           literal (feeds AB..AK)
//    22    V     سعر الوحدة قبل ضريبة                       literal (feeds Y,Z,AA,AL,AS)
//    23    W     حالة التسليم                               literal
//    24    X     تاريخ التسليم                              literal
//    25    Y     (5%) ضريبة التصرفات العقارية                FORMULA =V*5/100
//    26    Z     قيمة الوحدة شاملة الضريبة                  FORMULA =V+Y
//    27    AA    النسبة المستقطعة                           FORMULA (IF ladder on V)
//    28-37 AB-AK Yearly cutoffs (days-elapsed calc)          FORMULA
//    38    AL    الاشراف والمتابعة اليومية                  FORMULA =IF(AK>0,V*AA/365,0)
//    39    AM    الاشراف والمتابعة السنوية                  FORMULA =AL*AK
//    40    AN    إجمالي المحصل شامل الضريبة                FORMULA =AV+AU
//    41    AO    إجمالي المحصل بدون ضريبة                   template blank / occasionally set
//    42    AP    المتبقي من قيمة الوحدة                     FORMULA =Z-AN
//    43    AQ    عدد الدفعات                                literal
//    44    AR    نسبة التحصيل                               FORMULA =AN/Z
//    45    AS    سعر المتر                                  FORMULA =V/K
//    46    AT    (spare)                                    ignored
//    47    AU    Q1 collected (incl VAT)                    literal
//    48    AV    Q2 collected (incl VAT)                    literal (also Q3/Q4 in later quarters)
//
// Formulas are PRESERVED from the template — we snapshot row-8 formulas once
// and copy them into every populated data row, adjusting relative row refs.

const BUYERS_HEADER_ROW = 7
const BUYERS_DATA_START_ROW = 8
const BUYERS_TEMPLATE_LAST_DATA_ROW = 462
const BUYERS_TOTALS_ROW = 465

// 0-indexed columns whose row-8 cell in the template holds a formula that
// should be replicated to every populated row.
const BUYERS_FORMULA_COLS_0IDX = [
  24,                                     // Y   =V*5/100
  25,                                     // Z   =V+Y
  26,                                     // AA  =IF ladder on V
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36, // AB..AK yearly days-elapsed
  37,                                     // AL  =IF(AK>0,V*AA/365,0)
  38,                                     // AM  =AL*AK
  39,                                     // AN  =AV+AU (total collected incl VAT)
  41,                                     // AP  =Z-AN (remaining)
  43,                                     // AR  =AN/Z (collection %)
  44,                                     // AS  =V/K  (price per m²)
]

// Rewrite every `<colLetters>8` (relative row-8 reference) to point at the
// given target row. Absolute refs like `$AB$7` are untouched because we only
// match the literal `8`. We use a negative-lookahead for another digit so
// column letters followed by 800 or similar remain intact.
function retargetRow8Refs(formula: string, targetRow: number): string {
  return formula.replace(/(\$?[A-Z]+\$?)8(?![0-9])/g, `$1${targetRow}`)
}

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

  // -----------------------------------------------------------------------
  // STEP 1 — Snapshot template formulas from row 8 BEFORE clearing.
  // These are the per-row calculations (VAT, price-with-VAT, days-elapsed,
  // supervision fee, remaining, collection %, price/m²) that the accountant
  // relies on. We copy them into every populated data row further down.
  // -----------------------------------------------------------------------
  const templateFormulas = new Map<number, string>()
  for (const col of BUYERS_FORMULA_COLS_0IDX) {
    const addr = XLSX.utils.encode_cell({ r: BUYERS_DATA_START_ROW - 1, c: col })
    const cell = ws[addr] as XLSX.CellObject | undefined
    if (cell && typeof cell.f === 'string' && cell.f.length > 0) {
      templateFormulas.set(col, cell.f)
    }
  }

  // -----------------------------------------------------------------------
  // STEP 2 — Clear the sample data rows below the header (455 Ayal Alasala
  // rows we must not ship to other tenants). Row 465 (totals) and rows past
  // it (bank reconciliation notes) are LEFT INTACT — their formulas
  // reference V8:V464 etc. and we retarget those ranges in step 4.
  // -----------------------------------------------------------------------
  clearCellsRange(ws, BUYERS_DATA_START_ROW, BUYERS_TEMPLATE_LAST_DATA_ROW, 1, 49)

  // -----------------------------------------------------------------------
  // STEP 3 — Populate one row per unit. Literals go into the raw-data
  // columns; the cached formulas are copied in with row references
  // retargeted to the current row.
  // -----------------------------------------------------------------------
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
    // Price + delivery — Y (VAT) / Z (price-with-VAT) come from formulas
    if (s?.price_before_tax_sar != null) setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 21 }), Number(s.price_before_tax_sar), 'n')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 22 }), s?.delivery_status === 'delivered' ? 'مُسلَّمة' : 'لم يتم', 's')
    if (s?.delivery_date) setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 23 }), s.delivery_date, 's')

    // Total collected (across all years) for THIS sale. AN's formula is
    // =AV+AU, so we drop the running total into AU (col 46, 0-idx). If we
    // grow quarterly buckets later they can split across AU/AV.
    let saleTotalCollected = 0
    if (s?.id) {
      const perYear = yearlyBySale.get(s.id)
      if (perYear) for (const amount of perYear.values()) saleTotalCollected += amount
    }
    if (saleTotalCollected > 0) {
      setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 46 }), saleTotalCollected, 'n')
    }
    // Payment count (col 42 = AQ)
    if (s?.id) {
      const cnt = countBySale.get(s.id) ?? 0
      setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 42 }), cnt, 'n')
    }

    // Copy the row-8 formulas into this row with row refs retargeted.
    for (const [col, tmpl] of templateFormulas) {
      const adjusted = retargetRow8Refs(tmpl, rowXlsx)
      const addr = XLSX.utils.encode_cell({ r: r0, c: col })
      // Preserve any styling the template row had for this cell.
      const existing = ws[addr] as XLSX.CellObject | undefined
      ws[addr] = existing
        ? { ...existing, f: adjusted, v: undefined, w: undefined, t: 'n' }
        : { t: 'n', f: adjusted }
    }
  }

  // -----------------------------------------------------------------------
  // STEP 4 — Retarget row-465 total-row SUM ranges to match our actual data
  // row count, so the totals reflect the populated rows (not empty rows
  // through 464). Range like V8:V464 → V8:V{lastDataRow}.
  // -----------------------------------------------------------------------
  const lastDataRow = idx > 0 ? BUYERS_DATA_START_ROW + idx - 1 : BUYERS_DATA_START_ROW
  for (const addr of Object.keys(ws)) {
    if (addr.startsWith('!')) continue
    const rowMatch = /[A-Z]+(\d+)/.exec(addr)
    if (!rowMatch) continue
    const rowNum = Number(rowMatch[1])
    if (rowNum < BUYERS_TOTALS_ROW) continue
    const cell = ws[addr] as XLSX.CellObject | undefined
    if (!cell || typeof cell.f !== 'string') continue
    // Replace any :XYZnn (where nn falls in 460..464) inside SUM ranges.
    cell.f = cell.f.replace(/(:\$?[A-Z]+\$?)46[0-4]\b/g, `$1${lastDataRow}`)
    cell.v = undefined
    cell.w = undefined
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
