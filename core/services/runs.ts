/**
 * Runs service — query run records, issues, output preview and file copy.
 * executeTransformation and cancelRun live in core/engine.ts.
 */
import fs from 'fs'
import * as XLSX from 'xlsx'
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

function rowToRun(r: RunRow) {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    startedAt: r.started_at,
    completedAt: r.completed_at ?? undefined,
    status: r.status,
    stats: r.stats ? (JSON.parse(r.stats) as unknown) : undefined,
    outputManifest: r.output_manifest ? (JSON.parse(r.output_manifest) as unknown) : undefined,
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
export function previewOutput(runId: string, targetObjectId: string, limit = 100) {
  const db = getDb()
  const row = db.prepare('SELECT output_manifest FROM runs WHERE id = ?').get(runId) as
    | { output_manifest: string | null }
    | undefined
  if (!row?.output_manifest) throw new Error('No output manifest for this run.')

  const manifest = JSON.parse(row.output_manifest) as {
    targets: Array<{ objectId: string; filePath: string; format: string }>
  }
  const target = manifest.targets.find(t => t.objectId === targetObjectId)
  if (!target) throw new Error('Target not found in manifest.')
  if (!fs.existsSync(target.filePath)) throw new Error('Output file has been cleaned up. Re-run the transformation.')

  let wb: XLSX.WorkBook
  if (target.format === 'csv') {
    const content = fs.readFileSync(target.filePath, 'utf-8')
    wb = XLSX.read(content, { type: 'string' })
  } else {
    const buf = fs.readFileSync(target.filePath)
    wb = XLSX.read(buf, { raw: false, cellDates: false })
  }

  const ws = wb.Sheets[wb.SheetNames[0]]
  const allRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
  const previewRows = allRows.slice(0, limit)
  const allHeaders = previewRows.length > 0 ? Object.keys(previewRows[0]) : []
  // Map __EMPTY* keys to '' for display; use numeric index keys in row objects
  // so duplicate empty headers don't overwrite each other's values.
  const headers = allHeaders.map(h => h.startsWith('__EMPTY') ? '' : h)
  const rows = previewRows.map(r => {
    const out: Record<string, string> = {}
    for (let i = 0; i < allHeaders.length; i++) {
      out[String(i)] = String(r[allHeaders[i]] ?? '')
    }
    return out
  })

  return { headers, rows, totalRows: allRows.length }
}

/** Copy an output file to a user-chosen destination path. */
export function copyOutputFile(runId: string, targetObjectId: string, destPath: string) {
  const db = getDb()
  const row = db.prepare('SELECT output_manifest FROM runs WHERE id = ?').get(runId) as
    | { output_manifest: string | null }
    | undefined
  if (!row?.output_manifest) throw new Error('No output manifest for this run.')

  const manifest = JSON.parse(row.output_manifest) as {
    targets: Array<{ objectId: string; filePath: string }>
  }
  const target = manifest.targets.find(t => t.objectId === targetObjectId)
  if (!target) throw new Error('Target output not found in manifest.')
  if (!fs.existsSync(target.filePath)) throw new Error('Output file has been cleaned up. Re-run the transformation.')

  fs.copyFileSync(target.filePath, destPath)
}
