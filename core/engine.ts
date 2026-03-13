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

interface ConditionalBranch {
  field: string        // encoded "objectId::fieldName"
  op: string
  value: string
  outputType: 'literal' | 'field'
  outputValue: string
}

function evalCondOp(op: string, cell: string, val: string): boolean {
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

function applyConditional(
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

/**
 * Find filter conditions on the path from sourceObjectId UP TO (but not through)
 * a joinOperator node — i.e. pre-join filters for one input side.
 */
function findPreJoinFilters(
  sourceObjectId: string,
  toNodeId: string,
  canvas: CanvasState,
): FilterCondition[] {
  const { nodes, edges } = canvas
  const collected: FilterCondition[] = []

  function walk(nodeId: string): boolean {
    for (const edge of edges) {
      if (edge.target !== nodeId) continue
      const srcNode = nodes.find(n => n.id === edge.source)
      if (!srcNode) continue

      if (srcNode.type === 'sourceObject') {
        if ((srcNode.data.objectId as string) === sourceObjectId) return true
      } else if (srcNode.type === 'joinOperator') {
        // Do not traverse into other join nodes when collecting pre-join filters
        return false
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

  walk(toNodeId)
  return collected
}

/**
 * Find filter conditions on the path from a joinOperator node to the target —
 * i.e. post-join filters applied to the merged row set.
 */
function findPostJoinFilters(
  joinNodeId: string,
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

  walk(targetNode.id)
  return collected
}

// ── Join execution ────────────────────────────────────────────────────────────

interface JoinSpec {
  joinNodeId: string
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
          joinNodeId: srcNode.id,
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
 */
function collectSourceRowsForMapNode(
  mapNodeId: string,
  canvas: CanvasState,
  db: ReturnType<typeof getDb>,
): SourcePathResult {
  const loadRows = (objectId: string) =>
    (db.prepare(
      'SELECT row_index, data FROM source_rows WHERE object_id = ? ORDER BY row_index ASC'
    ).all(objectId) as SourceRowDB[]).map(r => JSON.parse(r.data) as Record<string, string>)

  // Find the direct upstream node connected to this MapNode
  const inEdge = canvas.edges.find(e => e.target === mapNodeId)
  if (!inEdge) return { sourceRows: [], filterConditions: [], primarySourceObjectId: null }

  const upstreamNode = canvas.nodes.find(n => n.id === inEdge.source)
  if (!upstreamNode) return { sourceRows: [], filterConditions: [], primarySourceObjectId: null }

  // Deduplicate is the direct upstream: collect rows from further upstream, apply dedup
  if (upstreamNode.type === 'dedupOperator') {
    const innerResult = collectSourceRowsForMapNode(upstreamNode.id, canvas, db)
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

  // Join operator: use existing join logic but rooted at mapNode
  const joinSpec = findJoinSpecFromNode(mapNodeId, canvas)
  if (joinSpec) {
    let rowsA = loadRows(joinSpec.sourceAId)
    const filtersA = findPreJoinFilters(joinSpec.sourceAId, joinSpec.joinNodeId, canvas)
    if (filtersA.length > 0) rowsA = rowsA.filter(row => filtersA.every(c => evaluateFilterCondition(c, row)))

    let rowsB = loadRows(joinSpec.sourceBId)
    const filtersB = findPreJoinFilters(joinSpec.sourceBId, joinSpec.joinNodeId, canvas)
    if (filtersB.length > 0) rowsB = rowsB.filter(row => filtersB.every(c => evaluateFilterCondition(c, row)))

    const joined = executeJoin(rowsA, rowsB, joinSpec)
    const postFilters = findPostJoinFilters(joinSpec.joinNodeId, mapNodeId, canvas)
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

  // Group mappings by target → mapNodeId (null = legacy single-MapNode rows)
  const byTargetByNode = new Map<string, Map<string | null, FieldMappingRow[]>>()
  for (const m of mappingRows) {
    if (!byTargetByNode.has(m.target_object_id)) byTargetByNode.set(m.target_object_id, new Map())
    const byNode = byTargetByNode.get(m.target_object_id)!
    const key = m.map_node_id ?? null
    if (!byNode.has(key)) byNode.set(key, [])
    byNode.get(key)!.push(m)
  }

  // Pre-load any picklist maps needed (for picklisttranslate and direct rules with picklistMappingId)
  const picklistMaps = new Map<string, Map<string, string>>()
  for (const m of mappingRows) {
    let mid: string | undefined
    if (m.rule_type === 'picklisttranslate') {
      const cfg = JSON.parse(m.rule_config) as { mappingId?: string }
      mid = cfg.mappingId
    } else if (m.rule_type === 'direct') {
      const cfg = JSON.parse(m.rule_config) as { picklistMappingId?: string }
      mid = cfg.picklistMappingId
    }
    if (mid && !picklistMaps.has(mid)) {
      const entries = db.prepare(
        'SELECT source_key, target_key FROM picklist_mapping_entries WHERE mapping_id = ?'
      ).all(mid) as { source_key: string; target_key: string }[]
      const map = new Map<string, string>()
      for (const e of entries) map.set(e.source_key, e.target_key)
      picklistMaps.set(mid, map)
    }
  }

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
    const paths: Array<{ mapNodeId: string | null; mappings: FieldMappingRow[] }> = []
    if (canvasMapNodeIds.length > 0) {
      for (const mapNodeId of canvasMapNodeIds) {
        const mappings = byNode.get(mapNodeId) ??
          (mapNodeId === `map-${targetObjectId}` ? byNode.get(null) ?? [] : [])
        paths.push({ mapNodeId, mappings })
      }
    } else {
      paths.push({ mapNodeId: null, mappings: [...byNode.values()].flat() })
    }

    sendProgress(runId, { status: 'running', phase: 'processing', currentTarget: targetObj.name, rowsDone: 0, rowsTotal: 0 })

    // ── Multi-path row processing: one pass per MapNode, results concatenated ──

    const outputRows: Record<string, string>[] = []

    for (const { mapNodeId, mappings } of paths) {
      if (mappings.length === 0) continue

      const fmByFieldId = new Map<string, FieldMappingRow>()
      for (const fm of mappings) fmByFieldId.set(fm.target_field_id, fm)

      // Determine source rows and filter conditions for this path
      let sourceRows: Record<string, string>[] = []
      let filterConditions: FilterCondition[] = []

      if (canvas && mapNodeId) {
        const result = collectSourceRowsForMapNode(mapNodeId, canvas, db)
        sourceRows = result.sourceRows
        filterConditions = result.filterConditions
      } else {
        // Legacy: infer primary source from rule configs
        let primarySourceObjectId: string | null = null
        const sourceRefTypes = new Set(['direct', 'concat', 'split', 'substring', 'dateformat', 'picklisttranslate', 'expression'])
        for (const fm of mappings) {
          if (sourceRefTypes.has(fm.rule_type)) {
            const cfg = JSON.parse(fm.rule_config) as { sourceObjectId?: string }
            if (cfg.sourceObjectId) { primarySourceObjectId = cfg.sourceObjectId; break }
          }
        }
        const joinSpec = canvas ? findJoinSpec(targetObjectId, canvas) : null
        if (joinSpec) {
          const loadRows = (objectId: string) =>
            (db.prepare('SELECT row_index, data FROM source_rows WHERE object_id = ? ORDER BY row_index ASC')
              .all(objectId) as SourceRowDB[]).map(r => JSON.parse(r.data) as Record<string, string>)
          let rowsA = loadRows(joinSpec.sourceAId)
          const filtersA = canvas ? findPreJoinFilters(joinSpec.sourceAId, joinSpec.joinNodeId, canvas) : []
          if (filtersA.length > 0) rowsA = rowsA.filter(row => filtersA.every(c => evaluateFilterCondition(c, row)))
          let rowsB = loadRows(joinSpec.sourceBId)
          const filtersB = canvas ? findPreJoinFilters(joinSpec.sourceBId, joinSpec.joinNodeId, canvas) : []
          if (filtersB.length > 0) rowsB = rowsB.filter(row => filtersB.every(c => evaluateFilterCondition(c, row)))
          sourceRows = executeJoin(rowsA, rowsB, joinSpec)
          filterConditions = canvas ? findPostJoinFilters(joinSpec.joinNodeId, targetObjectId, canvas) : []
        } else if (primarySourceObjectId) {
          sourceRows = (db.prepare('SELECT row_index, data FROM source_rows WHERE object_id = ? ORDER BY row_index ASC')
            .all(primarySourceObjectId) as SourceRowDB[]).map(r => JSON.parse(r.data) as Record<string, string>)
          filterConditions = canvas ? findFilterConditions(primarySourceObjectId, targetObjectId, canvas) : []
        }
      }

      if (sourceRows.length === 0) sourceRows = [{}]

      for (let i = 0; i < sourceRows.length; i++) {
        if (runState.cancelled) break
        const srcRow = sourceRows[i]
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
              case 'direct': {
                const raw = applyDirect(cfg, srcRow)
                const mid = (cfg as { picklistMappingId?: string }).picklistMappingId
                value = mid ? (picklistMaps.get(mid)?.get(raw) ?? raw) : raw
                break
              }
              case 'constant':           value = applyConstant(cfg); break
              case 'uuid':               value = applyUUID(); break
              case 'concat':             value = applyConcat(cfg, srcRow); break
              case 'split':              value = applySplit(cfg, srcRow); break
              case 'substring':          value = applySubstring(cfg, srcRow); break
              case 'dateformat':         value = applyDateFormat(cfg, srcRow); break
              case 'picklisttranslate':  value = applyPicklistTranslate(cfg, srcRow, picklistMaps); break
              case 'expression':         value = applyExpression(cfg, srcRow, outputRows.length); break
              case 'incremental':        value = applyIncremental(cfg, outputRows.length); break
              case 'conditional':        value = applyConditional(cfg, srcRow); break
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

        if ((i + 1) % 250 === 0) {
          sendProgress(runId, { status: 'running', phase: 'processing', currentTarget: targetObj.name, rowsDone: outputRows.length, rowsTotal: outputRows.length })
          await new Promise<void>(resolve => setImmediate(resolve))
        }
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
      // ExcelJS uses 1-based row/column indices throughout.
      const templateBuf = fs.readFileSync(templateFilePath!)
      const wb = new ExcelJS.Workbook()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await wb.xlsx.load(templateBuf as any)
      const ws = wb.getWorksheet(1)!

      // Clear the data area (firstDataRow onwards, skipColumns onwards).
      const lastRow = ws.rowCount
      const lastCol = ws.columnCount
      for (let r = firstDataRow + 1; r <= lastRow; r++) {
        for (let c = skipColumns + 1; c <= lastCol; c++) {
          ws.getCell(r, c).value = null
        }
      }

      // Write transformed rows starting at firstDataRow (1-based: firstDataRow + 1).
      outputRows.forEach((outRow, rowIdx) => {
        const r = firstDataRow + 1 + rowIdx
        targetFields.forEach((tf, colIdx) => {
          const c = skipColumns + 1 + colIdx
          ws.getCell(r, c).value = outRow[tf.name] ?? ''
        })
      })

      const buf = await wb.xlsx.writeBuffer()
      fs.writeFileSync(outFilePath, Buffer.from(buf as ArrayBuffer))
    } else if (format === 'xlsx') {
      // ── Standard from-scratch XLSX output ────────────────────────────────────
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet(targetObj.name.slice(0, 31))
      const headers = targetFields.map(tf => tf.name)
      ws.addRow(headers)
      for (const row of outputRows) {
        ws.addRow(headers.map(h => row[h] ?? ''))
      }
      const buf = await wb.xlsx.writeBuffer()
      fs.writeFileSync(outFilePath, Buffer.from(buf as ArrayBuffer))
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
