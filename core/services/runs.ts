/**
 * Runs service — query run records, issues, output preview and file copy.
 * executeTransformation and cancelRun live in core/engine.ts.
 */
import fs from 'fs'
import ExcelJS from 'exceljs'
import { parse as csvParseSync } from 'csv-parse/sync'
import { getDb } from '../db.js'

// ── DB row shapes ─────────────────────────────────────────────────────────────

interface RunRow {
  id: string
  transformation_id: string
  started_at: string
  completed_at: string | null
  status: string
  stats: string | null
  output_manifest: string | null
}

interface RunIssueRow {
  id: number
  run_id: string
  row_index: number | null
  field_name: string | null
  severity: string
  message: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeJsonParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return undefined }
}

function rowToRun(r: RunRow) {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    startedAt: r.started_at,
    completedAt: r.completed_at ?? undefined,
    status: r.status,
    stats: r.stats ? safeJsonParse(r.stats) : undefined,
    outputManifest: r.output_manifest ? safeJsonParse(r.output_manifest) : undefined,
  }
}

// ── Service functions ─────────────────────────────────────────────────────────

/** Get current DB state of a run (status, stats, manifest). */
export function getRun(runId: string) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined
  if (!row) throw new Error(`Run ${runId} not found.`)
  return rowToRun(row)
}

/** List runs, optionally filtered to a transformation. Most recent first. */
export function listRuns(transformationId?: string) {
  const db = getDb()
  const rows = transformationId
    ? (db.prepare('SELECT * FROM runs WHERE transformation_id = ? ORDER BY started_at DESC').all(transformationId) as RunRow[])
    : (db.prepare('SELECT * FROM runs ORDER BY started_at DESC').all() as RunRow[])
  return rows.map(rowToRun)
}

/** Get run issues, optionally filtered by severity. */
export function getRunIssues(runId: string, severity?: string) {
  const db = getDb()
  const rows: RunIssueRow[] = severity
    ? (db.prepare('SELECT * FROM run_issues WHERE run_id = ? AND severity = ? ORDER BY id ASC').all(runId, severity) as RunIssueRow[])
    : (db.prepare('SELECT * FROM run_issues WHERE run_id = ? ORDER BY id ASC').all(runId) as RunIssueRow[])
  return rows.map(r => ({
    id: r.id,
    runId: r.run_id,
    rowIndex: r.row_index ?? undefined,
    fieldName: r.field_name ?? undefined,
    severity: r.severity,
    message: r.message,
  }))
}

/** Return the first `limit` rows of an output file for preview. */
export async function previewOutput(runId: string, targetObjectId: string, limit = 100) {
  const db = getDb()
  const runRow = db.prepare('SELECT output_manifest FROM runs WHERE id = ?').get(runId) as
    | { output_manifest: string | null }
    | undefined
  if (!runRow?.output_manifest) throw new Error('No output manifest for this run.')

  let manifest: { targets: Array<{ objectId: string; filePath: string; format: string }> }
  try {
    manifest = JSON.parse(runRow.output_manifest) as typeof manifest
  } catch {
    throw new Error('Output manifest is corrupted. Re-run the transformation.')
  }
  const target = manifest.targets.find(t => t.objectId === targetObjectId)
  if (!target) throw new Error('Target not found in manifest.')
  if (!fs.existsSync(target.filePath)) throw new Error('Output file has been cleaned up. Re-run the transformation.')

  // Look up the target object to determine where headers and data rows live in the output file.
  // Template-based outputs preserve preamble rows from the original template, so row 0 of the
  // file is NOT necessarily the header row.
  const objRow = db.prepare(
    'SELECT template_header_row, template_data_start_row FROM data_objects WHERE id = ?'
  ).get(targetObjectId) as { template_header_row: number | null; template_data_start_row: number | null } | undefined

  // 0-based offsets: headerRow defaults to 0 (first row), dataStartRow defaults to headerRow + 1
  const headerRow    = objRow?.template_header_row    ?? 0
  const dataStartRow = objRow?.template_data_start_row ?? (headerRow + 1)

  let headers: string[]
  let dataRows: string[][]

  if (target.format === 'csv') {
    const content = fs.readFileSync(target.filePath, 'utf-8')
    // CSV output is always written by the engine with headers in row 0, data from row 1.
    const parsed = csvParseSync(content, {
      skip_empty_lines: true, relax_quotes: true, relax_column_count: true, cast: false,
    }) as string[][]
    headers  = (parsed[0] ?? []).map(h => String(h ?? '').trim())
    dataRows = parsed.slice(1)
  } else {
    const buf = fs.readFileSync(target.filePath)
    const wb = new ExcelJS.Workbook()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buf as any)
    const ws = wb.getWorksheet(1)
    if (!ws) return { headers: [], rows: [], totalRows: 0 }

    // Use includeEmpty:true so every row has a stable position in rawRows (row N in the
    // workbook = rawRows[N-1], no preamble skipping surprises).
    const rawRows: string[][] = []
    ws.eachRow({ includeEmpty: true }, excelRow => {
      const vals = (excelRow.values as (ExcelJS.CellValue | undefined)[]).slice(1)
      rawRows.push(vals.map(v => {
        if (v === null || v === undefined) return ''
        if (v instanceof Date) return v.toISOString().split('T')[0]
        if (typeof v === 'object') {
          if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map(r => r.text).join('')
          if ('formula' in v || 'sharedFormula' in v) return String((v as ExcelJS.CellFormulaValue).result ?? '')
          if ('hyperlink' in v) return String((v as ExcelJS.CellHyperlinkValue).text ?? '')
        }
        return String(v)
      }))
    })

    headers  = (rawRows[headerRow] ?? []).map(h => String(h ?? '').trim())
    dataRows = rawRows.slice(dataStartRow)
  }

  // Build rows using column index as key — safe against duplicate or empty header names.
  const slicedDataRows = dataRows.slice(0, limit)
  const rows = slicedDataRows.map(dataRow => {
    const out: Record<string, string> = {}
    headers.forEach((_h, i) => { out[String(i)] = String(dataRow[i] ?? '') })
    return out
  })

  return { headers, rows, totalRows: dataRows.length }
}

/** Copy an output file to a user-chosen destination path. */
export function copyOutputFile(runId: string, targetObjectId: string, destPath: string) {
  const db = getDb()
  const row = db.prepare('SELECT output_manifest FROM runs WHERE id = ?').get(runId) as
    | { output_manifest: string | null }
    | undefined
  if (!row?.output_manifest) throw new Error('No output manifest for this run.')

  let manifest: { targets: Array<{ objectId: string; filePath: string }> }
  try {
    manifest = JSON.parse(row.output_manifest) as typeof manifest
  } catch {
    throw new Error('Output manifest is corrupted. Re-run the transformation.')
  }
  const target = manifest.targets.find(t => t.objectId === targetObjectId)
  if (!target) throw new Error('Target output not found in manifest.')
  if (!fs.existsSync(target.filePath)) throw new Error('Output file has been cleaned up. Re-run the transformation.')

  fs.copyFileSync(target.filePath, destPath)
}
