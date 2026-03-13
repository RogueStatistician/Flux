/**
 * importer.ts — file parsing and schema inference for Excel / CSV uploads.
 * Uses ExcelJS for .xlsx/.xls files and csv-parse for .csv/.tsv/.txt files.
 * All parse functions are async.
 */
import ExcelJS from 'exceljs'
import { parse as csvParseSync } from 'csv-parse/sync'
import fs from 'fs'

// ── Types (mirrors src/types/index.ts InferredField) ─────────────────────────

type FieldType = 'string' | 'integer' | 'float' | 'date' | 'datetime' | 'picklist'

export interface InferredField {
  name: string
  dataType: FieldType
  isRequired: boolean
  isNullable: boolean
  dateFormat?: string
}

export interface ParseOptions {
  /** Column separator for CSV files (default: auto-detected). */
  separator?: string
  /**
   * 0-based index of the row that contains column headers (default: 0).
   * All rows before this index are treated as preamble and are ignored during
   * schema inference / row import (but preserved in template-based output).
   */
  skipRows?: number
  /**
   * 0-based index of the first row that contains actual data (default: skipRows + 1).
   * Use when there are rows between the header and the first data row (e.g. example
   * rows, sub-headers) that should be skipped.
   */
  dataStartRow?: number
  /**
   * Number of leading columns to skip (default: 0).
   * Columns to the left of this offset are excluded from headers and row data.
   */
  skipColumns?: number
}

// ── Date pattern library ──────────────────────────────────────────────────────

const DATE_PATTERNS: { re: RegExp; fmt: string }[] = [
  { re: /^\d{4}-\d{2}-\d{2}$/, fmt: 'YYYY-MM-DD' },
  { re: /^\d{4}\/\d{2}\/\d{2}$/, fmt: 'YYYY/MM/DD' },
  { re: /^\d{2}\/\d{2}\/\d{4}$/, fmt: 'DD/MM/YYYY' },
  { re: /^\d{2}-\d{2}-\d{4}$/, fmt: 'DD-MM-YYYY' },
  { re: /^\d{1,2}\/\d{1,2}\/\d{4}$/, fmt: 'M/D/YYYY' },
  { re: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, fmt: 'ISO8601' },
]

// ── ExcelJS cell → string ─────────────────────────────────────────────────────

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().split('T')[0]
  if (typeof v === 'object') {
    // Rich text
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map(r => r.text).join('')
    // Hyperlink
    if ('hyperlink' in v) return String((v as ExcelJS.CellHyperlinkValue).text ?? '')
    // Formula with result
    if ('formula' in v || 'sharedFormula' in v) {
      const result = (v as ExcelJS.CellFormulaValue).result
      if (result instanceof Date) return result.toISOString().split('T')[0]
      return result !== undefined && result !== null ? String(result) : ''
    }
    // Error value
    if ('error' in v) return ''
  }
  return String(v)
}

// ── Core parsing ──────────────────────────────────────────────────────────────

/** Read all rows from the first sheet of a file as a 2-D string array. */
async function readRawRows(filePath: string, separator?: string): Promise<string[][]> {
  const isCsv = /\.(csv|tsv|txt)$/i.test(filePath)

  if (isCsv) {
    const content = fs.readFileSync(filePath, 'utf-8')
    const sep = separator ?? ','
    const parsed = csvParseSync(content, {
      delimiter: sep,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      cast: false,
    }) as string[][]
    return parsed
  }

  const buf = fs.readFileSync(filePath)
  const wb = new ExcelJS.Workbook()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buf as any)
  const ws = wb.getWorksheet(1)
  if (!ws) return []

  const rows: string[][] = []
  ws.eachRow({ includeEmpty: true }, row => {
    // row.values[0] is undefined (ExcelJS uses 1-based indexing)
    const vals = (row.values as (ExcelJS.CellValue | undefined)[]).slice(1)
    rows.push(vals.map(v => cellToString(v ?? null)))
  })
  return rows
}

/**
 * Parse the first sheet of an Excel or CSV file into headers + rows.
 * @param maxRows  Maximum data rows to return (undefined = all rows).
 * @param options  Parsing options.
 */
export async function parseFile(
  filePath: string,
  maxRows?: number,
  options?: ParseOptions
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const rawRows = await readRawRows(filePath, options?.separator)

  const headerRowIndex = options?.skipRows ?? 0
  const dataFirstRow = options?.dataStartRow ?? (headerRowIndex + 1)
  const startCol = options?.skipColumns ?? 0

  if (rawRows.length <= headerRowIndex) return { headers: [], rows: [] }

  const headers = rawRows[headerRowIndex]
    .slice(startCol)
    .map(h => String(h ?? '').trim())
    .filter(Boolean)

  const end = maxRows !== undefined
    ? Math.min(rawRows.length, dataFirstRow + maxRows)
    : rawRows.length
  const rows = rawRows.slice(dataFirstRow, end).map(row => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = String(row[startCol + i] ?? '') })
    return obj
  })

  return { headers, rows }
}

/**
 * Parse only the header row of a file (for target template import).
 */
export async function parseHeaders(filePath: string, options?: ParseOptions): Promise<string[]> {
  return (await parseFile(filePath, 0, options)).headers
}

/**
 * Parse every sheet in an Excel workbook (or the single sheet of a CSV).
 * Each entry contains the sheet name, headers, and all data rows.
 */
export async function parseAllSheets(filePath: string): Promise<Array<{
  sheetName: string
  headers: string[]
  rows: Record<string, string>[]
}>> {
  const isCsv = /\.(csv|tsv|txt)$/i.test(filePath)

  if (isCsv) {
    const { headers, rows } = await parseFile(filePath)
    const sheetName = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'Sheet1'
    return [{ sheetName, headers, rows }]
  }

  const buf = fs.readFileSync(filePath)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)

  const results: Array<{ sheetName: string; headers: string[]; rows: Record<string, string>[] }> = []
  wb.eachSheet(ws => {
    const rawRows: string[][] = []
    ws.eachRow({ includeEmpty: false }, row => {
      const vals = (row.values as (ExcelJS.CellValue | undefined)[]).slice(1)
      rawRows.push(vals.map(v => cellToString(v ?? null)))
    })
    if (rawRows.length === 0) { results.push({ sheetName: ws.name, headers: [], rows: [] }); return }
    const headers = rawRows[0].map(h => String(h ?? '').trim()).filter(Boolean)
    const rows = rawRows.slice(1).map(row => {
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => { obj[h] = String(row[i] ?? '') })
      return obj
    })
    results.push({ sheetName: ws.name, headers, rows })
  })
  return results
}

// ── Schema inference ──────────────────────────────────────────────────────────

/**
 * Infer a field schema from header names and a sample of data rows.
 * Uses up to 200 rows for type inference.
 */
export function inferSchema(
  headers: string[],
  rows: Record<string, string>[]
): InferredField[] {
  return headers.map(header => {
    const values = rows
      .map(r => r[header] ?? '')
      .filter(v => v.trim() !== '')

    let dataType: FieldType = 'string'
    let dateFormat: string | undefined

    if (values.length > 0) {
      if (values.every(v => /^-?\d+$/.test(v.trim()))) {
        dataType = 'integer'
      } else if (values.every(v => /^-?\d*\.\d+$|^-?\d+\.\d*$/.test(v.trim()))) {
        dataType = 'float'
      } else {
        const dtMatch = DATE_PATTERNS.find(p => values.every(v => p.re.test(v.trim())))
        if (dtMatch) {
          dataType = dtMatch.fmt === 'ISO8601' ? 'datetime' : 'date'
          dateFormat = dtMatch.fmt
        } else {
          const distinct = new Set(values).size
          if (distinct <= 50 && distinct / values.length < 0.05) {
            dataType = 'picklist'
          }
        }
      }
    }

    return {
      name: header,
      dataType,
      isRequired: false,
      isNullable: true,
      ...(dateFormat ? { dateFormat } : {}),
    }
  })
}
