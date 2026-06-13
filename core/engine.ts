/**
 * Transformation execution engine.
 *
 * Runs entirely in Node.js / better-sqlite3.
 * Applies field-mapping rules row-by-row, writes output files to a temp
 * directory, then stores run metadata + issues in the SQLite DB.
 *
 * Progress events are pushed via the configured sendProgress callback.
 */
import path from 'path'
import fs from 'fs'
import ExcelJS from 'exceljs'
import { getDb } from './db.js'
import { parseFile } from './importer.js'

// ── Platform configuration ────────────────────────────────────────────────────

interface EngineConfig {
  /** Absolute path to the directory where run output files are stored temporarily. */
  tempDir: string
  /** Send a progress event to connected clients. */
  sendProgress: (runId: string, payload: Record<string, unknown>) => void
}

let _engineConfig: EngineConfig | null = null

/**
 * Configure platform-specific dependencies before running any transformation.
 * Must be called once at startup (in main.ts for Electron, in server.ts for web).
 */
export function configureEngine(config: EngineConfig): void {
  _engineConfig = config
}

function getEngineConfig(): EngineConfig {
  if (!_engineConfig) throw new Error('Engine not configured. Call configureEngine() at startup.')
  return _engineConfig
}

// ── DB row shapes ─────────────────────────────────────────────────────────────

interface FieldMappingRow {
  id: string
  transformation_id: string
  target_object_id: string
  target_field_id: string
  rule_type: string
  rule_config: string
  notes: string | null
  map_node_id: string | null
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

interface SourceObjectMeta {
  source_file_path: string | null
  source_separator: string | null
  source_skip_rows: number | null
  source_skip_columns: number | null
  source_data_start_row: number | null
}

/**
 * Load all rows for a source object.
 * Reads from the original file when source_file_path is set (preferred path for large files).
 * Falls back to the source_rows table when no path is recorded (legacy projects or manual objects).
 */
async function loadSourceObjectRows(
  objectId: string,
  db: ReturnType<typeof getDb>,
): Promise<Record<string, string>[]> {
  const meta = db.prepare(
    'SELECT source_file_path, source_separator, source_skip_rows, source_skip_columns, source_data_start_row FROM data_objects WHERE id = ?'
  ).get(objectId) as SourceObjectMeta | undefined

  if (meta?.source_file_path) {
    try {
      const { rows } = await parseFile(meta.source_file_path, undefined, {
        separator:    meta.source_separator    ?? undefined,
        skipRows:     meta.source_skip_rows    ?? undefined,
        skipColumns:  meta.source_skip_columns ?? undefined,
        dataStartRow: meta.source_data_start_row ?? undefined,
      })
      return rows
    } catch {
      // File missing or unreadable — fall through to DB rows
    }
  }

  // Legacy fallback: rows stored in source_rows table
  return (db.prepare(
    'SELECT row_index, data FROM source_rows WHERE object_id = ? ORDER BY row_index ASC'
  ).all(objectId) as SourceRowDB[]).map(r => JSON.parse(r.data) as Record<string, string>)
}

/**
 * Pre-load all source objects referenced in the canvas or in field mapping rule configs
 * into a single cache. The engine then uses this cache instead of hitting the DB or disk
 * per-row, keeping the hot loop fully synchronous.
 */
async function buildSourceCache(
  canvas: CanvasState | null,
  allMappings: FieldMappingRow[],
  db: ReturnType<typeof getDb>,
): Promise<Map<string, Record<string, string>[]>> {
  const cache = new Map<string, Record<string, string>[]>()

  // Collect IDs from canvas source nodes
  if (canvas) {
    for (const node of canvas.nodes) {
      if (node.type === 'sourceObject' && typeof node.data?.objectId === 'string') {
        const id = node.data.objectId as string
        if (!cache.has(id)) cache.set(id, await loadSourceObjectRows(id, db))
      }
    }
  }

  // Collect IDs from rule configs (covers legacy paths and join/append without canvas)
  const sourceRefTypes = new Set(['direct', 'concat', 'split', 'substring', 'dateformat', 'picklisttranslate', 'expression'])
  for (const fm of allMappings) {
    if (!sourceRefTypes.has(fm.rule_type)) continue
    try {
      const cfg = JSON.parse(fm.rule_config) as { sourceObjectId?: string }
      if (cfg.sourceObjectId && !cache.has(cfg.sourceObjectId) && !cfg.sourceObjectId.startsWith('_join_alias_')) {
        cache.set(cfg.sourceObjectId, await loadSourceObjectRows(cfg.sourceObjectId, db))
      }
    } catch { /* skip malformed config */ }
  }

  return cache
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
  getEngineConfig().sendProgress(runId, payload)
}

// ── Rule applicators ──────────────────────────────────────────────────────────

export function applyDirect(
  cfg: { sourceFieldName: string },
  row: Record<string, string>,
): string {
  return row[cfg.sourceFieldName] ?? ''
}

export function applyConstant(cfg: { value: string }): string {
  return cfg.value ?? ''
}

export function applyUUID(): string {
  return crypto.randomUUID()
}

export function applyConcat(
  cfg: { parts?: Array<{ type: 'field'; sourceFieldName: string } | { type: 'literal'; value: string }> },
  row: Record<string, string>,
): string {
  return (cfg.parts ?? []).map(p =>
    p.type === 'field' ? (row[p.sourceFieldName] ?? '') : (p.value ?? '')
  ).join('')
}

export function applySplit(
  cfg: { sourceFieldName: string; delimiter?: string; index?: number },
  row: Record<string, string>,
): string {
  const val = row[cfg.sourceFieldName] ?? ''
  const parts = val.split(cfg.delimiter ?? ' ')
  return parts[cfg.index ?? 0] ?? ''
}

export function applySubstring(
  cfg: { sourceFieldName: string; start?: number; length?: number },
  row: Record<string, string>,
): string {
  const val = row[cfg.sourceFieldName] ?? ''
  const start = cfg.start ?? 0
  return cfg.length !== undefined
    ? val.substring(start, start + cfg.length)
    : val.substring(start)
}

export function applyDateFormat(
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

export function applyPicklistTranslate(
  cfg: { sourceFieldName: string; mappingId?: string; fallback?: string },
  row: Record<string, string>,
  picklistMaps: Map<string, Map<string, string>>,
): string {
  const val = row[cfg.sourceFieldName] ?? ''
  if (!cfg.mappingId) return val
  const map = picklistMaps.get(cfg.mappingId)
  return map?.get(val) ?? cfg.fallback ?? val
}

export function applyExpression(
  cfg: { expression: string },
  row: Record<string, string>,
  rowIndex: number,
  compiledFn?: (row: Record<string, string>, rowIndex: number) => unknown,
): string {
  try {
    // eslint-disable-next-line no-new-func
    const fn = compiledFn ?? new Function('row', 'rowIndex', `"use strict"; return (${cfg.expression})`) as (row: Record<string, string>, rowIndex: number) => unknown
    const result = fn(row, rowIndex)
    return result !== undefined && result !== null ? String(result) : ''
  } catch {
    return ''
  }
}

export function applyIncremental(cfg: { start?: number; step?: number }, rowIndex: number): string {
  return String((cfg.start ?? 1) + rowIndex * (cfg.step ?? 1))
}

export interface ConditionalBranch {
  field: string        // encoded "objectId::fieldName"
  op: string
  value: string
  outputType: 'literal' | 'field'
  outputValue: string
}

export function evalCondOp(op: string, cell: string, val: string): boolean {
  switch (op) {
    case '=':            return cell === val
    case '!=':           return cell !== val
    case '>': { const [n, m] = [Number(cell), Number(val)]; return !isNaN(n) && !isNaN(m) ? n > m : cell > val }
    case '<': { const [n, m] = [Number(cell), Number(val)]; return !isNaN(n) && !isNaN(m) ? n < m : cell < val }
    case '>=': { const [n, m] = [Number(cell), Number(val)]; return !isNaN(n) && !isNaN(m) ? n >= m : cell >= val }
    case '<=': { const [n, m] = [Number(cell), Number(val)]; return !isNaN(n) && !isNaN(m) ? n <= m : cell <= val }
    case 'contains':     return cell.includes(val)
    case 'not_contains': return !cell.includes(val)
    case 'starts_with':  return cell.startsWith(val)
    case 'ends_with':    return cell.endsWith(val)
    case 'is_empty':     return cell.trim() === ''
    case 'is_not_empty': return cell.trim() !== ''
    default:             return false
  }
}

export function applyConditional(
  cfg: { branches?: ConditionalBranch[]; elseOutputType?: string; elseOutputValue?: string },
  row: Record<string, string>,
): string {
  const branches = cfg.branches ?? []
  for (const branch of branches) {
    const sep = branch.field.indexOf('::')
    const fieldName = sep >= 0 ? branch.field.slice(sep + 2) : branch.field
    const cell = row[fieldName] ?? ''
    if (evalCondOp(branch.op, cell, branch.value ?? '')) {
      if (branch.outputType === 'field') {
        const s = branch.outputValue.indexOf('::')
        const fn = s >= 0 ? branch.outputValue.slice(s + 2) : branch.outputValue
        return row[fn] ?? ''
      }
      return branch.outputValue ?? ''
    }
  }
  // ELSE
  if (cfg.elseOutputType === 'field') {
    const s = (cfg.elseOutputValue ?? '').indexOf('::')
    const fn = s >= 0 ? cfg.elseOutputValue!.slice(s + 2) : (cfg.elseOutputValue ?? '')
    return row[fn] ?? ''
  }
  return cfg.elseOutputValue ?? ''
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

export interface FilterCondition {
  field: string  // encoded as "objectId::fieldName"
  op: string
  value: string
}

// ── Filter evaluation ─────────────────────────────────────────────────────────

export function evaluateFilterCondition(cond: FilterCondition, row: Record<string, string>): boolean {
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

/**
 * Find filter conditions on the path from sourceObjectId UP TO (but not through)
 * a joinOperator node — i.e. pre-join filters for one input side.
 */

/**
 * Find filter conditions on the path from a joinOperator node to the target —
 * i.e. post-join filters applied to the merged row set.
 */
function findPostJoinFiltersFromNode(
  joinNodeId: string,
  startNodeId: string,
  canvas: CanvasState,
): FilterCondition[] {
  const { nodes, edges } = canvas
  const collected: FilterCondition[] = []

  function walk(nodeId: string): boolean {
    for (const edge of edges) {
      if (edge.target !== nodeId) continue
      const srcNode = nodes.find(n => n.id === edge.source)
      if (!srcNode) continue

      if (srcNode.id === joinNodeId) return true  // reached our join node — stop
      if (srcNode.type === 'filterOperator') {
        if (walk(srcNode.id)) {
          const conds = (srcNode.data.conditions ?? []) as FilterCondition[]
          collected.push(...conds)
          return true
        }
      } else if (srcNode.type === 'joinOperator') {
        // Don't traverse into unrelated join nodes
        return false
      } else {
        if (walk(srcNode.id)) return true
      }
    }
    return false
  }

  walk(startNodeId)
  return collected
}

function findPostJoinFilters(
  joinNodeId: string,
  targetObjectId: string,
  canvas: CanvasState,
): FilterCondition[] {
  const targetNode = canvas.nodes.find(
    n => n.type === 'targetObject' && n.data.objectId === targetObjectId
  )
  if (!targetNode) return []
  return findPostJoinFiltersFromNode(joinNodeId, targetNode.id, canvas)
}

// ── Join execution ────────────────────────────────────────────────────────────

interface JoinSpec {
  joinNodeId: string
  joinType: 'inner' | 'left' | 'right'
  joinKeyA: string  // encoded as "objectId::fieldName"
  joinKeyB: string  // encoded as "objectId::fieldName"
  sourceAId: string
  sourceBId: string
  aliasB?: string   // prefix applied to all B-side field names in merged output
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
          joinNodeId: srcNode.id,
          joinType: (srcNode.data.joinType as 'inner' | 'left' | 'right') ?? 'left',
          joinKeyA: (srcNode.data.joinKeyA as string) ?? '',
          joinKeyB: (srcNode.data.joinKeyB as string) ?? '',
          sourceAId,
          sourceBId,
          aliasB: (srcNode.data.aliasB as string) || undefined,
        }
      }
      const found = walk(srcNode.id)
      if (found) return found
    }
    return null
  }

  return walk(targetNode.id)
}

/**
 * Find all MapNode IDs that feed directly into a target object node.
 * Returns IDs of all canvas nodes of type 'mapOperator' with an edge to tgt-{targetObjectId}.
 */
function findMapNodesForTarget(targetObjectId: string, canvas: CanvasState): string[] {
  const targetNodeId = `tgt-${targetObjectId}`
  return canvas.edges
    .filter(e => e.target === targetNodeId)
    .map(e => e.source)
    .filter(nodeId => canvas.nodes.find(n => n.id === nodeId)?.type === 'mapOperator')
}

/**
 * Walk backwards from nodeId looking for a JoinOperator — same logic as findJoinSpec
 * but starting from a MapNode rather than the target object node.
 */
function findJoinSpecFromNode(nodeId: string, canvas: CanvasState): JoinSpec | null {
  function walk(id: string): JoinSpec | null {
    for (const edge of canvas.edges) {
      if (edge.target !== id) continue
      const srcNode = canvas.nodes.find(n => n.id === edge.source)
      if (!srcNode) continue
      if (srcNode.type === 'joinOperator') {
        const sourceAId = findSourceIdByHandle(srcNode.id, 'input-a', canvas)
        const sourceBId = findSourceIdByHandle(srcNode.id, 'input-b', canvas)
        if (!sourceAId || !sourceBId) return null
        return {
          joinNodeId: srcNode.id,
          joinType: (srcNode.data.joinType as 'inner' | 'left' | 'right') ?? 'left',
          joinKeyA: (srcNode.data.joinKeyA as string) ?? '',
          joinKeyB: (srcNode.data.joinKeyB as string) ?? '',
          sourceAId,
          sourceBId,
          aliasB: (srcNode.data.aliasB as string) || undefined,
        }
      }
      const found = walk(srcNode.id)
      if (found) return found
    }
    return null
  }
  return walk(nodeId)
}

/**
 * Collect filter conditions on the path from sources up to (but not through) a MapNode.
 * Walks backwards from mapNodeId collecting all filterOperator conditions encountered.
 */
function findFilterConditionsForMapNode(mapNodeId: string, canvas: CanvasState): FilterCondition[] {
  const { nodes, edges } = canvas
  const collected: FilterCondition[] = []

  function walk(nodeId: string): boolean {
    for (const edge of edges) {
      if (edge.target !== nodeId) continue
      const srcNode = nodes.find(n => n.id === edge.source)
      if (!srcNode) continue
      if (srcNode.type === 'sourceObject') return true
      if (srcNode.type === 'filterOperator') {
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

  walk(mapNodeId)
  return collected
}

interface SourcePathResult {
  sourceRows: Record<string, string>[]
  filterConditions: FilterCondition[]
  primarySourceObjectId: string | null
}

/** Apply dedup logic to a row set. Groups by key fields, sorts by sortField, keeps one per key. */
function applyDedupRows(
  rows: Record<string, string>[],
  data: { keyFields?: string[]; sortField?: string; keepOrder?: 'last' | 'first' },
): Record<string, string>[] {
  const keyFields = (data.keyFields ?? []).map(f => { const s = f.indexOf('::'); return s >= 0 ? f.slice(s + 2) : f })
  if (keyFields.length === 0) return rows

  const sortFieldRaw = data.sortField ?? ''
  const sortField = sortFieldRaw ? (sortFieldRaw.indexOf('::') >= 0 ? sortFieldRaw.slice(sortFieldRaw.indexOf('::') + 2) : sortFieldRaw) : ''
  const keepLast = (data.keepOrder ?? 'last') === 'last'

  const groups = new Map<string, Record<string, string>[]>()
  for (const row of rows) {
    const key = keyFields.map(f => row[f] ?? '').join('\x00')
    const g = groups.get(key) ?? []
    g.push(row)
    groups.set(key, g)
  }
  const deduped: Record<string, string>[] = []
  for (const group of groups.values()) {
    if (sortField) {
      group.sort((a, b) => {
        const va = a[sortField] ?? '', vb = b[sortField] ?? ''
        const na = Number(va), nb = Number(vb)
        if (!isNaN(na) && !isNaN(nb)) return na - nb
        return va < vb ? -1 : va > vb ? 1 : 0
      })
    }
    deduped.push(keepLast ? group[group.length - 1] : group[0])
  }
  return deduped
}

/**
 * Walk backwards from fromNodeId looking for a dedupOperator anywhere in the chain.
 * Walks through transparent nodes (filterOperator, etc.) but stops at boundaries
 * (sourceObject, joinOperator, appendOperator).
 */
function findDedupNodeInChain(fromNodeId: string, canvas: CanvasState): CanvasNode | null {
  function walk(nodeId: string): CanvasNode | null {
    for (const edge of canvas.edges) {
      if (edge.target !== nodeId) continue
      const srcNode = canvas.nodes.find(n => n.id === edge.source)
      if (!srcNode) continue
      if (srcNode.type === 'dedupOperator') return srcNode
      if (srcNode.type === 'sourceObject' || srcNode.type === 'joinOperator' || srcNode.type === 'appendOperator') return null
      const found = walk(srcNode.id)
      if (found) return found
    }
    return null
  }
  return walk(fromNodeId)
}

/**
 * Determine the source rows and filter conditions for a specific MapNode.
 * Handles: single source, filter chain, join, append, and dedup operator inputs.
 * Rows are served from the pre-built sourceCache (populated at run start from the
 * original source files or, for legacy projects, from the source_rows table).
 */
function collectSourceRowsForMapNode(
  mapNodeId: string,
  canvas: CanvasState,
  sourceCache: Map<string, Record<string, string>[]>,
): SourcePathResult {
  const loadRows = (objectId: string): Record<string, string>[] => sourceCache.get(objectId) ?? []

  // Find the direct upstream node connected to this MapNode
  const inEdge = canvas.edges.find(e => e.target === mapNodeId)
  if (!inEdge) return { sourceRows: [], filterConditions: [], primarySourceObjectId: null }

  const upstreamNode = canvas.nodes.find(n => n.id === inEdge.source)
  if (!upstreamNode) return { sourceRows: [], filterConditions: [], primarySourceObjectId: null }

  // Deduplicate is the direct upstream: collect rows from further upstream, apply dedup
  if (upstreamNode.type === 'dedupOperator') {
    const innerResult = collectSourceRowsForMapNode(upstreamNode.id, canvas, sourceCache)
    let rows = innerResult.sourceRows
    if (innerResult.filterConditions.length > 0) {
      rows = rows.filter(r => innerResult.filterConditions.every(c => evaluateFilterCondition(c, r)))
    }
    return {
      sourceRows: applyDedupRows(rows, upstreamNode.data as { keyFields?: string[]; sortField?: string; keepOrder?: 'last' | 'first' }),
      filterConditions: [],
      primarySourceObjectId: innerResult.primarySourceObjectId,
    }
  }

  // Append operator: concatenate raw rows from all connected source nodes
  if (upstreamNode.type === 'appendOperator') {
    const allRows: Record<string, string>[] = []
    let primarySourceObjectId: string | null = null
    for (const appendEdge of canvas.edges.filter(e => e.target === upstreamNode.id)) {
      const srcNode = canvas.nodes.find(n => n.id === appendEdge.source)
      if (srcNode?.type === 'sourceObject') {
        const objId = srcNode.data.objectId as string
        if (!primarySourceObjectId) primarySourceObjectId = objId
        allRows.push(...loadRows(objId))
      }
    }
    return { sourceRows: allRows, filterConditions: [], primarySourceObjectId }
  }

  // Join operator: walk the full upstream graph recursively to support cascaded joins
  const joinSpec = findJoinSpecFromNode(mapNodeId, canvas)
  if (joinSpec) {
    const edgeA = canvas.edges.find(e => e.target === joinSpec.joinNodeId && e.targetHandle === 'input-a')
    const edgeB = canvas.edges.find(e => e.target === joinSpec.joinNodeId && e.targetHandle === 'input-b')
    const rowsA = edgeA ? collectRowsFromNode(edgeA.source, canvas, sourceCache) : []
    const rowsB = edgeB ? collectRowsFromNode(edgeB.source, canvas, sourceCache) : []
    const joined = executeJoin(rowsA, rowsB, joinSpec)
    const postFilters = findPostJoinFiltersFromNode(joinSpec.joinNodeId, mapNodeId, canvas)
    return { sourceRows: joined, filterConditions: postFilters, primarySourceObjectId: joinSpec.sourceAId }
  }

  // Single source (possibly through filter chain, possibly with a dedup node in the chain)
  const primarySourceObjectId = findAnySourceId(mapNodeId, canvas)
  if (!primarySourceObjectId) return { sourceRows: [], filterConditions: [], primarySourceObjectId: null }

  let rows = loadRows(primarySourceObjectId)
  const filterConditions = findFilterConditionsForMapNode(mapNodeId, canvas)

  // Apply dedup if there is a dedupOperator anywhere between the source and this map node
  // (e.g. Source → Dedup → Filter → Map — dedup is not the direct upstream)
  const dedupNode = findDedupNodeInChain(mapNodeId, canvas)
  if (dedupNode) {
    rows = applyDedupRows(rows, dedupNode.data as { keyFields?: string[]; sortField?: string; keepOrder?: 'last' | 'first' })
  }

  return { sourceRows: rows, filterConditions, primarySourceObjectId }
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
 * If spec.aliasB is set, all B-side field names are prefixed with `aliasB_` in the
 * output — this lets the same source be joined multiple times without collisions.
 * Old projects without aliasB are unaffected (no prefix applied).
 */
function executeJoin(
  rowsA: Record<string, string>[],
  rowsB: Record<string, string>[],
  spec: JoinSpec,
): Record<string, string>[] {
  const keyA = decodeFieldName(spec.joinKeyA)
  const keyB = decodeFieldName(spec.joinKeyB)

  if (!keyA || !keyB) {
    const label = spec.joinNodeId ? ` (node ${spec.joinNodeId})` : ''
    throw new Error(
      `Join${label} is missing key configuration — both sides must have a join key set. ` +
      `Open the Join panel to configure the key fields before running.`
    )
  }

  const aliasB = spec.aliasB?.trim() || undefined

  // Prefix all B-side field names when an alias is configured
  function prefixB(row: Record<string, string>): Record<string, string> {
    if (!aliasB) return row
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(row)) out[`${aliasB}_${k}`] = v
    return out
  }

  // Index B rows by their join key value (on original, un-prefixed names)
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
        result.push({ ...prefixB(rowB), ...rowA })  // A fields win on collision
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
      const pB = prefixB(rowB)
      for (const rowA of matches) {
        result.push({ ...rowA, ...pB })  // B fields win on collision
      }
    }
  }

  return result
}

/**
 * Recursively evaluate a canvas node and return the rows it produces.
 * Handles sourceObject, joinOperator (including cascaded), filterOperator,
 * dedupOperator, and appendOperator — the full node graph, not just flat lookups.
 */
function collectRowsFromNode(
  nodeId: string,
  canvas: CanvasState,
  sourceCache: Map<string, Record<string, string>[]>,
): Record<string, string>[] {
  const node = canvas.nodes.find(n => n.id === nodeId)
  if (!node) return []

  switch (node.type) {
    case 'sourceObject':
      return sourceCache.get(node.data.objectId as string) ?? []

    case 'joinOperator': {
      const edgeA = canvas.edges.find(e => e.target === nodeId && e.targetHandle === 'input-a')
      const edgeB = canvas.edges.find(e => e.target === nodeId && e.targetHandle === 'input-b')
      if (!edgeA || !edgeB) return []
      const rowsA = collectRowsFromNode(edgeA.source, canvas, sourceCache)
      const rowsB = collectRowsFromNode(edgeB.source, canvas, sourceCache)
      return executeJoin(rowsA, rowsB, {
        joinNodeId: nodeId,
        joinType: (node.data.joinType as 'inner' | 'left' | 'right') ?? 'left',
        joinKeyA: (node.data.joinKeyA as string) ?? '',
        joinKeyB: (node.data.joinKeyB as string) ?? '',
        sourceAId: '',
        sourceBId: '',
        aliasB: (node.data.aliasB as string) || undefined,
      })
    }

    case 'filterOperator': {
      const inEdge = canvas.edges.find(e => e.target === nodeId)
      if (!inEdge) return []
      const rows = collectRowsFromNode(inEdge.source, canvas, sourceCache)
      const conditions = (node.data.conditions ?? []) as FilterCondition[]
      return conditions.length > 0
        ? rows.filter(r => conditions.every(c => evaluateFilterCondition(c, r)))
        : rows
    }

    case 'dedupOperator': {
      const inEdge = canvas.edges.find(e => e.target === nodeId)
      if (!inEdge) return []
      const rows = collectRowsFromNode(inEdge.source, canvas, sourceCache)
      return applyDedupRows(rows, node.data as { keyFields?: string[]; sortField?: string; keepOrder?: 'last' | 'first' })
    }

    case 'appendOperator': {
      const allRows: Record<string, string>[] = []
      for (const edge of canvas.edges.filter(e => e.target === nodeId)) {
        allRows.push(...collectRowsFromNode(edge.source, canvas, sourceCache))
      }
      return allRows
    }

    default: {
      const inEdge = canvas.edges.find(e => e.target === nodeId)
      if (inEdge) return collectRowsFromNode(inEdge.source, canvas, sourceCache)
      return []
    }
  }
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

function _memMB() {
  const m = process.memoryUsage()
  return `rss=${Math.round(m.rss/1024/1024)}MB heap=${Math.round(m.heapUsed/1024/1024)}/${Math.round(m.heapTotal/1024/1024)}MB`
}

async function _runEngine(runId: string, transformationId: string): Promise<void> {
  const db = getDb()
  const runState = activeRuns.get(runId)!

  console.log(`[MEM] run start: ${_memMB()}`)
  sendProgress(runId, { status: 'running', phase: 'loading' })

  // ── Load canvas state (for filter node evaluation) ───────────────────────────

  let canvas: CanvasState | null = null
  const canvasRow = db.prepare(
    'SELECT canvas_state FROM transformations WHERE id = ?'
  ).get(transformationId) as { canvas_state: string | null } | undefined
  if (canvasRow?.canvas_state) {
    try { canvas = JSON.parse(canvasRow.canvas_state) as CanvasState } catch { /* ignore */ }
  }

  // ── Pre-run canvas validation ─────────────────────────────────────────────────
  // Reject early if any join node is missing key configuration — otherwise the
  // engine would silently produce a cartesian product (|A| × |B| rows).

  if (canvas) {
    const badJoins = canvas.nodes
      .filter(n => n.type === 'joinOperator')
      .filter(n => !n.data.joinKeyA || !n.data.joinKeyB)
      .map(n => (n.data.label as string | undefined)?.trim() || n.id)

    if (badJoins.length > 0) {
      throw new Error(
        `Cannot run: the following Join node(s) have no key configured and would produce a ` +
        `cartesian product — please open each Join panel and set both key fields before running.\n` +
        badJoins.map(l => `  • ${l}`).join('\n')
      )
    }
  }

  // ── Load field mappings ──────────────────────────────────────────────────────

  const mappingRows = db.prepare(
    'SELECT * FROM field_mappings WHERE transformation_id = ?'
  ).all(transformationId) as FieldMappingRow[]

  if (mappingRows.length === 0) {
    throw new Error('No field mappings defined for this transformation.')
  }

  // Group mappings by target → mapNodeId (null = legacy single-MapNode rows)
  const byTargetByNode = new Map<string, Map<string | null, FieldMappingRow[]>>()
  for (const m of mappingRows) {
    if (!byTargetByNode.has(m.target_object_id)) byTargetByNode.set(m.target_object_id, new Map())
    const byNode = byTargetByNode.get(m.target_object_id)!
    const key = m.map_node_id ?? null
    if (!byNode.has(key)) byNode.set(key, [])
    byNode.get(key)!.push(m)
  }

  // Pre-load picklist maps needed at run time:
  //   • picklisttranslate rules → target picklist mapping (source_key → target_key)
  //   • direct rules with picklistMappingId → target picklist mapping
  //   • direct rules with extractMode === 'label' → source picklist (key → label)
  const picklistMaps = new Map<string, Map<string, string>>()

  const loadMappingEntries = (mid: string) => {
    if (picklistMaps.has(mid)) return
    const entries = db.prepare(
      'SELECT source_key, target_key FROM picklist_mapping_entries WHERE mapping_id = ?'
    ).all(mid) as { source_key: string; target_key: string }[]
    const map = new Map<string, string>()
    for (const e of entries) map.set(e.source_key, e.target_key)
    picklistMaps.set(mid, map)
  }

  const loadPicklistLabels = (plId: string) => {
    if (picklistMaps.has(plId)) return
    const vals = db.prepare(
      'SELECT key, label FROM picklist_values WHERE picklist_id = ? ORDER BY position ASC'
    ).all(plId) as { key: string; label: string | null }[]
    const map = new Map<string, string>()
    for (const v of vals) map.set(v.key, v.label ?? v.key)
    picklistMaps.set(plId, map)
  }

  for (const m of mappingRows) {
    try {
      if (m.rule_type === 'picklisttranslate') {
        const cfg = JSON.parse(m.rule_config) as { mappingId?: string }
        if (cfg.mappingId) loadMappingEntries(cfg.mappingId)
      } else if (m.rule_type === 'direct') {
        const cfg = JSON.parse(m.rule_config) as {
          picklistMappingId?: string
          extractMode?: string
          targetPicklistId?: string
        }
        if (cfg.picklistMappingId) loadMappingEntries(cfg.picklistMappingId)
        // Pre-load the target picklist key→label map for extractMode === 'label'
        if (cfg.extractMode === 'label' && cfg.targetPicklistId) loadPicklistLabels(cfg.targetPicklistId)
      }
    } catch {
      // Malformed rule_config — skip picklist pre-load for this mapping
    }
  }

  // ── Pre-load all source object rows ──────────────────────────────────────────
  // Reads from the original file where source_file_path is set; falls back to the
  // source_rows table for legacy projects. Done once before the hot loop so row
  // access is synchronous throughout.

  const sourceCache = await buildSourceCache(canvas, mappingRows, db)
  console.log(`[MEM] after source cache (${sourceCache.size} objects): ${_memMB()}`)

  // ── Temp output directory ────────────────────────────────────────────────────

  const tempDir = path.join(getEngineConfig().tempDir, runId)
  fs.mkdirSync(tempDir, { recursive: true })

  const manifest: OutputManifest = { targets: [] }
  let totalRowsProcessed = 0
  let totalIssues = 0

  const insertIssue = db.prepare(`
    INSERT INTO run_issues (run_id, row_index, field_name, severity, message)
    VALUES (?, ?, ?, ?, ?)
  `)

  // ── Process each target object ───────────────────────────────────────────────

  for (const [targetObjectId, byNode] of byTargetByNode) {
    if (runState.cancelled) break

    const targetObj = db.prepare(
      'SELECT * FROM data_objects WHERE id = ?'
    ).get(targetObjectId) as ObjectRow | undefined
    if (!targetObj) continue

    const targetFields = db.prepare(
      'SELECT * FROM object_fields WHERE object_id = ? ORDER BY position ASC'
    ).all(targetObjectId) as ObjectFieldRow[]

    // Find MapNodes for this target from canvas (multi-path support)
    const canvasMapNodeIds = canvas ? findMapNodesForTarget(targetObjectId, canvas) : []

    // Build the list of (mapNodeId, rules) paths.
    // With canvas MapNodes: each MapNode is an independent path with scoped rules.
    // Legacy (no canvas / no MapNodes found): merge all rules into one path.
    //
    // Null-scoped (legacy) mappings are always merged into every path so that
    // pre-V5 projects (where map_node_id was NULL) continue to work after the
    // first node-scoped mapping is added for a subset of fields.  The
    // fmByFieldId build step below already prefers node-scoped over null-scoped
    // for the same field, so merging is safe.
    const nullScopedMappings = byNode.get(null) ?? []
    const paths: Array<{ mapNodeId: string | null; mappings: FieldMappingRow[] }> = []
    if (canvasMapNodeIds.length > 0) {
      for (const mapNodeId of canvasMapNodeIds) {
        const nodeScoped = byNode.get(mapNodeId) ?? []
        // Merge: node-scoped rules take priority (handled by fmByFieldId dedup);
        // null-scoped fill any fields not yet covered by a node-scoped rule.
        const mappings = nodeScoped.length > 0
          ? [...nodeScoped, ...nullScopedMappings]
          : nullScopedMappings
        paths.push({ mapNodeId, mappings })
      }
    } else {
      paths.push({ mapNodeId: null, mappings: [...byNode.values()].flat() })
    }

    sendProgress(runId, { status: 'running', phase: 'processing', currentTarget: targetObj.name, rowsDone: 0, rowsTotal: 0 })

    // ── Set up output writer before the processing loop ───────────────────────
    // Rows are written directly as they are produced — no outputRows accumulation.

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

    let outputRowCount = 0

    let templateWb: ExcelJS.Workbook | null = null
    let templateWs: ExcelJS.Worksheet | null = null
    let xlsxWriter: ExcelJS.stream.xlsx.WorkbookWriter | null = null
    let xlsxWs: ReturnType<ExcelJS.stream.xlsx.WorkbookWriter['addWorksheet']> | null = null
    let csvFd = -1
    const csvEscape = (v: string) =>
      (v.includes(',') || v.includes('"') || v.includes('\n'))
        ? `"${v.replace(/"/g, '""')}"` : v

    if (useTemplate) {
      templateWb = new ExcelJS.Workbook()
      await templateWb.xlsx.readFile(templateFilePath!)
      templateWs = templateWb.getWorksheet(1)!
      // ws.rowCount uses the sheet's declared dimension extent, which can be
      // 1,048,576 if column formatting was ever applied. Walk only actual rows.
      let actualLastDataRow = firstDataRow
      templateWs.eachRow(row => { if (row.number > firstDataRow) actualLastDataRow = Math.max(actualLastDataRow, row.number) })
      const lastCol = templateWs.columnCount
      for (let r = firstDataRow + 1; r <= actualLastDataRow; r++) {
        for (let c = skipColumns + 1; c <= lastCol; c++) {
          templateWs.getCell(r, c).value = null
        }
      }
    } else if (format === 'xlsx') {
      // Streaming writer — rows are flushed to disk as committed, full workbook never in memory.
      xlsxWriter = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: outFilePath })
      xlsxWs = xlsxWriter.addWorksheet(targetObj.name.slice(0, 31))
      xlsxWs.addRow(targetFields.map(tf => tf.name)).commit()
    } else {
      csvFd = fs.openSync(outFilePath, 'w')
      fs.writeSync(csvFd, targetFields.map(f => csvEscape(f.name)).join(',') + '\n', null, 'utf-8')
    }

    console.log(`[MEM] ${targetObj.name}: output writer ready: ${_memMB()}`)

    // ── Multi-path row processing: one pass per MapNode, results streamed to output ──

    for (const { mapNodeId, mappings } of paths) {
      if (mappings.length === 0) continue

      // Build field-id → mapping lookup. When duplicates exist (legacy null-scoped orphan
      // alongside a node-scoped rule for the same field), prefer the node-scoped one so a
      // stale pre-V5 mapping can never shadow a newly saved rule.
      const fmByFieldId = new Map<string, FieldMappingRow>()
      for (const fm of mappings) {
        const existing = fmByFieldId.get(fm.target_field_id)
        if (!existing || (existing.map_node_id === null && fm.map_node_id !== null)) {
          fmByFieldId.set(fm.target_field_id, fm)
        }
      }

      // Pre-parse rule configs and compile expression functions once — not per row
      type PreparedMapping = { fm: FieldMappingRow; cfg: Record<string, unknown>; compiledFn?: (row: Record<string, string>, rowIndex: number) => unknown }
      const preparedByFieldId = new Map<string, PreparedMapping>()
      for (const [fieldId, fm] of fmByFieldId) {
        let cfg: Record<string, unknown> = {}
        let compiledFn: PreparedMapping['compiledFn']
        try { cfg = JSON.parse(fm.rule_config) as Record<string, unknown> } catch { /* keep empty */ }
        if (fm.rule_type === 'expression') {
          try {
            // eslint-disable-next-line no-new-func
            compiledFn = new Function('row', 'rowIndex', `"use strict"; return (${(cfg as { expression?: string }).expression ?? ''})`) as PreparedMapping['compiledFn']
          } catch { /* compiledFn stays undefined; applyExpression falls back gracefully */ }
        }
        preparedByFieldId.set(fieldId, { fm, cfg, compiledFn })
      }

      // Determine source rows and filter conditions for this path
      let sourceRows: Record<string, string>[] = []
      let filterConditions: FilterCondition[] = []

      if (canvas && mapNodeId) {
        const result = collectSourceRowsForMapNode(mapNodeId, canvas, sourceCache)
        sourceRows = result.sourceRows
        filterConditions = result.filterConditions
      } else {
        // Legacy: infer primary source from rule configs
        let primarySourceObjectId: string | null = null
        const sourceRefTypes = new Set(['direct', 'concat', 'split', 'substring', 'dateformat', 'picklisttranslate', 'expression'])
        for (const fm of mappings) {
          if (sourceRefTypes.has(fm.rule_type)) {
            try {
              const cfg = JSON.parse(fm.rule_config) as { sourceObjectId?: string }
              if (cfg.sourceObjectId) { primarySourceObjectId = cfg.sourceObjectId; break }
            } catch {
              // Malformed rule_config — skip this mapping for source detection
            }
          }
        }
        const joinSpec = canvas ? findJoinSpec(targetObjectId, canvas) : null
        if (joinSpec) {
          const edgeA = canvas ? canvas.edges.find(e => e.target === joinSpec.joinNodeId && e.targetHandle === 'input-a') : undefined
          const edgeB = canvas ? canvas.edges.find(e => e.target === joinSpec.joinNodeId && e.targetHandle === 'input-b') : undefined
          const rowsA = (canvas && edgeA) ? collectRowsFromNode(edgeA.source, canvas, sourceCache) : []
          const rowsB = (canvas && edgeB) ? collectRowsFromNode(edgeB.source, canvas, sourceCache) : []
          sourceRows = executeJoin(rowsA, rowsB, joinSpec)
          filterConditions = canvas ? findPostJoinFilters(joinSpec.joinNodeId, targetObjectId, canvas) : []
        } else if (primarySourceObjectId) {
          sourceRows = sourceCache.get(primarySourceObjectId) ?? []
          filterConditions = canvas ? findFilterConditions(primarySourceObjectId, targetObjectId, canvas) : []
        }
      }

      if (sourceRows.length === 0) sourceRows = [{}]
      const rowCount = sourceRows.length

      for (let i = 0; i < rowCount; i++) {
        if (runState.cancelled) break
        const srcRow = sourceRows[i]
        if (filterConditions.length > 0 && !filterConditions.every(c => evaluateFilterCondition(c, srcRow))) continue

        // outRow is keyed by field ID (not name) to handle Workday templates where the
        // same column name (e.g. "Delete", "Row ID*") appears in multiple sections.
        // Keying by name would cause later sections to silently overwrite earlier values.
        const outRow: Record<string, string> = {}
        for (const tf of targetFields) {
          const prepared = preparedByFieldId.get(tf.id)
          if (!prepared) {
            if (tf.is_required) {
              insertIssue.run(runId, i, tf.name, 'warning', `Required field "${tf.name}" has no mapping`)
              totalIssues++
            }
            outRow[tf.id] = ''
            continue
          }
          const { fm, cfg, compiledFn } = prepared
          let value = ''
          try {
            switch (fm.rule_type) {
              case 'direct': {
                // Step 1: raw source value
                const raw = applyDirect(cfg as { sourceFieldName: string }, srcRow)
                // Step 2: translate source_key → target_key via picklist mapping (left join)
                const mid = (cfg as { picklistMappingId?: string }).picklistMappingId
                const targetKey = mid ? (picklistMaps.get(mid)?.get(raw) ?? raw) : raw
                // Step 3: optionally resolve target_key → label via target picklist (left join)
                const { extractMode, targetPicklistId } =
                  cfg as { extractMode?: string; targetPicklistId?: string }
                value = (extractMode === 'label' && targetPicklistId)
                  ? (picklistMaps.get(targetPicklistId)?.get(targetKey) ?? targetKey)
                  : targetKey
                break
              }
              case 'constant':           value = applyConstant(cfg as { value: string }); break
              case 'uuid':               value = applyUUID(); break
              case 'concat':             value = applyConcat(cfg as Parameters<typeof applyConcat>[0], srcRow); break
              case 'split':              value = applySplit(cfg as Parameters<typeof applySplit>[0], srcRow); break
              case 'substring':          value = applySubstring(cfg as Parameters<typeof applySubstring>[0], srcRow); break
              case 'dateformat':         value = applyDateFormat(cfg as Parameters<typeof applyDateFormat>[0], srcRow); break
              case 'picklisttranslate':  value = applyPicklistTranslate(cfg as Parameters<typeof applyPicklistTranslate>[0], srcRow, picklistMaps); break
              case 'expression':         value = applyExpression(cfg as { expression: string }, srcRow, outputRowCount, compiledFn); break
              case 'incremental':        value = applyIncremental(cfg as Parameters<typeof applyIncremental>[0], outputRowCount); break
              case 'conditional':        value = applyConditional(cfg as Parameters<typeof applyConditional>[0], srcRow); break
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
          outRow[tf.id] = value
        }

        // Write the row directly to output — no in-memory accumulation.
        if (templateWs) {
          const r = firstDataRow + 1 + outputRowCount
          targetFields.forEach((tf, colIdx) => {
            templateWs!.getCell(r, skipColumns + 1 + colIdx).value = outRow[tf.id] ?? ''
          })
        } else if (xlsxWs) {
          xlsxWs.addRow(targetFields.map(tf => outRow[tf.id] ?? '')).commit()
        } else if (csvFd >= 0) {
          fs.writeSync(csvFd, targetFields.map(tf => csvEscape(outRow[tf.id] ?? '')).join(',') + '\n', null, 'utf-8')
        }
        outputRowCount++

        if ((i + 1) % 250 === 0) {
          sendProgress(runId, { status: 'running', phase: 'processing', currentTarget: targetObj.name, rowsDone: outputRowCount, rowsTotal: outputRowCount })
          await new Promise<void>(resolve => setImmediate(resolve))
        }
      }

      // Allow GC to collect the (potentially large) joined row set before the next path.
      sourceRows = []
    }

    // ── Finalise output file ──────────────────────────────────────────────────

    console.log(`[MEM] ${targetObj.name}: ${outputRowCount} rows written, before finalise: ${_memMB()}`)

    if (useTemplate && templateWb) {
      await templateWb.xlsx.writeFile(outFilePath)
      templateWb = null
      templateWs = null
    } else if (xlsxWriter && xlsxWs) {
      await xlsxWs.commit()
      await xlsxWriter.commit()
      xlsxWriter = null
      xlsxWs = null
    } else if (csvFd >= 0) {
      fs.closeSync(csvFd)
      csvFd = -1
    }

    console.log(`[MEM] ${targetObj.name}: after finalise: ${_memMB()}`)

    totalRowsProcessed += outputRowCount
    manifest.targets.push({
      objectId: targetObjectId,
      objectName: targetObj.name,
      format,
      filePath: outFilePath,
      rowCount: outputRowCount,
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
  console.log(`[MEM] run complete (${finalStatus}): ${_memMB()}`)

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
