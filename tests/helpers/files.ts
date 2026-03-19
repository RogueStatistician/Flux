/**
 * Test file helpers — create temporary Excel and CSV files for use in tests.
 * All files are written to os.tmpdir() and should be cleaned up after use.
 */
import ExcelJS from 'exceljs'
import os from 'os'
import path from 'path'
import fs from 'fs'

/** Write a simple single-sheet XLSX with the given rows (first row = headers). */
export async function createXlsx(
  rows: (string | number | Date | null)[][],
  sheetName = 'Sheet1',
): Promise<string> {
  const filePath = path.join(
    os.tmpdir(),
    `flux-test-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`
  )
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName)
  for (const row of rows) ws.addRow(row)
  await wb.xlsx.writeFile(filePath)
  return filePath
}

/** Write a multi-sheet XLSX. sheets is a map of sheetName → rows. */
export async function createMultiSheetXlsx(
  sheets: Record<string, (string | number | null)[][]>
): Promise<string> {
  const filePath = path.join(
    os.tmpdir(),
    `flux-test-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`
  )
  const wb = new ExcelJS.Workbook()
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name)
    for (const row of rows) ws.addRow(row)
  }
  await wb.xlsx.writeFile(filePath)
  return filePath
}

/** Write a plain CSV file with the given content string. */
export function createCsv(content: string): string {
  const filePath = path.join(
    os.tmpdir(),
    `flux-test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`
  )
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

/** Delete a temp file, ignoring errors if already gone. */
export function cleanupFile(filePath: string): void {
  try { fs.unlinkSync(filePath) } catch { /* ignore */ }
}

/** Delete an entire directory tree, ignoring errors. */
export function cleanupDir(dirPath: string): void {
  try { fs.rmSync(dirPath, { recursive: true, force: true }) } catch { /* ignore */ }
}
