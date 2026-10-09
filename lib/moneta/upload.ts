import ExcelJS from 'exceljs'
import { MonetaShapeError, parseCsv, parseExportRows, type MonetaCart } from './parse'

/** Read a portal Shopping Cart export (.xlsx or .csv) into carts. */
export async function parseExportFile(
  fileName: string,
  bytes: ArrayBuffer,
  knownNames: Iterable<string>,
  machineIds?: Map<string, string>,
): Promise<MonetaCart[]> {
  if (/\.csv$/i.test(fileName)) {
    return parseExportRows(parseCsv(new TextDecoder().decode(bytes)), knownNames, machineIds)
  }
  if (!/\.xlsx$/i.test(fileName)) throw new MonetaShapeError('Upload a .xlsx or .csv export from the Moneta portal')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes)
  const ws = wb.worksheets[0]
  if (!ws) throw new MonetaShapeError('The workbook has no sheets')
  const grid: unknown[][] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    // row.values is 1-indexed with an empty slot 0.
    grid.push((row.values as unknown[]).slice(1))
  })
  return parseExportRows(grid, knownNames, machineIds)
}
