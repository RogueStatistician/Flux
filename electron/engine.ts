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
  template_header_row: number | null
  template_data_start_row: number | null
  template_skip_columns: number | null
  template_file_path: string | null
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

// ── Canvas state types (minimal, for filter evaluation) ───────────────────────

interface CanvasNode {
  id: string
  type?: string
  data: Record<string, unknown>
}

interface CanvasEdge {
  source: string
  target: string
  targetHandle?: string
}

interface CanvasState {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

interface FilterCondition {
  field: string  // encoded as "objectId::fieldName"
  op: string
  value: string
}

// ── Filter evaluation ─────────────────────────────────────────────────────────

function evaluateFilterCondition(cond: FilterCondition, row: Record<string, string>): boolean {
  // field is encoded as "objectId::fieldName" — extract just the field name
  const sep = cond.field.indexOf('::')
  const fieldName = sep >= 0 ? cond.field.slice(sep + 2) : cond.field
  const cell = row[fieldName] ?? ''
  const val = cond.value ?? ''

  switch (cond.op) {
    case '=':           return cell === val
    case '!=':          return cell !== val
    case '>': { const [n, m] = [Number(cell), Number(val)]; return !isNaN(n) && !isNaN(m) ? n > m : cell > val }
    case '<': { const [n, m] = [Number(cell), Number(val)]; return !isNaN(n) && !isNaN(m) ? n < m : cell < val }
    case '>=': { const [n, m] = [Number(cell), Number(val)]; return !isNaN(n) && !isNaN(m) ? n >= m : cell >= val }
    case '<=': { const [n, m] = [Number(cell), Number(val)]; return !isNaN(n) && !isNaN(m) ? n <= m : cell <= val }
    case 'contains':     return cell.includes(val)
    case 'not_contains': return !cell.includes(val)
    case 'starts_with':  return cell.startsWith(val)
    case 'ends_with':    return cell.endsWith(val)
    case 'is_empty':     return cell === ''
    case 'is_not_empty': return cell !== ''
    default:             return true
  }
}

/**
 * Walks the canvas graph backwards from a targetObject node and collects all
 * FilterCondition entries from filterOperator nodes that lie on the path from
 * sourceObjectId → targetObjectId. Returns a flat list — ALL conditions must
 * match for a row to pass (AND semantics).
 */
function findFilterConditions(
  sourceObjectId: string,
  targetObjectId: string,
  canvas: CanvasState,
): FilterCondition[] {
  const { nodes, edges } = canvas
  const targetNode = nodes.find(
    n => n.type === 'targetObject' && n.data.objectId === targetObjectId
  )
  if (!targetNode) return []

  const collected: FilterCondition[] = []

  function walk(nodeId: string): boolean {
    for (const edge of edges) {
      if (edge.target !== nodeId) continue
      const srcNode = nodes.find(n => n.id === edge.source)
      if (!srcNode) continue

      if (srcNode.type === 'sourceObject') {
        if ((srcNode.data.objectId as string) === sourceObjectId) return true
      } else if (srcNode.type === 'filterOperator') {
        if (walk(srcNode.id)) {
          const conds = (srcNode.data.conditions ?? []) as FilterCondition[]
          collected.push(...conds)
          return true
        }
      } else {
        if (walk(srcNode.id)) return true
      }
    }
    return false
  }

  walk(targetNode.id)
  return collected
}

// ── Join execution ────────────────────────────────────────────────────────────

interface JoinSpec {
  joinType: 'inner' | 'left' | 'right'
  joinKeyA: string  // encoded as "objectId::fieldName"
  joinKeyB: string  // encoded as "objectId::fieldName"
  sourceAId: string
  sourceBId: string
}

/** Recursively finds the first sourceObject ID reachable upstream of nodeId. */
function findAnySourceId(nodeId: string, canvas: CanvasState): string | null {
  for (const edge of canvas.edges) {
    if (edge.target !== nodeId) continue
    const srcNode = canvas.nodes.find(n => n.id === edge.source)
    if (!srcNode) continue
    if (srcNode.type === 'sourceObject') return srcNode.data.objectId as string
    const found = findAnySourceId(srcNode.id, canvas)
    if (found) return found
  }
  return null
}

/** Find source ID for a specific handle on a join node, traversing through operators. */
function findSourceIdByHandle(
  joinNodeId: string,
  handleId: string,
  canvas: CanvasState,
): string | null {
  const inEdges = canvas.edges.filter(e => e.target === joinNodeId && e.targetHandle === handleId)
  for (const edge of inEdges) {
    const srcNode = canvas.nodes.find(n => n.id === edge.source)
    if (!srcNode) continue
    if (srcNode.type === 'sourceObject') return srcNode.data.objectId as string
    const found = findAnySourceId(srcNode.id, canvas)
    if (found) return found
  }
  return null
}

/**
 * Walks the canvas graph backwards from targetObjectId and returns the first
 * joinOperator node found on the path, with its configuration and resolved
 * source IDs for each input handle.
 */
function findJoinSpec(targetObjectId: string, canvas: CanvasState): JoinSpec | null {
  const targetNode = canvas.nodes.find(
    n => n.type === 'targetObject' && n.data.objectId === targetObjectId
  )
  if (!targetNode) return null

  function walk(nodeId: string): JoinSpec | null {
    for (const edge of canvas.edges) {
      if (edge.target !== nodeId) continue
      const srcNode = canvas.nodes.find(n => n.id === edge.source)
      if (!srcNode) continue

      if (srcNode.type === 'joinOperator') {
        const sourceAId = findSourceIdByHandle(srcNode.id, 'input-a', canvas)
        const sourceBId = findSourceIdByHandle(srcNode.id, 'input-b', canvas)
        if (!sourceAId || !sourceBId) return null
        return {
          joinType: (srcNode.data.joinType as 'inner' | 'left' | 'right') ?? 'left',
          joinKeyA: (srcNode.data.joinKeyA as string) ?? '',
          joinKeyB: (srcNode.data.joinKeyB as string) ?? '',
          sourceAId,
          sourceBId,
        }
      }
      const found = walk(srcNode.id)
      if (found) return found
    }
    return null
  }

  return walk(targetNode.id)
}

/** Decode a field reference that may be encoded as "objectId::fieldName". */
function decodeFieldName(encoded: string): string {
  const sep = encoded.indexOf('::')
  return sep >= 0 ? encoded.slice(sep + 2) : encoded
}

/**
 * Perform an inner / left / right join of two row sets.
 * Merged rows have all fields from both A and B; A fields overwrite B on collision.
 * For right joins B fields take priority (A overwrites only where B is absent).
 */
function executeJoin(
  rowsA: Record<string, string>[],
  rowsB: Record<string, string>[],
  spec: JoinSpec,
): Record<string, string>[] {
  const keyA = decodeFieldName(spec.joinKeyA)
  const keyB = decodeFieldName(spec.joinKeyB)

  // Index B rows by their join key value
  const bIndex = new Map<string, Record<string, string>[]>()
  for (const row of rowsB) {
    const k = row[keyB] ?? ''
    if (!bIndex.has(k)) bIndex.set(k, [])
    bIndex.get(k)!.push(row)
  }

  const result: Record<string, string>[] = []

  if (spec.joinType === 'inner' || spec.joinType === 'left') {
    const emptyB: Record<string, string> = {}
    for (const rowA of rowsA) {
      const matches = bIndex.get(rowA[keyA] ?? '') ?? (spec.joinType === 'left' ? [emptyB] : [])
      for (const rowB of matches) {
        result.push({ ...rowB, ...rowA })  // A fields win on collision
      }
    }
  } else {
    // right join: B is the "driving" side
    const aIndex = new Map<string, Record<string, string>[]>()
    for (const row of rowsA) {
      const k = row[keyA] ?? ''
      if (!aIndex.has(k)) aIndex.set(k, [])
      aIndex.get(k)!.push(row)
    }
    const emptyA: Record<string, string> = {}
    for (const rowB of rowsB) {
      const matches = aIndex.get(rowB[keyB] ?? '') ?? [emptyA]
      for (const rowA of matches) {
        result.push({ ...rowA, ...rowB })  // B fields win on collision
      }
    }
  }

  return result
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

  // ── Load canvas state (for filter node evaluation) ───────────────────────────

  let canvas: CanvasState | null = null
  const canvasRow = db.prepare(
    'SELECT canvas_state FROM transformations WHERE id = ?'
  ).get(transformationId) as { canvas_state: string | null } | undefined
  if (canvasRow?.canvas_state) {
    try { canvas = JSON.parse(canvasRow.canvas_state) as CanvasState } catch { /* ignore */ }
  }

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

    // ── Load source rows (with join if configured) ────────────────────────────

    const joinSpec = canvas ? findJoinSpec(targetObjectId, canvas) : null
    let sourceRows: Record<string, string>[] = []

    if (joinSpec) {
      const loadRows = (objectId: string) =>
        (db.prepare(
          'SELECT row_index, data FROM source_rows WHERE object_id = ? ORDER BY row_index ASC'
        ).all(objectId) as SourceRowDB[]).map(r => JSON.parse(r.data) as Record<string, string>)

      sourceRows = executeJoin(loadRows(joinSpec.sourceAId), loadRows(joinSpec.sourceBId), joinSpec)
      // For filter traversal: use sourceA as the anchor (filters walk through join nodes)
      primarySourceObjectId = joinSpec.sourceAId
    } else if (primarySourceObjectId) {
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

    // ── Resolve filter conditions for this source → target path ──────────────

    const filterConditions = (canvas && primarySourceObjectId)
      ? findFilterConditions(primarySourceObjectId, targetObjectId, canvas)
      : []

    // ── Row-by-row processing ─────────────────────────────────────────────────

    const outputRows: Record<string, string>[] = []

    for (let i = 0; i < sourceRows.length; i++) {
      if (runState.cancelled) break

      const srcRow = sourceRows[i]

      // Skip rows that don't satisfy all filter conditions (AND semantics)
      if (filterConditions.length > 0 && !filterConditions.every(c => evaluateFilterCondition(c, srcRow))) continue

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

    const templateFilePath = targetObj.template_file_path
    const headerRow = targetObj.template_header_row ?? 0
    const skipColumns = targetObj.template_skip_columns ?? 0
    // firstDataRow defaults to headerRow + 1 when template_data_start_row is not set,
    // preserving backward-compatible behaviour for Case A (header row = last preamble row).
    // When set explicitly it can differ from headerRow (Case B: header row for field-name
    // inference is earlier than the last preserved preamble row).
    const firstDataRow = targetObj.template_data_start_row ?? (headerRow + 1)
    const useTemplate = format === 'xlsx' && !!templateFilePath && fs.existsSync(templateFilePath)

    if (format === 'xlsx' && useTemplate) {
      // ── Template-based output: preserve the original workbook structure ──────
      // Load the original template, clear the data area, then write transformed
      // rows so preamble rows and column offsets are retained exactly.
      const templateBuf = fs.readFileSync(templateFilePath!)
      const wb = XLSX.read(templateBuf, { raw: false, cellDates: false })
      const wsName = wb.SheetNames[0]
      const ws = wb.Sheets[wsName]

      // Decode the current sheet extent (fall back to a single cell if empty).
      const refStr = ws['!ref'] ?? 'A1'
      const sheetRange = XLSX.utils.decode_range(refStr)

      // Clear all cells in the data area (rows from firstDataRow onwards,
      // columns at or after skipColumns) so stale template data is removed.
      for (let r = firstDataRow; r <= sheetRange.e.r; r++) {
        for (let c = skipColumns; c <= sheetRange.e.c; c++) {
          delete ws[XLSX.utils.encode_cell({ r, c })]
        }
      }

      // Write transformed rows starting at firstDataRow.
      outputRows.forEach((outRow, rowIdx) => {
        const r = firstDataRow + rowIdx
        targetFields.forEach((tf, colIdx) => {
          const c = skipColumns + colIdx
          const value = outRow[tf.name] ?? ''
          ws[XLSX.utils.encode_cell({ r, c })] = { v: value, t: 's' }
        })
      })

      // Expand the sheet range to cover all written rows/columns.
      const lastDataRow = firstDataRow + outputRows.length - 1
      const lastDataCol = skipColumns + targetFields.length - 1
      sheetRange.e.r = Math.max(sheetRange.e.r, lastDataRow)
      sheetRange.e.c = Math.max(sheetRange.e.c, lastDataCol)
      ws['!ref'] = XLSX.utils.encode_range(sheetRange)

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
      fs.writeFileSync(outFilePath, buf)
    } else if (format === 'xlsx') {
      // ── Standard from-scratch XLSX output ────────────────────────────────────
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
