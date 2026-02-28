/**
 * importer.ts — file parsing and schema inference for Excel / CSV uploads.
 * Runs in the main process. Uses SheetJS for file I/O.
 */
import * as XLSX from 'xlsx'
import fs from 'fs'

// ── Types (mirrors src/types/index.ts InferredField) ─────────────────────────

type FieldType = 'string' | 'integer' | 'float' | 'date' | 'datetime' | 'picklist'

export interface InferredField {
  name: string
  displayName: string
  dataType: FieldType
  isRequired: boolean
  isNullable: boolean
  dateFormat?: string
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
 */
export function parseFile(
  filePath: string,
  maxRows?: number
): { headers: string[]; rows: Record<string, string>[] } {
  const buf = fs.readFileSync(filePath)
  const workbook = XLSX.read(buf, { raw: false, cellDates: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  })

  if (raw.length === 0) return { headers: [], rows: [] }

  const headers = (raw[0] as unknown[])
    .map(h => String(h ?? '').trim())
    .filter(Boolean)

  const end = maxRows !== undefined ? Math.min(raw.length, maxRows + 1) : raw.length
  const rows = raw.slice(1, end).map(row => {
    const r = row as unknown[]
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = String(r[i] ?? '') })
    return obj
  })

  return { headers, rows }
}

/**
 * Parse only the header row of a file (for target template import).
 */
export function parseHeaders(filePath: string): string[] {
  return parseFile(filePath, 0).headers
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
      displayName: header,
      dataType,
      isRequired: false,
      isNullable: true,
      ...(dateFormat ? { dateFormat } : {}),
    }
  })
}
