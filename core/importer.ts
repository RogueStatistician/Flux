/**
 * importer.ts — file parsing and schema inference for Excel / CSV uploads.
 * Uses SheetJS for file I/O. Fully Node.js compatible.
 */
import * as XLSX from 'xlsx'
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
  /** Column separator for CSV files (default: auto-detected by SheetJS). */
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

// ── Core parsing ──────────────────────────────────────────────────────────────

/**
 * Parse the first sheet of an Excel or CSV file into headers + rows.
 * @param maxRows  Maximum data rows to return (undefined = all rows).
 * @param options  Parsing options: separator (CSV only), skipRows (skip N rows before header).
 */
export function parseFile(
  filePath: string,
  maxRows?: number,
  options?: ParseOptions
): { headers: string[]; rows: Record<string, string>[] } {
  const buf = fs.readFileSync(filePath)
  // For CSV/TSV files there are no embedded cell-format strings, so raw: false
  // causes SheetJS to auto-interpret values (e.g. "01/01/1900" → "1/2/00").
  // Use raw: true for plain-text formats to preserve literal cell text.
  const isCsv = /\.(csv|tsv|txt)$/i.test(filePath)
  const readOpts: XLSX.ParsingOptions = { raw: isCsv, cellDates: false }
  if (options?.separator) readOpts.FS = options.separator
  const workbook = XLSX.read(buf, readOpts)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  })

  const headerRowIndex = options?.skipRows ?? 0
  const dataFirstRow = options?.dataStartRow ?? (headerRowIndex + 1)
  const startCol = options?.skipColumns ?? 0
  if (raw.length <= headerRowIndex) return { headers: [], rows: [] }

  const headers = (raw[headerRowIndex] as unknown[])
    .slice(startCol)
    .map(h => String(h ?? '').trim())
    .filter(Boolean)

  const end = maxRows !== undefined
    ? Math.min(raw.length, dataFirstRow + maxRows)
    : raw.length
  const rows = raw.slice(dataFirstRow, end).map(row => {
    const r = row as unknown[]
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = String(r[startCol + i] ?? '') })
    return obj
  })

  return { headers, rows }
}

/**
 * Parse only the header row of a file (for target template import).
 */
export function parseHeaders(filePath: string, options?: ParseOptions): string[] {
  return parseFile(filePath, 0, options).headers
}

/**
 * Parse every sheet in an Excel workbook (or the single sheet of a CSV).
 * Each entry contains the sheet name, headers, and all data rows.
 */
export function parseAllSheets(filePath: string): Array<{
  sheetName: string
  headers: string[]
  rows: Record<string, string>[]
}> {
  const buf = fs.readFileSync(filePath)
  const isCsv = /\.(csv|tsv|txt)$/i.test(filePath)
  const readOpts: XLSX.ParsingOptions = { raw: isCsv, cellDates: false }
  const workbook = XLSX.read(buf, readOpts)

  return workbook.SheetNames.map(sheetName => {
    const sheet = workbook.Sheets[sheetName]
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false })
    if (raw.length === 0) return { sheetName, headers: [], rows: [] }
    const headers = (raw[0] as unknown[]).map(h => String(h ?? '').trim()).filter(Boolean)
    const rows = raw.slice(1).map(row => {
      const r = row as unknown[]
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => { obj[h] = String(r[i] ?? '') })
      return obj
    })
    return { sheetName, headers, rows }
  })
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
