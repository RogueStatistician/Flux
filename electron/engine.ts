/**
 * Transformation execution engine.
 *
 * Runs entirely in the main process (Node.js / better-sqlite3).
 * Applies field-mapping rules row-by-row, writes output files to a temp
 * directory, then stores run metadata + issues in the SQLite DB.
 *
 * Progress events are pushed to all open BrowserWindows via IPC.
 */
import { app, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import * as XLSX from 'xlsx'
import { getDb } from './db.js'

// ── DB row shapes ─────────────────────────────────────────────────────────────

interface FieldMappingRow {
  id: string
  transformation_id: string
  target_object_id: string
  target_field_id: string
  rule_type: string
  rule_config: string
  notes: string | null
}

interface ObjectRow {
  id: string
  name: string
  output_format: string
}

interface ObjectFieldRow {
  id: string
  name: string
  display_name: string | null
  data_type: string
  is_required: number
  position: number
}

interface SourceRowDB {
  row_index: number
  data: string
}

// ── Output manifest ───────────────────────────────────────────────────────────

export interface OutputManifestTarget {
  objectId: string
  objectName: string
  format: string
  filePath: string
  rowCount: number
}

export interface OutputManifest {
  targets: OutputManifestTarget[]
}

// ── Active run tracking ───────────────────────────────────────────────────────

const activeRuns = new Map<string, { cancelled: boolean }>()

// ── Progress push ─────────────────────────────────────────────────────────────

function sendProgress(runId: string, payload: Record<string, unknown>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('run:progress', { runId, ...payload })
    }
  }
}

// ── Rule applicators ──────────────────────────────────────────────────────────

function applyDirect(
  cfg: { sourceFieldName: string },
  row: Record<string, string>,
): string {
  return row[cfg.sourceFieldName] ?? ''
}

function applyConstant(cfg: { value: string }): string {
  return cfg.value ?? ''
}

function applyUUID(): string {
  return crypto.randomUUID()
}

function applyConcat(
  cfg: { parts?: Array<{ type: 'field'; sourceFieldName: string } | { type: 'literal'; value: string }> },
  row: Record<string, string>,
): string {
  return (cfg.parts ?? []).map(p =>
    p.type === 'field' ? (row[p.sourceFieldName] ?? '') : (p.value ?? '')
  ).join('')
}

function applySplit(
  cfg: { sourceFieldName: string; delimiter?: string; index?: number },
  row: Record<string, string>,
): string {
  const val = row[cfg.sourceFieldName] ?? ''
  const parts = val.split(cfg.delimiter ?? ' ')
  return parts[cfg.index ?? 0] ?? ''
}

function applySubstring(
  cfg: { sourceFieldName: string; start?: number; length?: number },
  row: Record<string, string>,
): string {
  const val = row[cfg.sourceFieldName] ?? ''
  const start = cfg.start ?? 0
  return cfg.length !== undefined
    ? val.substring(start, start + cfg.length)
    : val.substring(start)
}

function applyDateFormat(
  cfg: { sourceFieldName: string; outputFormat?: string },
  row: Record<string, string>,
): string {
  const val = row[cfg.sourceFieldName] ?? ''
  if (!val) return ''
  try {
    const d = new Date(val)
    if (isNaN(d.getTime())) return val
    const fmt = cfg.outputFormat ?? 'YYYY-MM-DD'
    const year  = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day   = String(d.getDate()).padStart(2, '0')
    return fmt
      .replace('YYYY', String(year))
      .replace('MM', month)
      .replace('DD', day)
  } catch {
    return val
  }
}

function applyPicklistTranslate(
  cfg: { sourceFieldName: string; mappingId?: string; fallback?: string },
  row: Record<string, string>,
  picklistMaps: Map<string, Map<string, string>>,
): string {
  const val = row[cfg.sourceFieldName] ?? ''
  if (!cfg.mappingId) return val
  const map = picklistMaps.get(cfg.mappingId)
  return map?.get(val) ?? cfg.fallback ?? val
}

function applyExpression(
  cfg: { expression: string },
  row: Record<string, string>,
  rowIndex: number,
): string {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('row', 'rowIndex', `"use strict"; return (${cfg.expression})`)
    const result = fn(row, rowIndex)
    return result !== undefined && result !== null ? String(result) : ''
  } catch {
    return ''
  }
}

function applyIncremental(cfg: { start?: number; step?: number }, rowIndex: number): string {
  return String((cfg.start ?? 1) + rowIndex * (cfg.step ?? 1))
}

// ── Main execute function ──────────────────────────────────────────────────────

/**
 * Start a transformation run asynchronously.
 * Creates a run record in the DB, begins execution, returns the runId immediately.
 */
export async function executeTransformation(transformationId: string): Promise<string> {
  const db = getDb()
  const runId = crypto.randomUUID()
  const startedAt = new Date().toISOString()

  db.prepare(`
    INSERT INTO runs (id, transformation_id, started_at, status)
    VALUES (?, ?, ?, 'running')
  `).run(runId, transformationId, startedAt)

  activeRuns.set(runId, { cancelled: false })

  // Run the engine in the next event-loop tick so we can return runId first
  setImmediate(() => {
    _runEngine(runId, transformationId).catch(err => {
      console.error('[engine] Unhandled error:', err)
      try {
        getDb().prepare(
          `UPDATE runs SET status = 'failed', completed_at = ? WHERE id = ?`
        ).run(new Date().toISOString(), runId)
      } catch { /* ignore */ }
      sendProgress(runId, { status: 'failed', error: String(err) })
      activeRuns.delete(runId)
    })
  })

  return runId
}

async function _runEngine(runId: string, transformationId: string): Promise<void> {
  const db = getDb()
  const runState = activeRuns.get(runId)!

  sendProgress(runId, { status: 'running', phase: 'loading' })

  // ── Load field mappings ──────────────────────────────────────────────────────

  const mappingRows = db.prepare(
    'SELECT * FROM field_mappings WHERE transformation_id = ?'
  ).all(transformationId) as FieldMappingRow[]

  if (mappingRows.length === 0) {
    throw new Error('No field mappings defined for this transformation.')
  }

  // Group mappings by target object
  const byTarget = new Map<string, FieldMappingRow[]>()
  for (const m of mappingRows) {
    if (!byTarget.has(m.target_object_id)) byTarget.set(m.target_object_id, [])
    byTarget.get(m.target_object_id)!.push(m)
  }

  // Pre-load any picklist maps needed
  const picklistMaps = new Map<string, Map<string, string>>()
  for (const m of mappingRows) {
    if (m.rule_type === 'picklisttranslate') {
      const cfg = JSON.parse(m.rule_config) as { mappingId?: string }
      const mid = cfg.mappingId
      if (mid && !picklistMaps.has(mid)) {
        const entries = db.prepare(
          'SELECT source_key, target_key FROM picklist_mapping_entries WHERE mapping_id = ?'
        ).all(mid) as { source_key: string; target_key: string }[]
        const map = new Map<string, string>()
        for (const e of entries) map.set(e.source_key, e.target_key)
        picklistMaps.set(mid, map)
      }
    }
  }

  // ── Temp output directory ────────────────────────────────────────────────────

  const tempDir = path.join(app.getPath('temp'), 'flux-runs', runId)
  fs.mkdirSync(tempDir, { recursive: true })

  const manifest: OutputManifest = { targets: [] }
  let totalRowsProcessed = 0
  let totalIssues = 0

  const insertIssue = db.prepare(`
    INSERT INTO run_issues (run_id, row_index, field_name, severity, message)
    VALUES (?, ?, ?, ?, ?)
  `)

  // ── Process each target object ───────────────────────────────────────────────

  for (const [targetObjectId, fieldMappings] of byTarget) {
    if (runState.cancelled) break

    const targetObj = db.prepare(
      'SELECT * FROM data_objects WHERE id = ?'
    ).get(targetObjectId) as ObjectRow | undefined
    if (!targetObj) continue

    const targetFields = db.prepare(
      'SELECT * FROM object_fields WHERE object_id = ? ORDER BY position ASC'
    ).all(targetObjectId) as ObjectFieldRow[]

    const fmByFieldId = new Map<string, FieldMappingRow>()
    for (const fm of fieldMappings) fmByFieldId.set(fm.target_field_id, fm)

    // ── Determine primary source object ───────────────────────────────────────

    let primarySourceObjectId: string | null = null
    const sourceRefTypes = new Set(['direct', 'concat', 'split', 'substring', 'dateformat', 'picklisttranslate', 'expression'])
    for (const fm of fieldMappings) {
      if (sourceRefTypes.has(fm.rule_type)) {
        const cfg = JSON.parse(fm.rule_config) as { sourceObjectId?: string }
        if (cfg.sourceObjectId) {
          primarySourceObjectId = cfg.sourceObjectId
          break
        }
      }
    }

    // ── Load source rows ──────────────────────────────────────────────────────

    let sourceRows: Record<string, string>[] = []
    if (primarySourceObjectId) {
      const dbRows = db.prepare(
        'SELECT row_index, data FROM source_rows WHERE object_id = ? ORDER BY row_index ASC'
      ).all(primarySourceObjectId) as SourceRowDB[]
      sourceRows = dbRows.map(r => JSON.parse(r.data) as Record<string, string>)
    }

    // Source-independent rules (constant, uuid, incremental) still need at least one output row.
    // If no source rows were loaded, produce one row.
    if (sourceRows.length === 0) {
      sourceRows = [{}]
    }

    const totalRows = sourceRows.length
    sendProgress(runId, {
      status: 'running',
      phase: 'processing',
      currentTarget: targetObj.name,
      rowsDone: 0,
      rowsTotal: totalRows,
    })

    // ── Row-by-row processing ─────────────────────────────────────────────────

    const outputRows: Record<string, string>[] = []

    for (let i = 0; i < sourceRows.length; i++) {
      if (runState.cancelled) break

      const srcRow = sourceRows[i]
      const outRow: Record<string, string> = {}

      for (const tf of targetFields) {
        const fm = fmByFieldId.get(tf.id)
        if (!fm) {
          if (tf.is_required) {
            insertIssue.run(runId, i, tf.name, 'warning', `Required field "${tf.name}" has no mapping`)
            totalIssues++
          }
          outRow[tf.name] = ''
          continue
        }

        let value = ''
        try {
          const cfg = JSON.parse(fm.rule_config)
          switch (fm.rule_type) {
            case 'direct':             value = applyDirect(cfg, srcRow); break
            case 'constant':           value = applyConstant(cfg); break
            case 'uuid':               value = applyUUID(); break
            case 'concat':             value = applyConcat(cfg, srcRow); break
            case 'split':              value = applySplit(cfg, srcRow); break
            case 'substring':          value = applySubstring(cfg, srcRow); break
            case 'dateformat':         value = applyDateFormat(cfg, srcRow); break
            case 'picklisttranslate':  value = applyPicklistTranslate(cfg, srcRow, picklistMaps); break
            case 'expression':         value = applyExpression(cfg, srcRow, i); break
            case 'incremental':        value = applyIncremental(cfg, i); break
            default:                   value = ''
          }
        } catch (err) {
          insertIssue.run(runId, i, tf.name, 'error', `Rule error: ${String(err)}`)
          totalIssues++
        }

        if (tf.is_required && !value) {
          insertIssue.run(runId, i, tf.name, 'warning', `Required field "${tf.name}" is empty after mapping`)
          totalIssues++
        }

        outRow[tf.name] = value
      }

      outputRows.push(outRow)

      // Yield + progress every 250 rows
      if ((i + 1) % 250 === 0) {
        sendProgress(runId, {
          status: 'running',
          phase: 'processing',
          currentTarget: targetObj.name,
          rowsDone: i + 1,
          rowsTotal: totalRows,
        })
        await new Promise<void>(resolve => setImmediate(resolve))
      }
    }

    totalRowsProcessed += outputRows.length

    // ── Write output file ─────────────────────────────────────────────────────

    const format = targetObj.output_format as 'xlsx' | 'csv'
    const ext = format === 'xlsx' ? '.xlsx' : '.csv'
    const outFilePath = path.join(tempDir, `${targetObjectId}${ext}`)

    if (format === 'xlsx') {
      const ws = XLSX.utils.json_to_sheet(outputRows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, targetObj.name.slice(0, 31))
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
      fs.writeFileSync(outFilePath, buf)
    } else {
      const headers = targetFields.map(f => f.name)
      const csvLines = [headers.join(',')]
      for (const row of outputRows) {
        csvLines.push(headers.map(h => {
          const v = row[h] ?? ''
          return (v.includes(',') || v.includes('"') || v.includes('\n'))
            ? `"${v.replace(/"/g, '""')}"`
            : v
        }).join(','))
      }
      fs.writeFileSync(outFilePath, csvLines.join('\n'), 'utf-8')
    }

    manifest.targets.push({
      objectId: targetObjectId,
      objectName: targetObj.name,
      format,
      filePath: outFilePath,
      rowCount: outputRows.length,
    })
  }

  // ── Finalise run record ───────────────────────────────────────────────────────

  const completedAt = new Date().toISOString()
  const finalStatus = runState.cancelled ? 'failed' : 'completed'
  const stats = { totalRowsProcessed, totalIssues, targetCount: manifest.targets.length }

  db.prepare(`
    UPDATE runs
    SET status = ?, completed_at = ?, stats = ?, output_manifest = ?
    WHERE id = ?
  `).run(finalStatus, completedAt, JSON.stringify(stats), JSON.stringify(manifest), runId)

  activeRuns.delete(runId)

  sendProgress(runId, {
    status: finalStatus,
    phase: 'done',
    rowsDone: totalRowsProcessed,
    rowsTotal: totalRowsProcessed,
    stats,
  })
}

// ── Cancel ────────────────────────────────────────────────────────────────────

export function cancelRun(runId: string): void {
  const state = activeRuns.get(runId)
  if (state) state.cancelled = true
}
