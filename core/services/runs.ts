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
  const row = db.prepare('SELECT output_manifest FROM runs WHERE id = ?').get(runId) as
    | { output_manifest: string | null }
    | undefined
  if (!row?.output_manifest) throw new Error('No output manifest for this run.')

  let manifest: { targets: Array<{ objectId: string; filePath: string; format: string }> }
  try {
    manifest = JSON.parse(row.output_manifest) as typeof manifest
  } catch {
    throw new Error('Output manifest is corrupted. Re-run the transformation.')
  }
  const target = manifest.targets.find(t => t.objectId === targetObjectId)
  if (!target) throw new Error('Target not found in manifest.')
  if (!fs.existsSync(target.filePath)) throw new Error('Output file has been cleaned up. Re-run the transformation.')

  let headers: string[]
  let allDataRows: Record<string, string>[]

  if (target.format === 'csv') {
    const content = fs.readFileSync(target.filePath, 'utf-8')
    const parsed = csvParseSync(content, {
      skip_empty_lines: true, relax_quotes: true, relax_column_count: true, cast: false,
    }) as string[][]
    headers = (parsed[0] ?? []).map(h => String(h ?? '').trim())
    allDataRows = parsed.slice(1).map(row =>
      Object.fromEntries(headers.map((h, i) => [h, String(row[i] ?? '')]))
    )
  } else {
    const buf = fs.readFileSync(target.filePath)
    const wb = new ExcelJS.Workbook()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buf as any)
    const ws = wb.getWorksheet(1)
    if (!ws) return { headers: [], rows: [], totalRows: 0 }
    const rawRows: string[][] = []
    ws.eachRow({ includeEmpty: false }, row => {
      const vals = (row.values as (ExcelJS.CellValue | undefined)[]).slice(1)
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
    headers = (rawRows[0] ?? []).map(h => String(h ?? '').trim())
    allDataRows = rawRows.slice(1).map(row =>
      Object.fromEntries(headers.map((h, i) => [h, String(row[i] ?? '')]))
    )
  }

  const previewRows = allDataRows.slice(0, limit)
  // Use numeric index keys so duplicate/empty column names don't collide in the row objects
  const rows = previewRows.map(r => {
    const out: Record<string, string> = {}
    headers.forEach((h, i) => { out[String(i)] = r[h] ?? '' })
    return out
  })
  return { headers, rows, totalRows: allDataRows.length }
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
