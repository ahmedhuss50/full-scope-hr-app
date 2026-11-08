/**
 * evaluate-xlsx-formulas.ts
 * ---------------------------------------------------------------------------
 * Replace every formula in a SheetJS workbook with its computed value using
 * HyperFormula (Node-side evaluator). After this runs, the saved .xlsx file
 * opens with raw numbers/strings in place of `=SUM(...)` etc. — no Excel
 * recalculation needed on open, and the file renders identically in Google
 * Sheets / Numbers / exporters that don't compute formulas.
 *
 * Scope:
 *   - Handles numeric, string, boolean, and date cell values as inputs.
 *   - Resolves cross-sheet references (needs sheet names as-is).
 *   - Leaves non-formula cells untouched (styles, numFmt, merges all survive).
 *   - On evaluation error (unsupported fn, bad ref), the cell keeps its
 *     original formula so the user can still open + inspect manually.
 *
 * Used by generateAccountantWorkbookXlsx so the output workbook ships
 * fully-resolved — the user explicitly asked for "values, no formulas".
 */
import * as XLSX from 'xlsx'
import { HyperFormula, type RawCellContent } from 'hyperformula'

export function evaluateAllFormulas(wb: XLSX.WorkBook): {
  replaced: number
  failed: number
  errors: Array<{ sheet: string; addr: string; error: string }>
} {
  const sheetNames = wb.SheetNames
  if (sheetNames.length === 0) return { replaced: 0, failed: 0, errors: [] }

  // 1) Serialize each sheet into a 2-D array of RawCellContent that
  //    HyperFormula understands. Formulas stay as strings starting with '='.
  //    Non-formula numeric cells go through as numbers (dates → serialized
  //    number so HyperFormula sees them as date serials consistent with Excel).
  const sheetsData: Record<string, RawCellContent[][]> = {}
  for (const name of sheetNames) {
    const ws = wb.Sheets[name]
    if (!ws || !ws['!ref']) { sheetsData[name] = [[]]; continue }
    const range = XLSX.utils.decode_range(ws['!ref'])
    const grid: RawCellContent[][] = []
    for (let r = 0; r <= range.e.r; r++) {
      const row: RawCellContent[] = []
      for (let c = 0; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const cell = ws[addr] as XLSX.CellObject | undefined
        if (!cell) { row.push(null); continue }
        // Formula — pass the raw formula string with its leading '='.
        if (typeof cell.f === 'string' && cell.f.length > 0) {
          row.push('=' + cell.f)
          continue
        }
        // Primitive values — numbers, strings, booleans, dates.
        if (cell.v === undefined || cell.v === null) { row.push(null); continue }
        if (cell.v instanceof Date) {
          // Convert JS Date to Excel serial number so HyperFormula's date
          // arithmetic matches Excel. SheetJS has a helper but easier manually.
          const ms = cell.v.getTime()
          const serial = ms / 86400000 + 25569 // 1970-01-01 → 25569
          row.push(serial)
          continue
        }
        if (typeof cell.v === 'number' || typeof cell.v === 'string' || typeof cell.v === 'boolean') {
          row.push(cell.v as RawCellContent)
          continue
        }
        row.push(null)
      }
      grid.push(row)
    }
    sheetsData[name] = grid
  }

  // 2) Instantiate HyperFormula and load every sheet. gpl-v3 license key is
  //    required by the lib; using the public "gpl-v3" value is their
  //    documented self-attestation for GPL-compatible use.
  const hf = HyperFormula.buildFromSheets(sheetsData, {
    licenseKey: 'gpl-v3',
    smartRounding: true,
  })

  // 3) For each formula cell, read back the computed value and write it into
  //    the SheetJS cell, dropping the `.f` so the file ships as values.
  let replaced = 0
  let failed = 0
  const errors: Array<{ sheet: string; addr: string; error: string }> = []
  for (const name of sheetNames) {
    const ws = wb.Sheets[name]
    if (!ws || !ws['!ref']) continue
    const sheetIdx = hf.getSheetId(name)
    if (sheetIdx === undefined) continue
    const range = XLSX.utils.decode_range(ws['!ref'])
    for (let r = 0; r <= range.e.r; r++) {
      for (let c = 0; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const cell = ws[addr] as XLSX.CellObject | undefined
        if (!cell || typeof cell.f !== 'string' || cell.f.length === 0) continue
        let value: unknown
        try {
          value = hf.getCellValue({ sheet: sheetIdx, row: r, col: c })
        } catch (err) {
          failed++
          errors.push({ sheet: name, addr, error: err instanceof Error ? err.message : String(err) })
          continue
        }
        // HyperFormula returns a DetailedCellError on failure (#DIV/0, #REF,
        // #VALUE, etc.). Owner asked for "blank instead of error" — most of
        // these are legitimate "no source data yet" cases (dividing by 0
        // units in an empty block, subtracting a missing figure). Writing a
        // blank string drops the error but keeps the cell styled.
        if (value && typeof value === 'object' && 'type' in (value as object)) {
          failed++
          errors.push({ sheet: name, addr, error: String((value as { type: string }).type) })
          const prev = cell as XLSX.CellObject & { f?: string; v?: unknown; w?: string; t?: string }
          delete prev.f
          delete prev.w
          prev.t = 's'
          prev.v = ''
          continue
        }
        if (value === null || value === undefined) {
          // Empty result — write a blank cell (not a leftover formula) so
          // the output file is consistent with the error-blanking above.
          const prev = cell as XLSX.CellObject & { f?: string; v?: unknown; w?: string; t?: string }
          delete prev.f
          delete prev.w
          prev.t = 's'
          prev.v = ''
          continue
        }
        // Write the value back and strip the formula.
        const prev = cell as XLSX.CellObject & { f?: string; v?: unknown; w?: string; t?: string }
        delete prev.f
        delete prev.w  // formatted-string cache from the formula — stale now
        if (typeof value === 'number') {
          prev.t = 'n'
          prev.v = value
        } else if (typeof value === 'boolean') {
          prev.t = 'b'
          prev.v = value
        } else {
          prev.t = 's'
          prev.v = String(value)
        }
        replaced++
      }
    }
  }

  hf.destroy()
  return { replaced, failed, errors }
}
