/**
 * xlsx-fidelity.ts — 100% template-fidelity post-processor.
 *
 * PROBLEM
 * -------
 * SheetJS (community edition) round-trips workbook style refs incorrectly.
 * When it reads a template, cells have `.s = 17`. When it writes the output,
 * `styles.xml` gets renumbered, so `.s = 17` on the output cell points at
 * the wrong style (or nothing). Result: your export is unstyled — same
 * values, no fonts / colors / borders / alignment / fills that the template
 * had.
 *
 * SOLUTION
 * --------
 * Merge SheetJS's output values into the TEMPLATE's original XML. The
 * template's styles.xml is untouched, its sheet XMLs are untouched — we
 * only surgically swap the `<v>...</v>` (value) and `<f>...</f>` (formula)
 * contents of each cell to match what SheetJS computed.
 *
 *   Template cell:  <c r="A5" s="17" t="s"><v>3</v></c>          (style 17, string index 3)
 *   Output cell:    <c r="A5" t="s"><v>91</v></c>                (string index 91)
 *   Merged cell:    <c r="A5" s="17" t="s"><v>91</v></c>         (kept style, new value)
 *
 * For NEW cells the output has but the template didn't (extra buyer rows
 * past the template's sample data), we clone the style from the same column
 * in the template's "last data row" so styling extends naturally.
 *
 * For shared strings: we take the OUTPUT's sharedStrings.xml wholesale
 * because it has all the strings SheetJS created for our new values,
 * whereas the template only had strings for its 5 sample rows.
 *
 * WHAT WE PRESERVE FROM TEMPLATE
 * ------------------------------
 *   - xl/styles.xml                 (all fonts, colors, borders, fills, dxfs)
 *   - xl/theme/*.xml                (theme colors + fonts)
 *   - xl/tables/*.xml               (Excel Tables with dxfId refs intact)
 *   - xl/drawings/*                 (letterhead + footer graphics)
 *   - xl/media/*                    (image bytes)
 *   - xl/worksheets/_rels/*.rels    (sheet → drawing/table linkages)
 *   - [Content_Types].xml           (Overrides for tables + drawings)
 *   - Every worksheet's non-cell elements (cols, mergeCells, dataValidations,
 *     pageSetup, headerFooter, tableParts, sheetViews, sheetProtection)
 *
 * WHAT WE TAKE FROM OUTPUT
 * ------------------------
 *   - xl/sharedStrings.xml          (all string values, old + new)
 *   - The <v> and <f> inner text of each cell we changed
 *   - New rows / new cells not in the template
 */

import type PizZipType from 'pizzip'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PizZip = require('pizzip') as typeof PizZipType

// -----------------------------------------------------------------------
// Regex helpers — the XML we're editing follows a strict Excel schema.
// Cell tags look like:
//   <c r="A5" s="17" t="s"><v>91</v></c>
//   <c r="B10" s="0"><v>1234.56</v></c>
//   <c r="C7" s="2" t="s"><f>SUM(A1:A5)</f><v>15</v></c>
//   <c r="D1" s="5"/>                                    (empty cell)
// Attributes appear in any order; regex allows that.
// -----------------------------------------------------------------------

const CELL_TAG_RE = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g
const ROW_TAG_RE  = /<row\b([^>]*?)>([\s\S]*?)<\/row>/g

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)
  return m ? m[1] : null
}

function setAttr(attrs: string, name: string, value: string | null): string {
  // Remove any existing attr.
  const stripped = attrs.replace(new RegExp(`\\s*\\b${name}="[^"]*"`), '')
  if (value === null) return stripped
  return stripped + ` ${name}="${escapeXml(value)}"`
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '&': return '&amp;'
      case '"': return '&quot;'
      case "'": return '&apos;'
      default:  return c
    }
  })
}

// -----------------------------------------------------------------------
// Parse a sheet's cells into a simple map: address → {attrs, inner}.
// Used to find the template's original cell + its style, then to merge
// output values in.
// -----------------------------------------------------------------------

type ParsedCell = {
  addr: string
  attrs: string    // everything between `<c ` and `>` or `/>`
  inner: string    // between `>` and `</c>`, or '' if self-closing
  isSelfClose: boolean
}

function parseCells(sheetXml: string): Map<string, ParsedCell> {
  const cells = new Map<string, ParsedCell>()
  let m: RegExpExecArray | null
  const re = new RegExp(CELL_TAG_RE.source, 'g')
  while ((m = re.exec(sheetXml)) !== null) {
    const attrs = m[1] ?? ''
    const isSelfClose = m[2] === '/>'
    const inner = isSelfClose ? '' : (m[3] ?? '')
    const addr = attr(attrs, 'r') ?? ''
    if (!addr) continue
    cells.set(addr, { addr, attrs, inner, isSelfClose })
  }
  return cells
}

// -----------------------------------------------------------------------
// Extract <v>...</v> and <f>...</f> from a cell's inner XML.
// -----------------------------------------------------------------------

function getCellValue(inner: string): string | null {
  const m = /<v>([\s\S]*?)<\/v>/.exec(inner)
  return m ? m[1] : null
}
function getCellFormula(inner: string): string | null {
  const m = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inner)
  return m ? m[1] : null
}
function getCellFormulaTag(inner: string): string | null {
  const m = /<f\b[^>]*>[\s\S]*?<\/f>|<f\b[^/]*\/>/.exec(inner)
  return m ? m[0] : null
}

// -----------------------------------------------------------------------
// Build a merged cell XML: template's attrs (style ref preserved) + output's
// value + output's formula (if any).
// -----------------------------------------------------------------------

/**
 * Normalise an output cell's type + inner XML so Excel accepts it.
 * Shared by mergeCellXml (cell exists in both template + output) and
 * buildNewCell (cell only in output, past template's data range).
 *
 * Returns { finalType, finalInner } — caller composes with base attrs.
 */
function normalizeOutputCell(outCell: ParsedCell): { finalType: string | null; finalInner: string } {
  const outType = attr(outCell.attrs, 't')
  const outFTag = getCellFormulaTag(outCell.inner)
  const outVal  = getCellValue(outCell.inner)
  const outIsMatch = /<is>[\s\S]*?<\/is>/.exec(outCell.inner)

  let finalType: string | null = outType
  let finalInner = ''

  if (outFTag) {
    // Formula cell — t="str" IS valid here (cached string result).
    finalInner += outFTag
    if (outVal !== null) finalInner += `<v>${outVal}</v>`
  } else if (outIsMatch) {
    // Already inline-string format.
    finalType = 'inlineStr'
    finalInner = outIsMatch[0]
  } else if (outVal !== null) {
    const isNumeric = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(outVal.trim())
    if (outType === 's') {
      finalType = 's'
      finalInner = `<v>${outVal}</v>`
    } else if (outType === 'b' || outType === 'e') {
      finalType = outType
      finalInner = `<v>${outVal}</v>`
    } else if (outType === 'str' && !isNumeric) {
      // 🔴 Invalid: t="str" without <f>. Convert to inlineStr.
      finalType = 'inlineStr'
      finalInner = `<is><t xml:space="preserve">${escapeXml(outVal)}</t></is>`
    } else if (isNumeric) {
      finalType = null
      finalInner = `<v>${outVal}</v>`
    } else {
      finalType = 'inlineStr'
      finalInner = `<is><t xml:space="preserve">${escapeXml(outVal)}</t></is>`
    }
  } else if (outType === 'str') {
    // t="str" with no <v> and no <f> — malformed. Strip the type.
    finalType = null
  }

  return { finalType, finalInner }
}

function mergeCellXml(tplCell: ParsedCell | null, outCell: ParsedCell): string {
  const baseAttrs = tplCell ? tplCell.attrs : outCell.attrs
  const { finalType, finalInner } = normalizeOutputCell(outCell)
  const attrs = setAttr(baseAttrs, 't', finalType)
  if (!finalInner) return `<c${attrs}/>`
  return `<c${attrs}>${finalInner}</c>`
}

// -----------------------------------------------------------------------
// Build a NEW cell (present in output, absent in template). We copy the
// style ref from the same column in the template's "reference row" so the
// new cell inherits appropriate styling (borders, alignment, fills, font).
// -----------------------------------------------------------------------

function buildNewCell(outCell: ParsedCell, styleRef: string | null): string {
  // Start from output's attrs, then inherit style from template's reference
  // row if the output cell has no s= of its own.
  let attrs = outCell.attrs
  if (styleRef && !attr(attrs, 's')) {
    attrs = setAttr(attrs, 's', styleRef)
  }
  // 🔴 CRITICAL: apply the SAME type-normalisation as mergeCellXml, otherwise
  // every new cell (buyer rows past the template's sample data) keeps
  // SheetJS's invalid t="str"-without-<f> format and Excel throws
  // "we found a problem with some content".
  const { finalType, finalInner } = normalizeOutputCell(outCell)
  attrs = setAttr(attrs, 't', finalType)
  if (!finalInner) return `<c${attrs}/>`
  return `<c${attrs}>${finalInner}</c>`
}

// -----------------------------------------------------------------------
// Extract just the column letters from a cell address ("AB12" → "AB").
// -----------------------------------------------------------------------

function colOf(addr: string): string {
  const m = /^([A-Z]+)/.exec(addr)
  return m ? m[1] : ''
}
function rowOf(addr: string): number {
  const m = /(\d+)$/.exec(addr)
  return m ? Number(m[1]) : 0
}

// -----------------------------------------------------------------------
// Parse row-level attributes (customHeight, ht, s, spans, hidden, etc.)
// from a template row so new rows can inherit them.
// -----------------------------------------------------------------------

function findTemplateReferenceRow(sheetXml: string, dataStartRow: number): { attrs: string; cellStyles: Map<string, string> } | null {
  // Look at rows starting from dataStartRow — find the first row that has
  // actual data cells (not just empty). Its cell style refs become the
  // fallback for new cells at the same column.
  const rows = new Map<number, { attrs: string; cellsInRow: Map<string, ParsedCell> }>()
  let m: RegExpExecArray | null
  const re = new RegExp(ROW_TAG_RE.source, 'g')
  while ((m = re.exec(sheetXml)) !== null) {
    const rowAttrs = m[1] ?? ''
    const rowInner = m[2] ?? ''
    const r = Number(attr(rowAttrs, 'r') ?? '0')
    if (!r) continue
    const cellsInRow = parseCells(rowInner)
    rows.set(r, { attrs: rowAttrs, cellsInRow })
  }
  // Prefer the first data row (usually dataStartRow) as the style source.
  const ref = rows.get(dataStartRow) ?? [...rows.values()].find((r) => r.cellsInRow.size > 0)
  if (!ref) return null
  const cellStyles = new Map<string, string>()
  for (const [addr, cell] of ref.cellsInRow) {
    const s = attr(cell.attrs, 's')
    if (s !== null) cellStyles.set(colOf(addr), s)
  }
  return { attrs: ref.attrs, cellStyles }
}

// -----------------------------------------------------------------------
// Group parsed cells by row number so we can rebuild <row> elements.
// -----------------------------------------------------------------------

function groupCellsByRow(cells: Map<string, ParsedCell>): Map<number, ParsedCell[]> {
  const byRow = new Map<number, ParsedCell[]>()
  for (const cell of cells.values()) {
    const r = rowOf(cell.addr)
    if (!r) continue
    if (!byRow.has(r)) byRow.set(r, [])
    byRow.get(r)!.push(cell)
  }
  // Sort cells within each row by column, and rows by number.
  for (const [, arr] of byRow) {
    arr.sort((a, b) => colOf(a.addr).localeCompare(colOf(b.addr)) || colOf(a.addr).length - colOf(b.addr).length)
  }
  return byRow
}

// -----------------------------------------------------------------------
// Sort column letters properly ("Z" < "AA" < "AB" < "BA").
// -----------------------------------------------------------------------

function colToIdx(col: string): number {
  let n = 0
  for (const c of col) n = n * 26 + (c.charCodeAt(0) - 64)
  return n
}

// -----------------------------------------------------------------------
// Rebuild <sheetData> from the merged cell map, preserving row order and
// row-level attributes from the template where possible.
// -----------------------------------------------------------------------

function rebuildSheetData(
  mergedCells: Map<string, string>,     // addr → full <c...>...</c> XML
  templateSheetXml: string,
  outputSheetXml: string,
): string {
  // Collect all rows we'll emit. Row attributes come from template first,
  // then output for rows the template didn't have.
  const templateRowAttrs = new Map<number, string>()
  const outputRowAttrs = new Map<number, string>()

  for (const [src, target] of [[templateSheetXml, templateRowAttrs], [outputSheetXml, outputRowAttrs]] as const) {
    let m: RegExpExecArray | null
    const re = new RegExp(ROW_TAG_RE.source, 'g')
    while ((m = re.exec(src)) !== null) {
      const rowAttrs = m[1] ?? ''
      const r = Number(attr(rowAttrs, 'r') ?? '0')
      if (r) target.set(r, rowAttrs)
    }
  }

  // Group merged cells by row.
  const cellsByRow = new Map<number, string[]>()
  for (const [addr, xml] of mergedCells) {
    const r = rowOf(addr)
    if (!r) continue
    if (!cellsByRow.has(r)) cellsByRow.set(r, [])
    cellsByRow.get(r)!.push(xml)
  }
  // Sort cells within each row by column index.
  for (const [, arr] of cellsByRow) {
    arr.sort((a, b) => {
      const aM = /r="([A-Z]+)\d+"/.exec(a)
      const bM = /r="([A-Z]+)\d+"/.exec(b)
      if (!aM || !bM) return 0
      return colToIdx(aM[1]) - colToIdx(bM[1])
    })
  }

  // Emit rows in numeric order.
  const rows = Array.from(cellsByRow.keys()).sort((a, b) => a - b)
  const parts: string[] = ['<sheetData>']
  for (const r of rows) {
    let rowAttrs = templateRowAttrs.get(r) ?? outputRowAttrs.get(r) ?? ` r="${r}"`
    if (!attr(rowAttrs, 'r')) rowAttrs += ` r="${r}"`
    const cellsXml = cellsByRow.get(r)!.join('')
    parts.push(`<row${rowAttrs}>${cellsXml}</row>`)
  }
  parts.push('</sheetData>')
  return parts.join('')
}

// -----------------------------------------------------------------------
// Update the <dimension> element to cover the merged cell range.
// -----------------------------------------------------------------------

function computeDimension(mergedCells: Map<string, string>): string {
  let minRow = Infinity, maxRow = 0, minColIdx = Infinity, maxColIdx = 0, minCol = '', maxCol = ''
  for (const addr of mergedCells.keys()) {
    const c = colOf(addr)
    const r = rowOf(addr)
    const idx = colToIdx(c)
    if (r < minRow) minRow = r
    if (r > maxRow) maxRow = r
    if (idx < minColIdx) { minColIdx = idx; minCol = c }
    if (idx > maxColIdx) { maxColIdx = idx; maxCol = c }
  }
  if (!isFinite(minRow) || maxRow === 0) return 'A1'
  return `${minCol}${minRow}:${maxCol}${maxRow}`
}

// -----------------------------------------------------------------------
// MAIN API
// -----------------------------------------------------------------------

/**
 * Take SheetJS's output buffer (correct values, wrong styles) and merge
 * the values into the ORIGINAL template's XML (correct styles). Returns
 * a new buffer with pixel-identical formatting to the template plus the
 * data values from the output.
 *
 * @param templateBuf   Raw bytes of the original template file
 * @param outputBuf     Raw bytes of SheetJS's generated output
 * @param opts.dataStartRowBySheet  For each sheet name that has variable
 *                                  rows past the template's sample data,
 *                                  the row number where sample data starts.
 *                                  New rows will inherit that row's cell styles.
 */
export function mergeIntoTemplate(
  templateBuf: Buffer,
  outputBuf: Buffer,
  opts: {
    dataStartRowBySheet?: Record<string, number>
    /** Sheet names (as they appear in xl/workbook.xml order) — sheet1 is index 0 */
    sheetOrder?: string[]
  } = {},
): Buffer {
  const template = new PizZip(templateBuf)
  const output = new PizZip(outputBuf)

  // ---- Take output's sharedStrings.xml (has all our new string values) ----
  const outSs = output.file('xl/sharedStrings.xml')
  if (outSs) {
    template.remove('xl/sharedStrings.xml')
    template.file('xl/sharedStrings.xml', outSs.asText())
    // Ensure [Content_Types].xml has the sharedStrings override (template
    // usually already does, but be safe).
    const ct = template.file('[Content_Types].xml')?.asText() ?? ''
    if (!ct.includes('sharedStrings')) {
      const patched = ct.replace(
        '</Types>',
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
      )
      template.remove('[Content_Types].xml')
      template.file('[Content_Types].xml', patched)
    }
  }

  // ---- For each worksheet, merge values into template's XML ----
  const sheetPaths = Object.keys(template.files)
    .filter((p) => p.startsWith('xl/worksheets/sheet') && p.endsWith('.xml') && !p.includes('/_rels/'))
    .sort()

  const dataStartBySheet = opts.dataStartRowBySheet ?? {}
  const sheetOrder = opts.sheetOrder ?? []

  for (const path of sheetPaths) {
    const tplXml = template.file(path)?.asText()
    const outXml = output.file(path)?.asText()
    if (!tplXml || !outXml) continue

    // Sheet index (0-based) → sheet name from opts.sheetOrder
    const sheetIdx = Number(/sheet(\d+)\.xml$/.exec(path)?.[1] ?? '0') - 1
    const sheetName = sheetOrder[sheetIdx] ?? ''
    const dataStartRow = dataStartBySheet[sheetName] ?? 0

    const tplCells = parseCells(tplXml)
    const outCells = parseCells(outXml)

    // Find the template's reference row for style inheritance.
    const refRow = dataStartRow ? findTemplateReferenceRow(tplXml, dataStartRow) : null

    // Merge cells: template attrs + output value/formula.
    const merged = new Map<string, string>()
    // Start with every output cell — that's the definitive value list.
    for (const [addr, outCell] of outCells) {
      const tplCell = tplCells.get(addr) ?? null
      if (tplCell) {
        merged.set(addr, mergeCellXml(tplCell, outCell))
      } else {
        // New cell. Inherit style from the template's reference row (same column).
        const styleRef = refRow?.cellStyles.get(colOf(addr)) ?? null
        merged.set(addr, buildNewCell(outCell, styleRef))
      }
    }
    // Include template-only cells (styling / labels the output didn't write).
    for (const [addr, tplCell] of tplCells) {
      if (!merged.has(addr)) {
        merged.set(addr, tplCell.isSelfClose ? `<c${tplCell.attrs}/>` : `<c${tplCell.attrs}>${tplCell.inner}</c>`)
      }
    }

    // Rebuild <sheetData>.
    const newSheetData = rebuildSheetData(merged, tplXml, outXml)

    // Splice into template's XML.
    let newXml = tplXml.replace(
      /<sheetData\b[^>]*>[\s\S]*?<\/sheetData>|<sheetData\b[^>]*\/>/,
      newSheetData,
    )
    // Update <dimension> to cover the merged range.
    const dim = computeDimension(merged)
    newXml = newXml.replace(/<dimension\s+ref="[^"]*"\s*\/>/, `<dimension ref="${dim}"/>`)

    template.remove(path)
    template.file(path, newXml)
  }

  // ---- Take output's calcChain if present (formula dependency graph) ----
  // Excel regenerates this on open, so it's OK either way; we take output's
  // to match the sheet content.
  const outCalcChain = output.file('xl/calcChain.xml')
  if (outCalcChain) {
    template.remove('xl/calcChain.xml')
    template.file('xl/calcChain.xml', outCalcChain.asText())
  }

  return template.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}
