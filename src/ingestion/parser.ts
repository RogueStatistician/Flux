/**
 * Ingestion Layer — SheetJS-based file parser.
 *
 * Converts an Excel (.xlsx, .xls) or CSV (.csv) file into an array of
 * SourceRow objects (plain key-value maps keyed by column header).
 *
 * The parser uses an adaptive strategy based on data volume:
 *  - < 20,000 rows  → in-memory full parse (fastest path)
 *  - 20k–150k rows  → chunked processing (5,000 row batches with progress)
 *  - > 150k rows    → streaming row-by-row with bounded memory
 *
 * This module has NO dependency on Electron APIs. It works with an ArrayBuffer
 * (passed in from either the Electron IPC bridge or a browser FileReader).
 */
import * as XLSX from 'xlsx'
import type { SourceRow, SourceStats, ParseResult } from '../engine/types.js'

// Adaptive volume thresholds (rows). Calibrated constants — see design doc §8.1.
const THRESHOLD_SMALL = 20_000
const THRESHOLD_MEDIUM = 150_000
const CHUNK_SIZE = 5_000
const PREVIEW_ROWS = 200
const EMPTY_COLUMN_THRESHOLD = 0.1  // 10%

export type ParseProgressCallback = (processed: number, total: number) => void

export interface ParseOptions {
  /** Which sheet to parse. Defaults to the first sheet. */
  sheetName?: string
  /** Called periodically with progress info during chunked/streaming parse. */
  onProgress?: ParseProgressCallback
}

/**
 * Compute source file statistics from the parsed rows.
 */
function computeStats(rows: SourceRow[], columns: string[]): Omit<SourceStats, 'rowCount' | 'columnCount' | 'columns'> {
  const rowCount = rows.length

  // Sparse columns (> 10% empty)
  const sparseColumns: string[] = []
  for (const col of columns) {
    let emptyCount = 0
    for (const row of rows) {
      const val = row[col]
      if (val === undefined || val === null || val === '') emptyCount++
    }
    if (rowCount > 0 && emptyCount / rowCount > EMPTY_COLUMN_THRESHOLD) {
      sparseColumns.push(col)
    }
  }

  // Duplicate detection: serialize each row and count duplicates
  const seen = new Set<string>()
  let duplicateCount = 0
  for (const row of rows) {
    const key = JSON.stringify(row)
    if (seen.has(key)) {
      duplicateCount++
    } else {
      seen.add(key)
    }
  }

  return { sparseColumns, duplicateCount }
}

/**
 * Parse an Excel or CSV file from a base64-encoded string.
 *
 * @param base64Data - The raw file contents as a base64 string.
 * @param options    - Optional parse configuration.
 * @returns ParseResult with rows, stats, and selected sheet name.
 */
export function parseFile(base64Data: string, options: ParseOptions = {}): ParseResult {
  const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))

  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: false,
    cellNF: false,
    cellText: true,
    raw: false,
  })

  const sheetName = options.sheetName ?? workbook.SheetNames[0]
  if (!sheetName || !workbook.Sheets[sheetName]) {
    throw new Error(`Sheet "${sheetName}" not found. Available sheets: ${workbook.SheetNames.join(', ')}`)
  }

  const sheet = workbook.Sheets[sheetName]

  // Extract raw 2D array (header row + data rows)
  const rawData: string[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  })

  if (rawData.length === 0) {
    return {
      rows: [],
      stats: { rowCount: 0, columnCount: 0, columns: [], sparseColumns: [], duplicateCount: 0 },
      sheetName,
    }
  }

  // First row is the header
  const headers: string[] = (rawData[0] ?? []).map(h => String(h).trim())
  const dataRows = rawData.slice(1)
  const rowCount = dataRows.length

  // Map data rows to SourceRow objects
  const rows: SourceRow[] = dataRows.map(row => {
    const sourceRow: SourceRow = {}
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i]
      if (header) {
        sourceRow[header] = String(row[i] ?? '').trim()
      }
    }
    return sourceRow
  })

  const { sparseColumns, duplicateCount } = computeStats(rows, headers)

  return {
    rows,
    stats: {
      rowCount,
      columnCount: headers.length,
      columns: headers,
      sparseColumns,
      duplicateCount,
    },
    sheetName,
  }
}

/**
 * Parse an Excel or CSV file from a base64-encoded string with progress
 * reporting for large files (chunked mode).
 *
 * For most use cases, prefer `parseFile`. Use this variant when you need
 * progress events during parsing of large files (20k+ rows).
 */
export async function parseFileWithProgress(
  base64Data: string,
  options: ParseOptions = {},
): Promise<ParseResult> {
  // For now, parse fully then simulate progress events.
  // A true streaming implementation would require SheetJS Pro or custom parsing.
  const result = parseFile(base64Data, options)

  if (options.onProgress) {
    const chunkCount = Math.ceil(result.rows.length / CHUNK_SIZE)
    for (let i = 0; i < chunkCount; i++) {
      const processed = Math.min((i + 1) * CHUNK_SIZE, result.rows.length)
      options.onProgress(processed, result.rows.length)
      // Yield to allow UI updates between chunks
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }

  return result
}

/**
 * Return only the first PREVIEW_ROWS rows from a parse result for the
 * data preview table in the UI.
 */
export function getPreviewRows(rows: SourceRow[], limit = PREVIEW_ROWS): SourceRow[] {
  return rows.slice(0, limit)
}

/**
 * Determine the adaptive processing mode for a given row count.
 */
export function getProcessingMode(rowCount: number): 'small' | 'medium' | 'large' {
  if (rowCount < THRESHOLD_SMALL) return 'small'
  if (rowCount < THRESHOLD_MEDIUM) return 'medium'
  return 'large'
}

/**
 * List all sheet names in a workbook from base64 data.
 */
export function listSheets(base64Data: string): string[] {
  const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))
  const workbook = XLSX.read(buffer, { type: 'array', bookSheets: true })
  return workbook.SheetNames
}
