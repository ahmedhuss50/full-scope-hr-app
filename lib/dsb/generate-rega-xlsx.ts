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
  // Force Excel to recalculate every formula when the file is opened.
  // Without this, Excel may show the CACHED value from the template
  // (computed against the sample data) instead of recomputing against
  // the numbers we just wrote. SheetJS's Workbook typings don't declare
  // CalcPr, so we set it via a targeted cast — the underlying xlsx
  // writer respects the extra property when serializing.
  const wbAny = wb.Workbook as (XLSX.WBProps & { CalcPr?: Record<string, unknown> }) | undefined ?? {}
  ;(wb as XLSX.WorkBook).Workbook = {
    ...wbAny,
    CalcPr: {
      ...(wbAny.CalcPr ?? {}),
      fullCalcOnLoad: true,
      calcMode: 'auto',
    },
  } as XLSX.WBProps
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer
}

// Set a cell value while trying to preserve formatting from the template.
// If the cell already exists we overwrite `.v` (and `.w`) and keep `.s`.
// We DROP any existing `.f` (formula): the whole point of calling setCell
// is that the caller wants their value, not a template formula that would
// overwrite it on Excel's next recalc.
function setCell(sheet: XLSX.WorkSheet, address: string, value: unknown, t?: XLSX.ExcelDataType) {
  const existing = sheet[address] as XLSX.CellObject | undefined
  const cell: XLSX.CellObject = existing
    ? { ...existing, v: value as XLSX.CellObject['v'], w: undefined }
    : { v: value as XLSX.CellObject['v'], t: t ?? (typeof value === 'number' ? 'n' : 's') }
  // Strip any inherited formula — the caller wants this value verbatim.
  if ('f' in cell) delete (cell as { f?: string }).f
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
// The 2026 REGA-approved template ships with 5 sample rows (8..12) and a
// totals row at 13. We overwrite the sample and expand as needed.
const BUYERS_TEMPLATE_LAST_DATA_ROW = 12
const BUYERS_TOTALS_ROW = 13

// 0-indexed columns whose row-8 cell in the template holds a formula that
// should be replicated to every populated row. The 2026 template dropped
// the AB..AK yearly cutoff columns and the AL/AM supervision-fee columns —
// leaving just 5 per-row formulas.
const BUYERS_FORMULA_COLS_0IDX = [
  24, // Y  =V*5/100                                (5% VAT)
  25, // Z  =V+Y                                    (price + VAT)
  28, // AC =Z-AA                                   (remaining)
  30, // AE =AA/Z                                   (collection %)
  31, // AF =V/K                                    (price per m²)
]

// The Q3:Z3 summary stats block (top-right of Sheet 1) uses per-column
// aggregate formulas that reference the sample data range 8..12. When we
// expand to N rows, these must be retargeted from V8:V12 → V8:V{lastRow}
// and B8:B12 → B8:B{lastRow} (for the count), and the reference AB13/V13 in
// S3 and Z3 shifts to the actual totals row.
const BUYERS_SUMMARY_STATS_CELLS = ['R3', 'S3', 'T3', 'U3', 'V3', 'W3', 'X3', 'Y3', 'Z3']

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

  // Fetch every active license number for this tenant so the Q3 dropdown
  // can offer them all. Used later during data-validation injection.
  const { data: licenseRows } = await svc
    .from('dsb_projects')
    .select('rega_license_no, name_ar')
    .eq('tenant_id', project.tenant_id)
    .neq('rega_license_no', null)
    .order('name_ar', { ascending: true })
  const tenantLicenses = ((licenseRows ?? []) as Array<{ rega_license_no: string | null; name_ar: string }>)
    .map((r) => (r.rega_license_no ?? '').trim())
    .filter((v, i, arr) => v && arr.indexOf(v) === i) // unique + non-empty

  // Fill the top title (A5 = "سجل المشترين (اسم المشروع)").
  setCell(ws, 'A5', `سجل المشترين (${project.name_ar})`, 's')

  // Fill Q3 with the current project's license number — becomes the default
  // pre-selected value in the dropdown injected at the end.
  if (project.rega_license_no) {
    setCell(ws, 'Q3', project.rega_license_no, 's')
  }

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
    // Sale date — write as a real Date so any downstream formulas / filters
    // treat the cell as a date, not text.
    const saleDate = parseSupabaseDate(s?.sale_date)
    if (saleDate) setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 20 }), saleDate, 'd')
    // Price + delivery — Y (VAT) / Z (price-with-VAT) come from formulas
    if (s?.price_before_tax_sar != null) setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 21 }), Number(s.price_before_tax_sar), 'n')
    setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 22 }), s?.delivery_status === 'delivered' ? 'مُسلَّمة' : 'لم يتم', 's')
    const deliveryDate = parseSupabaseDate(s?.delivery_date)
    if (deliveryDate) setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 23 }), deliveryDate, 'd')

    // Cumulative collected — the 2026 template splits into two cells:
    //   AA (col 26): total collected WITHOUT VAT (excluding the 5%)
    //   AB (col 27): total collected WITH VAT (as paid by buyer)
    // Our dsb_payments store the actual paid amount which already includes
    // VAT. To split we divide by 1.05 for the excl-VAT figure.
    let saleTotalCollected = 0
    if (s?.id) {
      const perYear = yearlyBySale.get(s.id)
      if (perYear) for (const amount of perYear.values()) saleTotalCollected += amount
    }
    if (saleTotalCollected > 0) {
      // AA = collected excl VAT (divided out of the 5%). Rounded to 2dp.
      const excl = Math.round((saleTotalCollected / 1.05) * 100) / 100
      setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 26 }), excl, 'n')
      // AB = collected incl VAT (as-paid).
      setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 27 }), saleTotalCollected, 'n')
    }
    // Payment count (col 29 = AD — "رقم الدفعة" / count of payments so far)
    if (s?.id) {
      const cnt = countBySale.get(s.id) ?? 0
      setCell(ws, XLSX.utils.encode_cell({ r: r0, c: 29 }), cnt, 'n')
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
  // STEP 4 — Retarget SUM / stats formulas to cover the actual data range.
  //
  // The 2026 REGA template ships with formulas that reference the 5 sample
  // rows (V8:V12, B8:B12, etc.) and the totals row 13. When we expand to N
  // rows we need to shift:
  //   • Totals row (was at 13) → moves to the row after our last data row
  //   • Summary stats (Q3:Z3) → V8:V12 becomes V8:V{lastDataRow}
  //
  // For the totals row itself, if we wrote more than 5 rows, we've already
  // pushed past the original position — the totals row needs to be moved
  // to the new position, otherwise SUM(V8:V12) still only sums 5 cells.
  // -----------------------------------------------------------------------
  const lastDataRow = idx > 0 ? BUYERS_DATA_START_ROW + idx - 1 : BUYERS_TEMPLATE_LAST_DATA_ROW
  const newTotalsRow = lastDataRow + 1

  // (a) If lastDataRow > 12, we've overwritten the template's totals row —
  //     lift the totals-row formulas and re-place them at newTotalsRow.
  if (lastDataRow > BUYERS_TEMPLATE_LAST_DATA_ROW) {
    // Save the original totals-row cells (row 13 in the template).
    type Snap = { addr: string; col: number; cell: XLSX.CellObject }
    const totalsSnaps: Snap[] = []
    for (let c = 0; c < 32; c++) {
      const addr = XLSX.utils.encode_cell({ r: BUYERS_TOTALS_ROW - 1, c })
      const cell = ws[addr] as XLSX.CellObject | undefined
      if (cell) totalsSnaps.push({ addr, col: c, cell: { ...cell } })
    }
    // Clear the original row 13 (it's now buried under real data).
    for (const s of totalsSnaps) delete ws[s.addr]
    // Re-place at newTotalsRow, retargeting any SUM(...12) ranges to lastDataRow.
    for (const s of totalsSnaps) {
      const newAddr = XLSX.utils.encode_cell({ r: newTotalsRow - 1, c: s.col })
      const cell = { ...s.cell }
      if (typeof cell.f === 'string') {
        cell.f = cell.f.replace(/(:\$?[A-Z]+\$?)12(?![0-9])/g, `$1${lastDataRow}`)
        cell.v = undefined
        cell.w = undefined
      }
      ws[newAddr] = cell
    }
  } else {
    // ≤5 rows: totals row stays at 13, just retarget internal SUM ranges.
    for (let c = 0; c < 32; c++) {
      const addr = XLSX.utils.encode_cell({ r: BUYERS_TOTALS_ROW - 1, c })
      const cell = ws[addr] as XLSX.CellObject | undefined
      if (!cell || typeof cell.f !== 'string') continue
      cell.f = cell.f.replace(/(:\$?[A-Z]+\$?)12(?![0-9])/g, `$1${lastDataRow}`)
      cell.v = undefined
      cell.w = undefined
    }
  }

  // (b) Retarget the Q3:Z3 summary-stats block. Each formula references the
  //     sample range 8..12 — we rewrite to 8..lastDataRow. Also S3 = V13
  //     and Z3 = AB13 need to shift to the actual totals row.
  for (const addr of BUYERS_SUMMARY_STATS_CELLS) {
    const cell = ws[addr] as XLSX.CellObject | undefined
    if (!cell || typeof cell.f !== 'string') continue
    let f = cell.f
    // Range refs: :XY12 → :XY{lastDataRow}
    f = f.replace(/(:\$?[A-Z]+\$?)12(?![0-9])/g, `$1${lastDataRow}`)
    // Single refs to the totals row: V13, AB13, etc. → V{newTotalsRow}, AB{newTotalsRow}
    f = f.replace(/(\$?[A-Z]+\$?)13(?![0-9])/g, `$1${newTotalsRow}`)
    cell.f = f
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

  // Write to buffer, then post-process to inject Excel data validation on
  // cell Q3 (رقم الرخصة). SheetJS's community writer doesn't emit data
  // validation, so we crack the .xlsx (which is a zip), append a
  // <dataValidations> element to the first worksheet's XML, and re-zip.
  const rawBuffer = workbookToBuffer(wb)
  return injectLicenseDropdown(rawBuffer, tenantLicenses)
}

/**
 * Post-process a workbook buffer to add an Excel data-validation dropdown on
 * cell Q3 of the first worksheet ("سجل المشترين وحدات قائمة"). The dropdown's
 * list is the passed-in `licenses` array (deduped upstream). Uses pizzip to
 * unzip the .xlsx, mutate `xl/worksheets/sheet1.xml`, and re-zip.
 *
 * Excel's list-formula format is a quoted comma-separated string, e.g.
 *   <formula1>"AB1234,AB1235,AB1236"</formula1>
 * That format is capped at ~255 chars total. For tenants with many licenses
 * we fall back to a hidden helper sheet — but a simple inline list handles
 * the common case (<30 licenses, most tenants have 1–5 projects).
 */
function injectLicenseDropdown(buffer: Buffer, licenses: string[]): Buffer {
  if (licenses.length === 0) return buffer
  // Escape any double-quotes inside license numbers just to be safe.
  const listStr = licenses.map((l) => l.replace(/"/g, '""')).join(',')
  // Excel's inline-list max is ~255 chars — bail out gracefully if we overflow.
  if (listStr.length > 250) {
    // eslint-disable-next-line no-console
    console.warn(`[buyers-register] license list too long (${listStr.length} chars) — skipping dropdown injection`)
    return buffer
  }
  try {
    // Dynamic import — pizzip is a runtime dep, we don't need it in the type surface.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PizZip = require('pizzip') as new (data: Buffer) => {
      file: (path: string) => { asText: () => string } | null
      generate: (opts: { type: 'nodebuffer'; compression: string }) => Buffer
      remove: (path: string) => void
    }
    const zip = new PizZip(buffer)
    // Sheet1 is the first worksheet in the workbook. Sheet2 in the file (Sheet1
    // helper) is the second — but we want "سجل المشترين وحدات قائمة" which is
    // the first per the template's ordering.
    const sheetXmlPath = 'xl/worksheets/sheet1.xml'
    const entry = zip.file(sheetXmlPath)
    if (!entry) return buffer
    let xml = entry.asText()
    // If dataValidations already exist, don't double-inject.
    if (xml.includes('<dataValidations')) return buffer
    // Build the data validation XML — the "!" prefix on formula1 is Excel's
    // convention for an inline literal list.
    const dv = `<dataValidations count="1"><dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="Q3"><formula1>"${listStr}"</formula1></dataValidation></dataValidations>`
    // Insert BEFORE any of these closing sections (they must appear in Excel's
    // strict schema order): pageMargins → pageSetup → headerFooter → drawing → …
    // dataValidations must come before pageMargins.
    const insertBefore = /<(pageMargins|pageSetup|headerFooter|drawing|legacyDrawing|tableParts)/
    if (insertBefore.test(xml)) {
      xml = xml.replace(insertBefore, `${dv}<$1`)
    } else {
      // Fallback — insert before the closing </worksheet>.
      xml = xml.replace('</worksheet>', `${dv}</worksheet>`)
    }
    // pizzip doesn't have an update-in-place; remove + re-add.
    zip.remove(sheetXmlPath)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(zip as unknown as { file(path: string, data: string): void }).file(sheetXmlPath, xml)
    return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
  } catch (err) {
    // If anything fails (missing pizzip, XML shape mismatch), fall through
    // with the un-injected buffer — dropdown is a nice-to-have, not a blocker.
    // eslint-disable-next-line no-console
    console.warn('[buyers-register] failed to inject Q3 dropdown:', err)
    return buffer
  }
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

  // Quarter end date — for filtering vouchers to the reporting window
  // (cumulative through end-of-quarter; no future-dated vouchers leak in).
  const qNum = Number(quarter.replace('Q', ''))
  const qStartMonth = (qNum - 1) * 3 + 1
  const qEndDate = new Date(Date.UTC(year, qStartMonth + 2, 0))
  const qEndISO = `${qEndDate.getUTCFullYear()}-${String(qEndDate.getUTCMonth() + 1).padStart(2, '0')}-${String(qEndDate.getUTCDate()).padStart(2, '0')}`

  // ---- Load vouchers (paid cases) — for sheet 2 ----
  type CaseRow = {
    id: string
    case_number: string
    voucher_number_text: string | null
    amount_sar: number | null
    status: string
    is_historical: boolean | null
    is_downpayment: boolean | null
    paid_from_account_id: string | null
    vendor_id: string | null
    paid_at: string | null
    signed_at: string | null
    voucher_date: string | null
    submitted_at: string | null
    notes: string | null
    extracted_fields: Record<string, unknown> | null
  }
  // Try wide select first (needs mig 084 + 085); fall back to narrow if either
  // column is missing on this deployment.
  let cases: CaseRow[] = []
  try {
    cases = await fetchAllChunked<CaseRow>(async (from, to) => {
      const res = await svc
        .from('dsb_cases')
        .select('id, case_number, voucher_number_text, amount_sar, status, is_historical, is_downpayment, paid_from_account_id, vendor_id, paid_at, signed_at, voucher_date, submitted_at, notes, extracted_fields')
        .eq('tenant_id', project.tenant_id)
        .eq('project_id', projectId)
        .or('status.in.(signed,delivered),is_historical.eq.true')
        .range(from, to)
      if (res.error) throw res.error
      return { data: res.data as CaseRow[] | null, error: res.error }
    })
  } catch {
    cases = await fetchAllChunked<CaseRow>(async (from, to) => {
      const res = await svc
        .from('dsb_cases')
        .select('id, case_number, voucher_number_text, amount_sar, status, is_historical, paid_from_account_id, paid_at, signed_at, voucher_date, submitted_at, notes, extracted_fields')
        .eq('tenant_id', project.tenant_id)
        .eq('project_id', projectId)
        .or('status.in.(signed,delivered),is_historical.eq.true')
        .range(from, to)
      return { data: (res.data ?? []).map((r) => ({ ...r, vendor_id: null, is_downpayment: null })) as CaseRow[] | null, error: res.error }
    })
  }
  // Filter out future-dated vouchers (later than the report period). Cases
  // with no date at all stay in — legacy imports we still want to surface.
  const casesInPeriod = cases.filter((c) => {
    const dateAnchor = c.voucher_date ?? c.paid_at ?? (c.signed_at ? c.signed_at.slice(0, 10) : null) ?? (c.submitted_at ? c.submitted_at.slice(0, 10) : null)
    if (!dateAnchor) return true
    return dateAnchor <= qEndISO
  })
  // Sort by paid/signed date
  const casesSorted = casesInPeriod
    .map((c) => ({ ...c, effectiveDate: c.paid_at ?? c.signed_at?.slice(0, 10) ?? c.voucher_date ?? c.submitted_at?.slice(0, 10) ?? '' }))
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))

  // ---- Load vendors (for صفة المستفيد fallback via service_category) ----
  const vendorCategoryById = new Map<string, string | null>()
  const vendorNameById     = new Map<string, string>()
  try {
    const { data: vRows } = await svc
      .from('dsb_vendors')
      .select('id, contact_name_ar, service_category')
      .eq('tenant_id', project.tenant_id)
      .eq('project_id', projectId)
    for (const v of ((vRows ?? []) as Array<{ id: string; contact_name_ar: string | null; service_category: string | null }>)) {
      vendorCategoryById.set(v.id, v.service_category)
      if (v.contact_name_ar) vendorNameById.set(v.id, v.contact_name_ar)
    }
  } catch { /* vendors table may not exist on very old deployments */ }

  // Account labels for the "نوع حساب الضمان" column. Also pull bank_name so
  // Sheet 1 (B11/B12) can fall back to the escrow/general account's bank
  // when the project itself has bank_name/bank_iban empty.
  const { data: acctRows } = await svc
    .from('dsb_project_accounts')
    .select('id, label, account_role, bank_name, iban, account_number')
    .eq('tenant_id', project.tenant_id)
    .eq('project_id', projectId)
  const acctLabelById = new Map<string, string>()
  const acctRoleById  = new Map<string, string | null>()
  type AcctRow = { id: string; label: string; account_role: string | null; bank_name: string | null; iban: string | null; account_number: string | null }
  const acctList = ((acctRows ?? []) as AcctRow[])
  for (const a of acctList) {
    acctLabelById.set(a.id, a.label)
    acctRoleById.set(a.id, a.account_role)
  }
  // Prefer the escrow (حساب الحفظ) account for Sheet 1 fallback; otherwise
  // any account that has a bank_name set. This gives the accountant something
  // reasonable to see even when the project record hasn't been fully filled.
  const escrowAcct = acctList.find((a) => a.account_role === 'escrow' && (a.bank_name || a.iban))
  const anyBankAcct = acctList.find((a) => a.bank_name || a.iban)
  const fallbackAcct = escrowAcct ?? anyBankAcct ?? null

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
    // Bank name (B11) and IBAN (B12): project fields first, then fall back
    // to the primary escrow / bank account so the sheet isn't empty when the
    // project header hasn't been fully filled.
    setCell(s1, 'B11', project.bank_name ?? fallbackAcct?.bank_name ?? '')
    setCell(s1, 'B12', project.bank_iban ?? project.bank_account ?? fallbackAcct?.iban ?? fallbackAcct?.account_number ?? '')
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

      // --- Column C: البند (nawa'a al-sarf) --------------------------------
      // Priority: explicit disbursement_type_code → account role → 'أخرى'.
      // A signed case that came in through the construction account is
      // construction even if the AI never tagged it — the account role is
      // usually a reliable proxy.
      const typeCode  = (c.extracted_fields as { disbursement_type_code?: string } | null)?.disbursement_type_code ?? ''
      const typeLabel = mapDisbursementTypeToAr(typeCode) !== 'أخرى'
        ? mapDisbursementTypeToAr(typeCode)
        : mapAccountRoleToItemLabel(acctRole)

      // --- Column F: اسم المستفيد ------------------------------------------
      // Priority: extracted_fields.beneficiary_name_ar → linked vendor name.
      const beneficiaryFromExtract = (c.extracted_fields as { beneficiary_name_ar?: string } | null)?.beneficiary_name_ar ?? ''
      const beneficiary = beneficiaryFromExtract || (c.vendor_id ? (vendorNameById.get(c.vendor_id) ?? '') : '')

      // --- Column G: صفة المستفيد ------------------------------------------
      // Priority: extracted_fields.beneficiary_capacity_ar → derive from
      // vendor.service_category → derive from disbursement type or account
      // role → blank (only when we truly have nothing).
      const capacityFromExtract = (c.extracted_fields as { beneficiary_capacity_ar?: string } | null)?.beneficiary_capacity_ar ?? ''
      const vendorCategory = c.vendor_id ? (vendorCategoryById.get(c.vendor_id) ?? null) : null
      const capacity = capacityFromExtract
        || deriveCapacityFromCategory(vendorCategory)
        || deriveCapacityFromType(typeCode, acctRole)
        || ''

      // --- Column H: بيان الصرف --------------------------------------------
      // Priority: extracted_fields.description → case.notes → synthesized
      // from (type / vendor). Better a short auto-generated line than blank.
      const descFromExtract = (c.extracted_fields as { description?: string; bayan?: string } | null)?.description
        ?? (c.extracted_fields as { bayan?: string } | null)?.bayan
        ?? ''
      const description = String(descFromExtract).trim()
        || (c.notes ?? '').trim()
        || buildDescriptionFallback(typeLabel, beneficiary, c.is_downpayment)

      // --- Column I: حالة الوثيقة ------------------------------------------
      // مستحق  = paid (paid_at set)
      // مقدم   = submitted / signed but not yet paid
      // تاريخي = imported without any paid_at AND explicitly flagged historical
      const status = c.paid_at
        ? 'مستحق'
        : (c.is_historical ? 'تاريخي' : 'مقدم')

      setCell(s2, XLSX.utils.encode_cell({ r: r0, c:  0 }), idx, 'n')
      setCell(s2, XLSX.utils.encode_cell({ r: r0, c:  1 }), mapAccountRoleToAr(acctRole) || acctLabel, 's')
      setCell(s2, XLSX.utils.encode_cell({ r: r0, c:  2 }), typeLabel, 's')
      setCell(s2, XLSX.utils.encode_cell({ r: r0, c:  3 }), c.voucher_number_text ?? c.case_number, 's')
      if (c.voucher_date) setCell(s2, XLSX.utils.encode_cell({ r: r0, c: 4 }), c.voucher_date, 's')
      setCell(s2, XLSX.utils.encode_cell({ r: r0, c:  5 }), beneficiary, 's')
      setCell(s2, XLSX.utils.encode_cell({ r: r0, c:  6 }), capacity, 's')
      setCell(s2, XLSX.utils.encode_cell({ r: r0, c:  7 }), description, 's')
      setCell(s2, XLSX.utils.encode_cell({ r: r0, c:  8 }), status, 's')
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

    // DEBITS — from signed/delivered cases with a voucher_date. Bucket by
    // disbursement_type_code first, then fall back to the paid-from account's
    // role so historical cases (no code set) land in the right column
    // (construction / admin_marketing) instead of the "other" pile.
    for (let page = 0; page < 100; page++) {
      const { data } = await svc
        .from('dsb_cases')
        .select('amount_sar, voucher_date, paid_from_account_id, extracted_fields')
        .eq('tenant_id', project.tenant_id)
        .eq('project_id', projectId)
        .in('status', ['signed', 'delivered'])
        .range(page * CHUNK, page * CHUNK + CHUNK - 1)
      const rows = (data ?? []) as Array<{ amount_sar: number | null; voucher_date: string | null; paid_from_account_id: string | null; extracted_fields: { disbursement_type_code?: string | null } | null }>
      for (const r of rows) {
        const amt = Number(r.amount_sar || 0)
        const code = (r.extracted_fields?.disbursement_type_code ?? '').trim()
        const role = r.paid_from_account_id ? acctRoleById.get(r.paid_from_account_id) : null
        // Explicit code wins; otherwise map account role → bucket.
        let bucketKey: keyof typeof debit
        if (code === 'construction')       bucketKey = 'construction'
        else if (code === 'admin_marketing') bucketKey = 'admin_marketing'
        else if (code === 'customer_refund') bucketKey = 'customer_refund'
        else if (code === 'bank_fees')       bucketKey = 'bank_fees'
        else if (role === 'construction')    bucketKey = 'construction'
        else if (role === 'admin_marketing') bucketKey = 'admin_marketing'
        else                                  bucketKey = 'other'
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
  if (s3) {
    // ---------------------------------------------------------------------
    // Opening balance (C5 = رصيد إغلاق الربع السابق).
    //
    // Priority:
    //   1. Value the user entered on the CPA report page (report.opening_balance_sar > 0)
    //   2. Auto-computed from prior activity: sum(credits before qStart) - sum(debits before qStart)
    //   3. Zero (fresh project with no prior activity)
    //
    // Sheet 3 has these dependent formulas already:
    //   B18 = C5                        (رصيد افتتاح الفترة)
    //   D18 = B18 + I15 - G15           (رصيد اغلاق الفترة)
    // So once C5 is filled correctly, both the opening AND closing balance
    // rows on Sheet 3 populate automatically when Excel opens the file.
    // ---------------------------------------------------------------------
    const userOpening = Number(report?.opening_balance_sar ?? 0)
    let openingBalance = userOpening
    if (openingBalance <= 0) {
      // Auto-compute: total credits before qStart minus total debits before qStart.
      // The debit + credit loops above already accumulated ALL history into
      // the cumulative bucket [0]. We need the prior-period slice, so we
      // recompute here with an explicit "voucher_date < qStart" filter.
      const q = Number(quarter.replace('Q', ''))
      const qStartMonth = (q - 1) * 3 + 1
      const qStart = `${year}-${String(qStartMonth).padStart(2, '0')}-01`
      let priorDebits = 0
      let priorCredits = 0
      const CHUNK = 1000
      for (let page = 0; page < 100; page++) {
        const { data } = await svc
          .from('dsb_cases')
          .select('amount_sar, voucher_date')
          .eq('tenant_id', project.tenant_id)
          .eq('project_id', projectId)
          .in('status', ['signed', 'delivered'])
          .lt('voucher_date', qStart)
          .range(page * CHUNK, page * CHUNK + CHUNK - 1)
        const rows = (data ?? []) as Array<{ amount_sar: number | null }>
        for (const r of rows) priorDebits += Number(r.amount_sar || 0)
        if (rows.length < CHUNK) break
      }
      for (let page = 0; page < 100; page++) {
        const { data } = await svc
          .from('dsb_payments')
          .select('amount_sar, payment_date')
          .eq('tenant_id', project.tenant_id)
          .eq('project_id', projectId)
          .lt('payment_date', qStart)
          .range(page * CHUNK, page * CHUNK + CHUNK - 1)
        const rows = (data ?? []) as Array<{ amount_sar: number | null }>
        for (const r of rows) priorCredits += Number(r.amount_sar || 0)
        if (rows.length < CHUNK) break
      }
      openingBalance = priorCredits - priorDebits
    }
    // Write C5 unconditionally — even a zero opening is meaningful for the
    // downstream =C5 formula in B18. Otherwise B18 would render as empty
    // and the closing-balance calc at D18 would show as 0 with no context.
    setCell(s3, 'C5', openingBalance, 'n')
  }
  if (s3 && report) {
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

/**
 * Sheet 2 column C fallback — البند ("nawa'a al-sarf") derived from the
 * paid-from account's role. Only used when the case has no explicit
 * disbursement_type_code. The REGA-approved values for this column are
 * انشائي / اداري / تسويقي / حفظ / أخرى.
 */
function mapAccountRoleToItemLabel(role: string | null): string {
  switch (role) {
    case 'construction':    return 'انشائي'
    case 'admin_marketing': return 'اداري وتسويقي'
    case 'escrow':          return 'حفظ'
    case 'general':         return 'أخرى'
    default:                 return 'أخرى'
  }
}

/**
 * Sheet 2 column G fallback — derive صفة المستفيد from a vendor's
 * service_category. The vendor form uses a curated category list; we map
 * each category to the closest canonical capacity value (see
 * lib/dsb/beneficiary-capacity.ts).
 */
function deriveCapacityFromCategory(category: string | null): string {
  if (!category) return ''
  const c = category.trim()
  // Direct hits first (owner-curated list may already use canonical values).
  if (['مقاول', 'مورد', 'ممول', 'مشتري', 'مسوق', 'استشاري هندسي', 'محاسب قانوني', 'أخرى'].includes(c)) return c
  // Common category → capacity heuristics.
  if (/مقاول/.test(c))                return 'مقاول'
  if (/مورد|توريد/.test(c))           return 'مورد'
  if (/تسويق|مسوق/.test(c))           return 'مسوق'
  if (/استشار|هندس|مصمم/.test(c))     return 'استشاري هندسي'
  if (/محاس|مراج|CPA/i.test(c))       return 'محاسب قانوني'
  if (/تمويل|بنك|ممول/.test(c))       return 'ممول'
  if (/مشتري|عميل/.test(c))           return 'مشتري'
  return ''
}

/**
 * Last-resort صفة المستفيد fallback — infer from the disbursement type or
 * the paid-from account's role when neither the extracted field nor the
 * linked vendor gives us anything.
 */
function deriveCapacityFromType(typeCode: string, acctRole: string | null): string {
  const t = (typeCode ?? '').trim()
  if (t === 'construction') return 'مقاول'
  if (t === 'admin_marketing') return 'مسوق'
  if (t === 'bank_financing') return 'ممول'
  if (acctRole === 'construction') return 'مقاول'
  if (acctRole === 'admin_marketing') return 'مسوق'
  return ''
}

/**
 * Sheet 2 column H fallback — bayan al-sarf ("statement of disbursement").
 * Free-text description of what the voucher was for. We synthesize a short
 * Arabic phrase when nothing was captured, so the accountant sees more
 * than a blank cell.
 */
function buildDescriptionFallback(typeLabel: string, beneficiary: string, isDownpayment: boolean | null): string {
  const bits: string[] = []
  if (isDownpayment) bits.push('دفعة مقدّمة')
  else bits.push('صرف')
  if (typeLabel && typeLabel !== 'أخرى') bits.push(typeLabel)
  if (beneficiary) bits.push(`للمستفيد ${beneficiary}`)
  return bits.join(' ')
}
