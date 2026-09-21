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
  // Ensure date cells carry a date number-format so Excel displays them as
  // dates AND treats them as date serials in formulas. Without a `z`,
  // SheetJS may write the cell as a generic number that referring formulas
  // subtract from other date serials without issue, but the display comes
  // out as an integer — confusing for the accountant.
  if (cell.t === 'd' && !cell.z) cell.z = 'yyyy-mm-dd'
  sheet[address] = cell
  // Ensure the sheet's range covers this cell so xlsx serializes it.
  const ref = sheet['!ref'] ?? 'A1'
  const range = XLSX.utils.decode_range(ref)
  const addr = XLSX.utils.decode_cell(address)
  if (addr.r > range.e.r) range.e.r = addr.r
  if (addr.c > range.e.c) range.e.c = addr.c
  sheet['!ref'] = XLSX.utils.encode_range(range)
}

// Parse a Supabase date string ("YYYY-MM-DD" or ISO timestamp) into a JS
// Date, or null if the input is empty / unparseable. We use midday UTC so
// timezone shifts near date boundaries don't push the value onto the
// wrong calendar day when Excel renders it in the user's locale.
function parseSupabaseDate(input: string | null | undefined): Date | null {
  if (!input) return null
  const s = String(input).trim()
  if (!s) return null
  const datePart = s.slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3])
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null
  return new Date(Date.UTC(y, mo, d, 12, 0, 0))
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
    .select('id, unit_number, unit_type, area_m2, block_number, zone_number, city, district, region, completion_status')
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
    completion_status: string | null
  }>)
  const unitIds = units.map((u) => u.id)
  // Fast lookup: is this unit marked منجزة on قائمة الوحدات?
  const completionByUnit = new Map<string, boolean>()
  for (const u of units) {
    completionByUnit.set(u.id, u.completion_status === 'completed')
  }

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
  // Per-unit sale bucketing: we route each unit to a target tab based on
  // its derived status (matches قائمة الوحدات's 4-state model):
  //   any active                     → قيد البيع   → sheet 1 (وحدات قائمة)
  //   completed AND cancelled ≥ 1    → أعيد بيعها → sheet 2 (الملغية والمعاد بيعها)
  //   only cancelled                 → متاحة/ملغية → sheet 3 (الملغية)
  //   only completed                 → مباعة        → sheet 4 (المنجزة)
  //   no contracts                   → skip (empty units aren't part of the buyers report)
  const activeByUnit    = new Map<string, SaleLite[]>()
  const completedByUnit = new Map<string, SaleLite[]>()
  const cancelledByUnit = new Map<string, SaleLite[]>()
  for (const s of sales) {
    const list = (s.sale_status === 'active') ? activeByUnit
      : (s.sale_status === 'completed') ? completedByUnit
      : (s.sale_status === 'cancelled' || s.sale_status === 'cancelled_resold') ? cancelledByUnit
      : null
    if (!list) continue
    const arr = list.get(s.unit_id) ?? []
    arr.push(s)
    list.set(s.unit_id, arr)
  }
  // The sale we DISPLAY for each unit on sheet 1 — always the LATEST
  // (most recent by sale_date, then created_at). The query already sorts
  // sales DESC by created_at, so first-seen wins for tiebreaks.
  const saleByUnit = new Map<string, SaleLite>()
  const parseD = (d: string | null) => (d ? Date.parse(d.slice(0, 10)) : 0)
  for (const s of sales) {
    const prev = saleByUnit.get(s.unit_id)
    if (!prev) { saleByUnit.set(s.unit_id, s); continue }
    const cur  = parseD(s.sale_date)    || Date.parse(s.created_at)    || 0
    const p    = parseD(prev.sale_date) || Date.parse(prev.created_at) || 0
    if (cur > p) saleByUnit.set(s.unit_id, s)
  }

  type UnitStatus = 'in_progress' | 'resold' | 'sold' | 'cancelled_only' | 'no_contract'
  // Priority (top-to-bottom):
  //   unit.completion_status='completed' + any contract → sold  → tab 4
  //      (المنجزة overrides everything else — a delivered unit is delivered)
  //   cancelled + (active OR completed)                 → resold        → tab 2
  //   only active                                       → in_progress   → tab 1
  //   only completed contract                           → sold          → tab 4
  //   only cancelled                                    → cancelled_only→ tab 3
  //   nothing                                           → no_contract   → skipped
  function deriveUnitStatus(unitId: string): UnitStatus {
    const a = (activeByUnit.get(unitId)    ?? []).length
    const c = (completedByUnit.get(unitId) ?? []).length
    const x = (cancelledByUnit.get(unitId) ?? []).length
    const isDelivered = completionByUnit.get(unitId) === true
    const hasAny = a + c + x > 0
    if (isDelivered && hasAny)     return 'sold'
    if (x > 0 && (a > 0 || c > 0)) return 'resold'
    if (a > 0)                     return 'in_progress'
    if (c > 0)                     return 'sold'
    if (x > 0)                     return 'cancelled_only'
    return 'no_contract'
  }

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
  // Bucket every payment by its own sale_id — including payments linked
  // to cancelled sales. The old "only chosen sale wins" filter dropped
  // collections for the cancelled row in the resold tab, so المحصل came
  // out as 0. All sales this tenant/project owns are eligible.
  for (const p of payments) {
    if (!p.sale_id) continue
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
  // STEP 1 — Snapshot template row 8 BEFORE clearing.
  //
  // For each column we cache:
  //   • formula (`.f`)  — replicated on every output row w/ retargeted refs
  //   • number format (`.z`)  — so dates show as "mm-dd-yy", money as such
  //   • cell style   (`.s`) — carries font, fill, borders, alignment
  //
  // Without the `.z` snapshot, date cells like U (sale date) would render
  // as a 5-digit serial number until the accountant reformats them.
  // -----------------------------------------------------------------------
  type TemplateCellSnapshot = { f?: string; z?: XLSX.CellObject['z']; s?: unknown }
  const templateRow: Map<number, TemplateCellSnapshot> = new Map()
  const TEMPLATE_ROW_R0 = BUYERS_DATA_START_ROW - 1
  for (let c = 0; c < 49; c++) {
    const addr = XLSX.utils.encode_cell({ r: TEMPLATE_ROW_R0, c })
    const cell = ws[addr] as (XLSX.CellObject & { s?: unknown }) | undefined
    if (!cell) continue
    const snap: TemplateCellSnapshot = {}
    if (typeof cell.f === 'string' && cell.f.length > 0) snap.f = cell.f
    if (cell.z != null) snap.z = cell.z
    if (cell.s != null) snap.s = cell.s
    templateRow.set(c, snap)
  }
  // Formula columns whitelist — only these are treated as replicated formulas.
  const templateFormulas = new Map<number, string>()
  for (const col of BUYERS_FORMULA_COLS_0IDX) {
    const snap = templateRow.get(col)
    if (snap?.f) templateFormulas.set(col, snap.f)
  }

  // -----------------------------------------------------------------------
  // STEP 2 — Clear the sample data rows below the header (455 Ayal Alasala
  // rows we must not ship to other tenants). Row 465 (totals) and rows past
  // it (bank reconciliation notes) are LEFT INTACT — their formulas
  // reference V8:V464 etc. and we retarget those ranges in step 4.
  // -----------------------------------------------------------------------
  clearCellsRange(ws, BUYERS_DATA_START_ROW, BUYERS_TEMPLATE_LAST_DATA_ROW, 1, 49)

  // -----------------------------------------------------------------------
  // STEP 3 — Populate one row per unit ROUTED to sheet 1 (وحدات قائمة).
  // ANY unit that has at least one contract belongs here, showing the
  // LATEST contract per unit. The other tabs (ملغية / معاد بيعها / منجزة)
  // are additional views of the same underlying data.
  // -----------------------------------------------------------------------
  const sheet1Units = units.filter((u) => deriveUnitStatus(u.id) !== 'no_contract')
  let idx = 0
  for (const u of sheet1Units) {
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
    // عدد مرات بيع الوحدة — always derived from the actual count of sales
    // on this unit (active + completed + cancelled). Overrides whatever
    // stored sale_count the row carries so historical rows show the right
    // total even if their DB value wasn't updated when the unit was resold.
    {
      const totalSales =
        (activeByUnit.get(u.id)?.length ?? 0) +
        (completedByUnit.get(u.id)?.length ?? 0) +
        (cancelledByUnit.get(u.id)?.length ?? 0)
      if (totalSales > 0) {
        setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 14 }), totalSales, 'n')
      }
    }
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 15 }), u.block_number ?? '', 's')
    // Contract + financing
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 16 }), s?.contract_number ?? '', 's')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 17 }), s?.contract_type ?? '', 's')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 18 }), s?.financing_type ?? '', 's')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 19 }), s?.financing_bank ?? '', 's')
    // Sale date — MUST be a real Date so the AB..AK yearly formulas work
    // (they do numeric date arithmetic like $AB$7-U{r}). Writing a string
    // makes Excel treat the cell as text and the formulas silently return 0.
    const saleDate = parseSupabaseDate(s?.sale_date)
    if (saleDate) setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 20 }), saleDate, 'd')
    // Price + delivery — Y (VAT) / Z (price-with-VAT) come from formulas
    if (s?.price_before_tax_sar != null) setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 21 }), Number(s.price_before_tax_sar), 'n')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 22 }), s?.delivery_status === 'delivered' ? 'مُسلَّمة' : 'لم يتم', 's')
    const deliveryDate = parseSupabaseDate(s?.delivery_date)
    if (deliveryDate) setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 23 }), deliveryDate, 'd')

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

    // Apply the template row's styling (number format + fill/borders/font)
    // to every cell we wrote in this row. Without this, date cells render
    // as a 5-digit serial and money cells lose their thousands separator.
    for (const [col, snap] of templateRow) {
      const addr = XLSX.utils.encode_cell({ r: r0, c: col })
      const cell = ws[addr] as (XLSX.CellObject & { s?: unknown }) | undefined
      if (!cell) continue
      if (snap.z != null && cell.z == null) cell.z = snap.z
      if (snap.s != null && cell.s == null) (cell as { s?: unknown }).s = snap.s
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

  // -----------------------------------------------------------------------
  // STEP 5 — Populate tabs 2 (الوحدات الملغية والمعاد بيعها),
  //          3 (الوحدات الملغية), and 4 (الوحدات المنجزة).
  //
  // Tabs 2/3 share the same 26-column schema; tab 4 has a different
  // 31-column schema. Both are simpler than sheet 1 (no yearly buckets,
  // no supervision-fee columns).
  // -----------------------------------------------------------------------
  function totalCollectedForSale(saleId: string): number {
    const perYear = yearlyBySale.get(saleId)
    if (!perYear) return 0
    let total = 0
    for (const amt of perYear.values()) total += amt
    return total
  }

  // Shared writer for the "cancelled" + "cancelled_and_resold" tabs
  // (identical 26-col schema). `label` is what goes into column C
  // (نوع المشتري): "الغاء" or "إعادة بيع".
  function populateShortSheet(sheet: XLSX.WorkSheet, rows: Array<{ u: typeof units[number]; s: SaleLite; label: string }>) {
    // Snapshot row 2 for formula/style replication then clear rows 2..200.
    const templateRow2 = new Map<number, TemplateCellSnapshot>()
    for (let c = 0; c < 26; c++) {
      const addr = XLSX.utils.encode_cell({ r: 1, c })
      const cell = sheet[addr] as (XLSX.CellObject & { s?: unknown }) | undefined
      if (!cell) continue
      const snap: TemplateCellSnapshot = {}
      if (typeof cell.f === 'string' && cell.f.length > 0) snap.f = cell.f
      if (cell.z != null) snap.z = cell.z
      if (cell.s != null) snap.s = cell.s
      templateRow2.set(c, snap)
    }
    clearCellsRange(sheet, 2, 200, 1, 26)

    let idx = 0
    for (const { u, s, label } of rows) {
      const rowXlsx = 2 + idx
      const r0 = rowXlsx - 1
      idx += 1
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 0 }), idx, 'n')                                        // A
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 1 }), s.buyer_name_ar ?? '', 's')                      // B
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 2 }), label, 's')                                      // C — الغاء / إعادة بيع
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 3 }), s.buyer_id_number ?? '', 's')                    // D
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 4 }), s.buyer_nationality ?? '', 's')                  // E
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 5 }), s.buyer_id_type ?? '', 's')                      // F — نوع الإقامة
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 6 }), s.buyer_phone ?? '', 's')                        // G
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 7 }), project.name_ar, 's')                            // H
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 8 }), u.district ?? '', 's')                           // I — الحي
      if (u.area_m2 != null) setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 9 }), Number(u.area_m2), 'n')   // J
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 10 }), u.unit_type ?? '', 's')                         // K
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 11 }), u.zone_number ?? '', 's')                       // L
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 12 }), u.unit_number, 's')                             // M
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 13 }), u.block_number ?? '', 's')                      // N
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 14 }), s.contract_number ?? '', 's')                   // O
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 15 }), s.contract_type ?? '', 's')                     // P
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 16 }), s.financing_type ?? '', 's')                    // Q
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 17 }), s.financing_bank ?? '', 's')                    // R
      const sd = parseSupabaseDate(s.sale_date)
      if (sd) setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 18 }), sd, 'd')                                // S — تاريخ البيع
      if (s.price_before_tax_sar != null) setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 19 }), Number(s.price_before_tax_sar), 'n') // T
      // U + V are formulas (VAT + total-with-VAT); we replicate them below.
      const collected = totalCollectedForSale(s.id)
      if (collected > 0) setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 22 }), collected, 'n')              // W — المحصل
      // X, Y, Z are formulas. Copy row-2 formulas with retargeted refs.
      for (const [col, snap] of templateRow2) {
        if (!snap.f) continue
        const adjusted = snap.f.replace(/(\$?[A-Z]+\$?)2(?![0-9])/g, `$1${rowXlsx}`)
        const addr = XLSX.utils.encode_cell({ r: r0, c: col })
        const existing = sheet[addr] as XLSX.CellObject | undefined
        sheet[addr] = existing
          ? { ...existing, f: adjusted, v: undefined, w: undefined, t: 'n' }
          : { t: 'n', f: adjusted }
      }
      // Apply template styling to every populated cell.
      for (const [col, snap] of templateRow2) {
        const addr = XLSX.utils.encode_cell({ r: r0, c: col })
        const cell = sheet[addr] as (XLSX.CellObject & { s?: unknown }) | undefined
        if (!cell) continue
        if (snap.z != null && cell.z == null) cell.z = snap.z
        if (snap.s != null && cell.s == null) (cell as { s?: unknown }).s = snap.s
      }
    }
  }

  // Sheet 4 (المنجزة) — 31 columns, distinct layout.
  function populateCompletedSheet(sheet: XLSX.WorkSheet, rows: Array<{ u: typeof units[number]; s: SaleLite }>) {
    const templateRow2 = new Map<number, TemplateCellSnapshot>()
    for (let c = 0; c < 31; c++) {
      const addr = XLSX.utils.encode_cell({ r: 1, c })
      const cell = sheet[addr] as (XLSX.CellObject & { s?: unknown }) | undefined
      if (!cell) continue
      const snap: TemplateCellSnapshot = {}
      if (typeof cell.f === 'string' && cell.f.length > 0) snap.f = cell.f
      if (cell.z != null) snap.z = cell.z
      if (cell.s != null) snap.s = cell.s
      templateRow2.set(c, snap)
    }
    clearCellsRange(sheet, 2, 200, 1, 31)

    let idx = 0
    for (const { u, s } of rows) {
      const rowXlsx = 2 + idx
      const r0 = rowXlsx - 1
      idx += 1
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 0 }), idx, 'n')                                        // A
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 1 }), s.buyer_name_ar ?? '', 's')                      // B
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 2 }), 'منجز', 's')                                     // C — نوع المشتري
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 3 }), s.buyer_id_number ?? '', 's')                    // D
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 4 }), s.buyer_nationality ?? '', 's')                  // E
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 5 }), s.buyer_id_type ?? '', 's')                      // F
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 6 }), s.buyer_phone ?? '', 's')                        // G
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 7 }), project.name_ar, 's')                            // H
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 8 }), u.region ?? '', 's')                             // I — المنطقة
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 9 }), u.city ?? '', 's')                               // J — المدينة
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 10 }), u.district ?? '', 's')                          // K — الحي
      if (u.area_m2 != null) setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 11 }), Number(u.area_m2), 'n') // L
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 12 }), u.unit_type ?? '', 's')                         // M
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 13 }), u.zone_number ?? '', 's')                       // N
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 14 }), u.unit_number, 's')                             // O
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 15 }), u.block_number ?? '', 's')                      // P
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 16 }), s.contract_number ?? '', 's')                   // Q
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 17 }), s.contract_type ?? '', 's')                     // R
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 18 }), s.financing_type ?? '', 's')                    // S
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 19 }), s.financing_bank ?? '', 's')                    // T
      const sd = parseSupabaseDate(s.sale_date)
      if (sd) setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 20 }), sd, 'd')                                // U
      if (s.price_before_tax_sar != null) setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 21 }), Number(s.price_before_tax_sar), 'n') // V
      setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 22 }), s.delivery_status === 'delivered' ? 'مُسلَّمة' : 'لم يتم', 's') // W
      const dd = parseSupabaseDate(s.delivery_date)
      if (dd) setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 23 }), dd, 'd')                                // X
      // Y = 5% VAT (formula), Z = price+VAT (formula) — replicated below
      const collected = totalCollectedForSale(s.id)
      if (collected > 0) {
        setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 26 }), collected, 'n')  // AA — بدون ضريبة
        setCell(sheet, XLSX.utils.encode_cell({ r: r0, c: 27 }), collected, 'n')  // AB — شامل الضريبة
      }
      // AC / AD / AE are formulas — replicate below.
      for (const [col, snap] of templateRow2) {
        if (!snap.f) continue
        const adjusted = snap.f.replace(/(\$?[A-Z]+\$?)2(?![0-9])/g, `$1${rowXlsx}`)
        const addr = XLSX.utils.encode_cell({ r: r0, c: col })
        const existing = sheet[addr] as XLSX.CellObject | undefined
        sheet[addr] = existing
          ? { ...existing, f: adjusted, v: undefined, w: undefined, t: 'n' }
          : { t: 'n', f: adjusted }
      }
      for (const [col, snap] of templateRow2) {
        const addr = XLSX.utils.encode_cell({ r: r0, c: col })
        const cell = sheet[addr] as (XLSX.CellObject & { s?: unknown }) | undefined
        if (!cell) continue
        if (snap.z != null && cell.z == null) cell.z = snap.z
        if (snap.s != null && cell.s == null) (cell as { s?: unknown }).s = snap.s
      }
    }
  }

  // Bucket units for the three secondary sheets.
  const cancelledOnlyRows: Array<{ u: typeof units[number]; s: SaleLite; label: string }> = []
  const resoldRows: Array<{ u: typeof units[number]; s: SaleLite; label: string }> = []
  const completedRows: Array<{ u: typeof units[number]; s: SaleLite }> = []
  for (const u of units) {
    const st = deriveUnitStatus(u.id)
    if (st === 'cancelled_only') {
      // Show every cancelled sale for this unit.
      for (const s of (cancelledByUnit.get(u.id) ?? [])) {
        cancelledOnlyRows.push({ u, s, label: 'الغاء' })
      }
    } else if (st === 'resold') {
      // One row per sale on this unit. Cancelled rows labelled "الغاء";
      // every subsequent sale (completed OR still active) counts as
      // "إعادة بيع" — the unit was resold regardless of whether the new
      // contract has finalised.
      for (const s of (cancelledByUnit.get(u.id) ?? [])) {
        resoldRows.push({ u, s, label: 'الغاء' })
      }
      for (const s of (completedByUnit.get(u.id) ?? [])) {
        resoldRows.push({ u, s, label: 'إعادة بيع' })
      }
      for (const s of (activeByUnit.get(u.id) ?? [])) {
        resoldRows.push({ u, s, label: 'إعادة بيع' })
      }
    } else if (st === 'sold') {
      // "sold" now covers TWO cases:
      //   (1) contract.sale_status = 'completed'
      //   (2) unit.completion_status = 'completed' — even if all its
      //       contracts are active/cancelled. In this case we show the
      //       latest sale per unit as the delivered contract.
      const completed = completedByUnit.get(u.id) ?? []
      if (completed.length > 0) {
        for (const s of completed) completedRows.push({ u, s })
      } else {
        // Unit is منجزة but no contract carries 'completed' — use the
        // latest sale (already computed in saleByUnit).
        const latest = saleByUnit.get(u.id)
        if (latest) completedRows.push({ u, s: latest })
      }
    }
  }

  const wsResold    = wb.Sheets['الوحدات الملغية والمعاد بيعها']
  const wsCancelled = wb.Sheets['الوحدات الملغية']
  const wsCompleted = wb.Sheets['الوحدات المنجزة']
  if (wsResold)    populateShortSheet(wsResold,    resoldRows)
  if (wsCancelled) populateShortSheet(wsCancelled, cancelledOnlyRows)
  if (wsCompleted) populateCompletedSheet(wsCompleted, completedRows)

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
  // Clear the reference-file numeric samples first (nothing from another
  // tenant should leak through), then fill the pieces we now have data for:
  //   - Sheet 3: opening balance + forecast rows (from dsb_cpa_reports)
  //   - Sheet 5: project identity (region/city/district — mig 086)
  //   - Sheet 6: 6 narrative sections (from dsb_cpa_reports notes_*)
  //   - Sheet 7: relies on template formulas that reference Sheets 3/4/5
  // IMPORTANT: skip formula cells during clear — Sheets 5 + 7 are almost
  // entirely formulas that pull from other sheets, so deleting them would
  // strip the auto-computed variance analysis + balance sheet.
  for (const sheetName of ['(3) العمليات المالية', '(5) تحليل البيانات المالية', '(6) النتائج والملاحظات', 'قائمة المركز المالي (7)']) {
    const ws = wb.Sheets[sheetName]
    if (!ws) continue
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith('!')) continue
      const cell = ws[addr]
      // Preserve formulas — clear only hard-coded numeric samples > 100.
      if (cell?.f) continue
      if (typeof cell?.v === 'number' && Number(cell.v) > 100) {
        delete ws[addr]
      }
    }
  }

  // Extra location fields on the project (mig 086) — needed for Sheet 5
  // and used verbatim (no formulas point at them). Fetched separately so
  // the main project select stays untouched.
  const { data: locData } = await svc
    .from('dsb_projects')
    .select('region_ar, city_ar, district_ar')
    .eq('id', projectId)
    .maybeSingle()
  const location = (locData as { region_ar: string | null; city_ar: string | null; district_ar: string | null } | null) ?? { region_ar: null, city_ar: null, district_ar: null }

  // Pull the CPA report record for this period (mig 087) — provides
  // opening balance, forecast rows, and 6 narrative sections.
  const { data: reportRow } = await svc
    .from('dsb_cpa_reports')
    .select('opening_balance_sar, forecast_rows, notes_sales, notes_expenses, notes_collection, notes_current_risks, notes_future_risks, notes_other')
    .eq('tenant_id', project.tenant_id)
    .eq('project_id', projectId)
    .eq('period_year', year)
    .eq('period_quarter', Number(quarter.replace('Q', '')))
    .maybeSingle()
  const report = reportRow as {
    opening_balance_sar: number | null
    forecast_rows: Array<{ seq: number; label_ar: string; side: 'debit' | 'credit'; amount_sar: number }> | null
    notes_sales: string | null; notes_expenses: string | null; notes_collection: string | null
    notes_current_risks: string | null; notes_future_risks: string | null; notes_other: string | null
  } | null

  // Sheet 3 — opening balance goes at C5. Fill every debit/credit cell:
  //   Cumulative (column B / D)        : since project start
  //   Current period (column G / I)    : within the selected quarter only
  //
  // Row map (both sides use the same rows in the template):
  //   Row  9  DEBIT: تكاليف انشائية              | CREDIT: تحصيل من العملاء
  //   Row 10  DEBIT: (الدفعة المقدمة المتبقية)    | CREDIT: تمويل بنكي
  //   Row 11  DEBIT: مصاريف ادارية وتسويقية       | CREDIT: تمويل ذاتي
  //   Row 12  DEBIT: ايداعات عملاء مستردة        | CREDIT: تمويل الوزارة
  //   Row 13  DEBIT: عمولات بنكية                 | CREDIT: أخرى
  //   Row 14  DEBIT: أخرى                          | CREDIT: أخرى (حوالة خاطئة)
  const s3 = wb.Sheets['(3) العمليات المالية']
  if (s3) {
    // Quarter boundaries (Q1 = Jan 1..Mar 31 …).
    const q = Number(quarter.replace('Q', ''))
    const qStartMonth = (q - 1) * 3 + 1
    const qStart = `${year}-${String(qStartMonth).padStart(2, '0')}-01`
    // End = last day of month qStartMonth+2
    const qEndDate = new Date(Date.UTC(year, qStartMonth + 2, 0))
    const qEnd = `${qEndDate.getUTCFullYear()}-${String(qEndDate.getUTCMonth() + 1).padStart(2, '0')}-${String(qEndDate.getUTCDate()).padStart(2, '0')}`

    // Buckets: [cumulative, period]
    const debit = {
      construction:      [0, 0],
      customer_refund:   [0, 0],   // ايداعات عملاء مستردة (case type = 'customer_refund')
      admin_marketing:   [0, 0],
      bank_fees:         [0, 0],   // عمولات بنكية (case type = 'bank_fees')
      other:             [0, 0],
    } as Record<string, [number, number]>
    const credit = {
      buyer_collection:  [0, 0],
      bank_financing:    [0, 0],
      self_financing:    [0, 0],
      ministry:          [0, 0],   // تمويل الوزارة (deposit_category = 'moh_incentive' loosely)
      other:             [0, 0],
      wrong_transfer:    [0, 0],
    } as Record<string, [number, number]>

    const CHUNK = 1000

    // DEBITS — from signed/delivered cases with a voucher_date.
    for (let page = 0; page < 100; page++) {
      const { data } = await svc
        .from('dsb_cases')
        .select('amount_sar, voucher_date, extracted_fields')
        .eq('tenant_id', project.tenant_id)
        .eq('project_id', projectId)
        .in('status', ['signed', 'delivered'])
        .range(page * CHUNK, page * CHUNK + CHUNK - 1)
      const rows = (data ?? []) as Array<{ amount_sar: number | null; voucher_date: string | null; extracted_fields: { disbursement_type_code?: string | null } | null }>
      for (const r of rows) {
        const amt = Number(r.amount_sar || 0)
        const code = (r.extracted_fields?.disbursement_type_code ?? '').trim()
        const bucketKey =
          code === 'construction' ? 'construction' :
          code === 'admin_marketing' ? 'admin_marketing' :
          code === 'customer_refund' ? 'customer_refund' :
          code === 'bank_fees' ? 'bank_fees' :
          'other'
        debit[bucketKey][0] += amt
        if (r.voucher_date && r.voucher_date >= qStart && r.voucher_date <= qEnd) {
          debit[bucketKey][1] += amt
        }
      }
      if (rows.length < CHUNK) break
    }

    // CREDITS — from dsb_payments with a payment_date.
    for (let page = 0; page < 100; page++) {
      const { data } = await svc
        .from('dsb_payments')
        .select('amount_sar, payment_date, deposit_category')
        .eq('tenant_id', project.tenant_id)
        .eq('project_id', projectId)
        .range(page * CHUNK, page * CHUNK + CHUNK - 1)
      const rows = (data ?? []) as Array<{ amount_sar: number | null; payment_date: string | null; deposit_category: string | null }>
      for (const r of rows) {
        const amt = Number(r.amount_sar || 0)
        const cat = (r.deposit_category ?? '').trim()
        const bucketKey =
          cat === 'buyer_collection' ? 'buyer_collection' :
          cat === 'bank_financing'   ? 'bank_financing' :
          cat === 'self_financing'   ? 'self_financing' :
          cat === 'moh_incentive'    ? 'ministry' :
          cat === 'wrong_transfer'   ? 'wrong_transfer' :
          'other'
        credit[bucketKey][0] += amt
        if (r.payment_date && r.payment_date >= qStart && r.payment_date <= qEnd) {
          credit[bucketKey][1] += amt
        }
      }
      if (rows.length < CHUNK) break
    }

    // Cumulative debits (column B) — rows 9/11/12/13/14 (row 10 stays blank).
    setCell(s3, 'B9',  debit.construction[0],      'n')
    setCell(s3, 'B11', debit.admin_marketing[0],   'n')
    setCell(s3, 'B12', debit.customer_refund[0],   'n')
    setCell(s3, 'B13', debit.bank_fees[0],         'n')
    setCell(s3, 'B14', debit.other[0],             'n')
    // Cumulative credits (column D) — rows 9..14.
    setCell(s3, 'D9',  credit.buyer_collection[0], 'n')
    setCell(s3, 'D10', credit.bank_financing[0],   'n')
    setCell(s3, 'D11', credit.self_financing[0],   'n')
    setCell(s3, 'D12', credit.ministry[0],         'n')
    setCell(s3, 'D13', credit.other[0],            'n')
    setCell(s3, 'D14', credit.wrong_transfer[0],   'n')
    // Current-period debits (column G).
    setCell(s3, 'G9',  debit.construction[1],      'n')
    setCell(s3, 'G11', debit.admin_marketing[1],   'n')
    setCell(s3, 'G12', debit.customer_refund[1],   'n')
    setCell(s3, 'G13', debit.bank_fees[1],         'n')
    setCell(s3, 'G14', debit.other[1],             'n')
    // Current-period credits (column I).
    setCell(s3, 'I9',  credit.buyer_collection[1], 'n')
    setCell(s3, 'I10', credit.bank_financing[1],   'n')
    setCell(s3, 'I11', credit.self_financing[1],   'n')
    setCell(s3, 'I12', credit.ministry[1],         'n')
    setCell(s3, 'I13', credit.other[1],            'n')
    setCell(s3, 'I14', credit.wrong_transfer[1],   'n')
  }
  if (s3 && report) {
    if (report.opening_balance_sar != null) {
      setCell(s3, 'C5', Number(report.opening_balance_sar), 'n')
    }
    // Forecast rows: start at row 28 (label at G28 = 'تكاليف انشائية' in the
    // template). We write user-supplied rows into the (label, amount) grid
    // starting at G28/H28 (debit) and I28/J28 (credit) if present.
    const forecast = Array.isArray(report.forecast_rows) ? report.forecast_rows : []
    let debitRow = 28
    let creditRow = 28
    for (const f of forecast) {
      if (f.side === 'credit') {
        setCell(s3, `I${creditRow}`, f.label_ar, 's')
        setCell(s3, `J${creditRow}`, Number(f.amount_sar), 'n')
        creditRow += 1
      } else {
        setCell(s3, `G${debitRow}`, f.label_ar, 's')
        setCell(s3, `H${debitRow}`, Number(f.amount_sar), 'n')
        debitRow += 1
      }
      if (debitRow > 33 || creditRow > 33) break
    }
  }

  // Sheet 5 — project identity block (rows 2–12). Most cells are formulas
  // pulling from Sheet 1, but the location fields + engineering consultant
  // + project dates are entered directly here so they always render.
  const s5 = wb.Sheets['(5) تحليل البيانات المالية']
  if (s5) {
    if (location.region_ar)   setCell(s5, 'B5', location.region_ar, 's')
    if (location.city_ar)     setCell(s5, 'B6', location.city_ar, 's')
    if (location.district_ar) setCell(s5, 'B7', location.district_ar, 's')
    if (project.engineer_consultant_name) setCell(s5, 'B8', project.engineer_consultant_name, 's')
    if (project.project_start_date)       setCell(s5, 'B11', project.project_start_date, 's')
    if (project.rega_license_expiry_date) setCell(s5, 'B12', project.rega_license_expiry_date, 's')
  }

  // Sheet 6 — narrative sections. Section headers live in column B on rows
  // 2 / 7 / 12 / 17 / 23 / 29. We write each note into column C on the
  // next few rows so the text sits under its heading.
  const s6 = wb.Sheets['(6) النتائج والملاحظات']
  if (s6 && report) {
    const sections: Array<[string, string | null]> = [
      ['C3',  report.notes_sales],
      ['C8',  report.notes_expenses],
      ['C13', report.notes_collection],
      ['C18', report.notes_current_risks],
      ['C24', report.notes_future_risks],
      ['C30', report.notes_other],
    ]
    for (const [addr, note] of sections) {
      if (note && note.trim()) setCell(s6, addr, note.trim(), 's')
    }
  }

  return workbookToBuffer(wb)
}

// ---------------------------------------------------------------------------
// Label mappers — keep in sync with the REGA-approved lists.
// ---------------------------------------------------------------------------

function mapUnitTypeToAr(t: string | null): string {
  if (!t) return 'أخرى'
  const raw = t.trim()
  const k = raw.toLowerCase()
  // Villa
  if (k === 'villa' || raw === 'فيلا' || raw === 'فلل' || raw === 'فلة') return 'فلل'
  // Apartment
  if (k === 'apartment' || raw === 'شقة' || raw === 'شقق') return 'شقق'
  // Duplex
  if (k === 'duplex' || raw === 'دوبلكس') return 'دوبلكس'
  // Townhouse
  if (k === 'townhouse' || raw === 'تاون هاوس' || raw === 'تاون-هاوس') return 'تاون هاوس'
  // Penthouse
  if (k === 'penthouse' || raw === 'بنت هاوس' || raw === 'بنتهاوس') return 'بنت هاوس'
  // Floors
  if (k === 'floor' || k === 'floors' || raw === 'أدوار' || raw === 'دور') return 'أدوار'
  // Offices
  if (k === 'office' || raw === 'مكاتب تجارية' || raw === 'مكتب تجاري') return 'مكاتب تجارية'
  // Hotel rooms/suites
  if (raw === 'غرف فندقية' || raw === 'غرفة فندقية') return 'غرف فندقية'
  if (raw === 'أجنحة فندقية' || raw === 'جناح فندقي') return 'أجنحة فندقية'
  // Lands
  if (raw === 'أراضي سكنية' || raw === 'أرض سكنية') return 'أراضي سكنية'
  if (raw === 'أراضي تجارية' || raw === 'أرض تجارية') return 'أراضي تجارية'
  if (raw === 'أراضي صناعية' || raw === 'أرض صناعية') return 'أراضي صناعية'
  if (raw === 'أراضي زراعية' || raw === 'أرض زراعية') return 'أراضي زراعية'
  if (raw === 'أراضي سياحية' || raw === 'أرض سياحية') return 'أراضي سياحية'
  return raw
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
