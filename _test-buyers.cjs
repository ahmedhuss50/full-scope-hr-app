const XLSX = require('xlsx')
const fs = require('node:fs')

const TPL = 'lib/dsb/rega-templates/buyers-register.xlsx'
const wb = XLSX.read(fs.readFileSync(TPL), { cellFormula: true, cellStyles: true, cellDates: true })

function setCell(sheet, address, value, t) {
  const existing = sheet[address]
  const cell = existing ? { ...existing, v: value, w: undefined } : { v: value, t: t ?? (typeof value === 'number' ? 'n' : 's') }
  if ('f' in cell) delete cell.f
  if (t) cell.t = t
  sheet[address] = cell
  const ref = sheet['!ref'] ?? 'A1'
  const range = XLSX.utils.decode_range(ref)
  const addr = XLSX.utils.decode_cell(address)
  if (addr.r > range.e.r) range.e.r = addr.r
  if (addr.c > range.e.c) range.e.c = addr.c
  sheet['!ref'] = XLSX.utils.encode_range(range)
}

const ws = wb.Sheets['سجل المشترين وحدات قائمة']
console.log('Before setCell:')
console.log('  A7 =', JSON.stringify(ws['A7']))
console.log('  C7 =', JSON.stringify(ws['C7']))
console.log('  AC7 =', JSON.stringify(ws['AC7']))
console.log('  B7 =', JSON.stringify(ws['B7']))

setCell(ws, 'A7', 'م ', 's')
setCell(ws, 'B7', 'اسم العميل', 's')
setCell(ws, 'C7', 'نوع الـ ID ( أحوال وطنية ، إقامة ، جواز  ', 's')
setCell(ws, 'AC7', 'المبلغ المتبقي من قيمة الوحدة ', 's')

console.log('\nAfter setCell:')
console.log('  A7 =', JSON.stringify(ws['A7']))
console.log('  C7 =', JSON.stringify(ws['C7']))
console.log('  AC7 =', JSON.stringify(ws['AC7']))
console.log('  B7 =', JSON.stringify(ws['B7']))

const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true, compression: true })
fs.writeFileSync('/tmp/buyers-raw.xlsx', buf)
console.log('\nWrote raw buffer:', buf.length, 'bytes')

// Extract sheet1.xml from raw buffer and print row 7
const AdmZip = require('adm-zip')
const zip = new AdmZip(buf)
const sheet1 = zip.getEntry('xl/worksheets/sheet1.xml')
if (sheet1) {
  const xml = sheet1.getData().toString('utf8')
  const rowMatch = xml.match(/<row[^>]*r="7"[^>]*>(.*?)<\/row>/s)
  if (rowMatch) {
    console.log('\nRow 7 in RAW output (before mergeIntoTemplate):')
    const cells = rowMatch[1].match(/<c[^>]*r="[A-Z]+7"[^\/]*(?:\/>|>.*?<\/c>)/g)
    if (cells) for (const c of cells.slice(0, 6)) console.log(' ', c)
    console.log('  ...')
    for (const c of cells.slice(-3)) console.log(' ', c)
  }
}
