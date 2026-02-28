/**
 * Run & export IPC handlers.
 */
import { ipcMain } from 'electron'
import fs from 'fs'
import { getDb } from '../db.js'
import { executeTransformation, cancelRun } from '../engine.js'

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

// ── Registration ──────────────────────────────────────────────────────────────

export function registerRunHandlers(): void {

  /** Start a new transformation run. Returns runId immediately. */
  ipcMain.handle('run:start', async (_e, transformationId: string) => {
    return executeTransformation(transformationId)
  })

  /** Cancel an in-progress run. */
  ipcMain.handle('run:cancel', async (_e, runId: string) => {
    cancelRun(runId)
  })

  /** Get current DB state of a run (status, stats, manifest). */
  ipcMain.handle('run:get', async (_e, runId: string) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined
    if (!row) throw new Error(`Run ${runId} not found.`)
    return rowToRun(row)
  })

  /** List runs, optionally filtered to a transformation. Most recent first. */
  ipcMain.handle('run:list', async (_e, transformationId?: string) => {
    const db = getDb()
    const rows = transformationId
      ? (db.prepare('SELECT * FROM runs WHERE transformation_id = ? ORDER BY started_at DESC').all(transformationId) as RunRow[])
      : (db.prepare('SELECT * FROM runs ORDER BY started_at DESC').all() as RunRow[])
    return rows.map(rowToRun)
  })

  /** Get run issues, optionally filtered by severity. */
  ipcMain.handle('run:getIssues', async (_e, runId: string, severity?: string) => {
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
  })

  /** Copy an output file to a user-chosen destination path. */
  ipcMain.handle('export:saveOutput', async (_e, runId: string, targetObjectId: string, destPath: string) => {
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
  })
}
