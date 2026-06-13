/**
 * Developer tools service — read-only DB inspection and transformation query rendering.
 * Used by the Dev Tools workspace section to help debug mappings and data issues.
 */
import { getDb } from '../db.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TableInfo {
  name: string
  rowCount: number
}

export interface TableQueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  total: number
}

export interface MappingLine {
  targetField: string
  ruleType: string
  /** Human-readable description of the rule. */
  description: string
  notes?: string
  /** Raw JSON config string — used for SQL preview generation. */
  rawConfig: string
}

export interface JoinStep {
  joinType: 'inner' | 'left' | 'right'
  rightSource: string
  rightRowCount: number | null
  leftKey: string
  rightKey: string
  rightAlias?: string
}

export interface JoinChain {
  rootSource: string
  rootRowCount: number | null
  steps: JoinStep[]
}

export interface QueryPath {
  mapNodeId: string | null
  sourceObject: string | null
  sourceRowCount: number | null
  joinChain?: JoinChain
  filters: string[]
  mappings: MappingLine[]
}

export interface TransformationQuery {
  transformationId: string
  transformationName: string
  targetObject: string
  targetObjectId: string
  paths: QueryPath[]
}

// ── DB browser ────────────────────────────────────────────────────────────────

const ALLOWED_TABLES = new Set([
  'projects', 'data_objects', 'object_fields', 'source_rows',
  'picklists', 'picklist_values', 'picklist_mappings', 'picklist_mapping_entries',
  'transformations', 'field_mappings', 'runs', 'run_issues', '_meta',
])

/** List all user-visible tables with row counts. */
export function listTables(): TableInfo[] {
  const db = getDb()
  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC`
  ).all() as { name: string }[]

  return tables.map(t => {
    let rowCount = 0
    try {
      const row = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as { c: number }
      rowCount = row.c
    } catch { /* skip if table is unreadable */ }
    return { name: t.name, rowCount }
  })
}

/** Return paginated rows from a table. Only whitelisted table names are allowed. */
export function queryTable(tableName: string, page: number, pageSize: number): TableQueryResult {
  if (!ALLOWED_TABLES.has(tableName)) throw new Error(`Table "${tableName}" is not accessible.`)

  const db = getDb()
  const offset = page * pageSize

  const total = (db.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get() as { c: number }).c
  if (total === 0) return { columns: [], rows: [], total: 0 }

  const rows = db.prepare(
    `SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`
  ).all(pageSize, offset) as Record<string, unknown>[]

  const columns = rows.length > 0 ? Object.keys(rows[0]) : []
  return { columns, rows, total }
}

/** Execute an arbitrary read-only SELECT query (rejects non-SELECT statements). */
export function executeRawQuery(sql: string): TableQueryResult {
  const trimmed = sql.trim().toLowerCase()
  if (!trimmed.startsWith('select')) throw new Error('Only SELECT statements are allowed.')
  // Reject obviously destructive keywords in the statement
  const forbidden = /\b(drop|delete|insert|update|create|alter|attach|detach|pragma)\b/i
  if (forbidden.test(sql)) throw new Error('Statement contains forbidden keywords.')

  const db = getDb()
  const rows = db.prepare(sql).all() as Record<string, unknown>[]
  const columns = rows.length > 0 ? Object.keys(rows[0]) : []
  return { columns, rows, total: rows.length }
}

// ── Transformation query renderer ─────────────────────────────────────────────

interface CanvasNode { id: string; type?: string; data?: Record<string, unknown> }
interface CanvasEdge { id: string; source: string; target: string; targetHandle?: string }
interface Canvas { nodes: CanvasNode[]; edges: CanvasEdge[] }

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

interface ObjectRow { id: string; name: string; row_count: number | null }
interface ObjectFieldRow { id: string; name: string; position: number }
interface FilterCondition { field: string; op: string; value: string }
interface FilterNodeData { conditions?: FilterCondition[] }

function conditionToSql(fieldName: string, op: string, value: string): string {
  switch (op) {
    case '=':           return `${fieldName} = '${value}'`
    case '!=':          return `${fieldName} <> '${value}'`
    case '>':           return `${fieldName} > '${value}'`
    case '<':           return `${fieldName} < '${value}'`
    case '>=':          return `${fieldName} >= '${value}'`
    case '<=':          return `${fieldName} <= '${value}'`
    case 'contains':    return `${fieldName} LIKE '%${value}%'`
    case 'not_contains':return `${fieldName} NOT LIKE '%${value}%'`
    case 'starts_with': return `${fieldName} LIKE '${value}%'`
    case 'ends_with':   return `${fieldName} LIKE '%${value}'`
    case 'is_empty':    return `(${fieldName} IS NULL OR ${fieldName} = '')`
    case 'is_not_empty':return `(${fieldName} IS NOT NULL AND ${fieldName} <> '')`
    default:            return `${fieldName} ${op} '${value}'`
  }
}

/** Produce a human-readable label for a field mapping rule. */
function describeRule(ruleType: string, rawConfig: string): string {
  try {
    const cfg = JSON.parse(rawConfig) as Record<string, unknown>
    switch (ruleType) {
      case 'direct': {
        const field = (cfg.sourceFieldName as string) ?? '?'
        const pl = cfg.picklistMappingId ? ` [via PL mapping]` : ''
        return `← ${field}${pl}`
      }
      case 'constant':
        return `= "${cfg.value ?? ''}"`
      case 'uuid':
        return `UUID (generated)`
      case 'incremental': {
        const start = cfg.start ?? 1
        const step = cfg.step ?? 1
        return `Incremental (start=${start}, step=${step})`
      }
      case 'concat': {
        const parts = (cfg.parts as Array<{ type: string; value?: string; sourceFieldName?: string }>) ?? []
        const partsStr = parts.map(p => p.type === 'literal' ? `"${p.value ?? ''}"` : p.sourceFieldName ?? '?').join(' + ')
        return `CONCAT(${partsStr})`
      }
      case 'split': {
        const field = (cfg.sourceFieldName as string) ?? '?'
        const delim = cfg.delimiter ?? ','
        const idx = cfg.index ?? 0
        return `SPLIT(${field}, "${delim}")[${idx}]`
      }
      case 'substring': {
        const field = (cfg.sourceFieldName as string) ?? '?'
        const start = cfg.start ?? 0
        const len = cfg.length !== undefined ? `, length=${cfg.length}` : ''
        return `SUBSTR(${field}, ${start}${len})`
      }
      case 'dateformat': {
        const field = (cfg.sourceFieldName as string) ?? '?'
        const fmt = cfg.outputFormat ?? '?'
        return `DATEFORMAT(${field} → ${fmt})`
      }
      case 'picklisttranslate': {
        const field = (cfg.sourceFieldName as string) ?? '?'
        return `TRANSLATE(${field}) [PL mapping]`
      }
      case 'expression': {
        const expr = cfg.expression as string ?? ''
        const short = expr.length > 60 ? expr.slice(0, 57) + '…' : expr
        return `JS: ${short}`
      }
      case 'conditional': {
        const branches = (cfg.branches as Array<{ condition?: { field?: string; operator?: string; value?: string }; value?: string }>) ?? []
        const ifBranch = branches[0]
        if (ifBranch?.condition) {
          const { field, operator, value } = ifBranch.condition
          return `IF ${field ?? '?'} ${operator ?? '='} "${value ?? ''}" THEN "${ifBranch.value ?? ''}"`
        }
        return `Conditional (${branches.length} branch${branches.length !== 1 ? 'es' : ''})`
      }
      default:
        return ruleType
    }
  } catch {
    return ruleType
  }
}

/** Walk upstream from nodeId through any handle, returning the first sourceObject ID found. */
function findAnySourceObjectId(nodeId: string, canvas: Canvas, visited = new Set<string>()): string | null {
  if (visited.has(nodeId)) return null
  visited.add(nodeId)
  for (const edge of canvas.edges) {
    if (edge.target !== nodeId) continue
    const src = canvas.nodes.find(n => n.id === edge.source)
    if (!src) continue
    if (src.type === 'sourceObject') return (src.data?.objectId as string) ?? null
    const found = findAnySourceObjectId(src.id, canvas, visited)
    if (found) return found
  }
  return null
}

/** Walk upstream from a join node via a specific handle, returning the first sourceObject ID. */
function findSourceIdByHandle(joinNodeId: string, handleId: string, canvas: Canvas): string | null {
  for (const edge of canvas.edges) {
    if (edge.target !== joinNodeId || edge.targetHandle !== handleId) continue
    const src = canvas.nodes.find(n => n.id === edge.source)
    if (!src) continue
    if (src.type === 'sourceObject') return (src.data?.objectId as string) ?? null
    return findAnySourceObjectId(src.id, canvas)
  }
  return null
}

interface PathSource {
  sourceObjectId: string | null
  joinChain: JoinChain | null
}

/** Resolve the data source(s) for a map node, building a full join chain for cascaded joins. */
function resolvePathSource(mapNodeId: string, canvas: Canvas): PathSource {
  const db = getDb()

  function resolveObjectName(id: string): { name: string; rowCount: number | null } {
    const row = db.prepare('SELECT name, row_count FROM data_objects WHERE id = ?').get(id) as
      | { name: string; row_count: number | null } | undefined
    return row ? { name: row.name, rowCount: row.row_count } : { name: id, rowCount: null }
  }

  function stripKey(encoded: string): string {
    const sep = encoded.indexOf('::')
    return sep >= 0 ? encoded.slice(sep + 2) : encoded
  }

  /**
   * Recursively build a JoinChain from a node.
   * Returns null when the node doesn't resolve to any known source.
   */
  function buildChain(nodeId: string, visited = new Set<string>()): JoinChain | null {
    if (visited.has(nodeId)) return null
    visited.add(nodeId)

    const node = canvas.nodes.find(n => n.id === nodeId)
    if (!node) return null

    if (node.type === 'sourceObject') {
      const objId = (node.data?.objectId as string) ?? null
      if (!objId) return null
      const obj = resolveObjectName(objId)
      return { rootSource: obj.name, rootRowCount: obj.rowCount, steps: [] }
    }

    if (node.type === 'joinOperator') {
      const edgeA = canvas.edges.find(e => e.target === nodeId && e.targetHandle === 'input-a')
      const edgeB = canvas.edges.find(e => e.target === nodeId && e.targetHandle === 'input-b')
      if (!edgeA || !edgeB) return null

      const chainA = buildChain(edgeA.source, new Set(visited))
      if (!chainA) return null

      // Recursively build the B-side — it may itself be a join chain (nested join)
      const chainB = buildChain(edgeB.source, new Set(visited))

      let rightSource: string
      let rightRowCount: number | null = null

      if (chainB && chainB.steps.length > 0) {
        // B-side is a nested join — render it as an inline subquery string
        const parts: string[] = [chainB.rootSource]
        for (const s of chainB.steps) {
          const kw = s.joinType === 'inner' ? 'INNER JOIN' : s.joinType === 'right' ? 'RIGHT JOIN' : 'LEFT JOIN'
          const alias = s.rightAlias ? ` ${s.rightAlias}` : ''
          const ref = s.rightAlias ?? s.rightSource
          parts.push(`${kw} ${s.rightSource}${alias} ON ${s.leftKey} = ${ref}.${s.rightKey}`)
        }
        rightSource = `(${parts.join(' ')})`
      } else if (chainB) {
        rightSource = chainB.rootSource
        rightRowCount = chainB.rootRowCount
      } else {
        // Fallback: find any reachable leaf source
        const bLeafId = findAnySourceObjectId(edgeB.source, canvas)
        const bObj = bLeafId ? resolveObjectName(bLeafId) : { name: edgeB.source, rowCount: null }
        rightSource = bObj.name
        rightRowCount = bObj.rowCount
      }

      const rawKeyA = (node.data?.joinKeyA as string) ?? ''
      const rawKeyB = (node.data?.joinKeyB as string) ?? ''
      const rightAlias = (node.data?.aliasB as string) || undefined

      chainA.steps.push({
        joinType: (node.data?.joinType as 'inner' | 'left' | 'right') ?? 'left',
        rightSource,
        rightRowCount,
        leftKey: stripKey(rawKeyA),
        rightKey: stripKey(rawKeyB),
        rightAlias,
      })

      return chainA
    }

    // Pass through filter/dedup/append — walk upstream
    for (const edge of canvas.edges) {
      if (edge.target !== nodeId) continue
      const chain = buildChain(edge.source, new Set(visited))
      if (chain) return chain
    }

    return null
  }

  // Walk from mapNode to the first upstream sourceObject or joinOperator
  function walk(nodeId: string, visited = new Set<string>()): PathSource {
    if (visited.has(nodeId)) return { sourceObjectId: null, joinChain: null }
    visited.add(nodeId)

    for (const edge of canvas.edges) {
      if (edge.target !== nodeId) continue
      const src = canvas.nodes.find(n => n.id === edge.source)
      if (!src) continue

      if (src.type === 'sourceObject') {
        return { sourceObjectId: (src.data?.objectId as string) ?? null, joinChain: null }
      }

      if (src.type === 'joinOperator') {
        const chain = buildChain(src.id, new Set(visited))
        const rootSourceId = findAnySourceObjectId(src.id, canvas)
        return { sourceObjectId: rootSourceId, joinChain: chain }
      }

      const result = walk(src.id, visited)
      if (result.sourceObjectId || result.joinChain) return result
    }

    return { sourceObjectId: null, joinChain: null }
  }

  return walk(mapNodeId)
}

/** Extract filter conditions visible on canvas edges going into a node. */
function findFilterDescriptions(nodeId: string, canvas: Canvas): string[] {
  const filters: string[] = []
  for (const edge of canvas.edges) {
    if (edge.target === nodeId) {
      const upstream = canvas.nodes.find(n => n.id === edge.source)
      if (!upstream) continue
      if (upstream.type === 'filterOperator') {
        const d = upstream.data as unknown as FilterNodeData
        for (const cond of d.conditions ?? []) {
          // field is encoded as "objectId::fieldName" — strip the prefix
          const fieldName = cond.field.includes('::') ? cond.field.split('::')[1] : cond.field
          if (fieldName) filters.push(conditionToSql(fieldName, cond.op, cond.value))
        }
        // Recurse upstream to collect chained filters
        filters.push(...findFilterDescriptions(upstream.id, canvas))
      } else {
        // Walk through non-filter operators (join, append, dedup) to find filters further upstream
        filters.push(...findFilterDescriptions(upstream.id, canvas))
      }
    }
  }
  return filters
}

/** Render a human-readable query plan for every target object in a transformation. */
export function renderTransformationQuery(transformationId: string): TransformationQuery[] {
  const db = getDb()

  const transformation = db.prepare(
    'SELECT id, name, canvas_state FROM transformations WHERE id = ?'
  ).get(transformationId) as { id: string; name: string; canvas_state: string | null } | undefined

  if (!transformation) throw new Error(`Transformation ${transformationId} not found.`)

  let canvas: Canvas | null = null
  try {
    if (transformation.canvas_state) canvas = JSON.parse(transformation.canvas_state) as Canvas
  } catch { /* invalid canvas JSON — fall back to rule-only mode */ }

  const allMappings = db.prepare(
    'SELECT * FROM field_mappings WHERE transformation_id = ? ORDER BY id ASC'
  ).all(transformationId) as FieldMappingRow[]

  // Group mappings: targetObjectId → mapNodeId|null → mappings[]
  const byTarget = new Map<string, Map<string | null, FieldMappingRow[]>>()
  for (const fm of allMappings) {
    if (!byTarget.has(fm.target_object_id)) byTarget.set(fm.target_object_id, new Map())
    const byNode = byTarget.get(fm.target_object_id)!
    const key = fm.map_node_id ?? null
    if (!byNode.has(key)) byNode.set(key, [])
    byNode.get(key)!.push(fm)
  }

  const result: TransformationQuery[] = []

  for (const [targetObjectId, byNode] of byTarget) {
    const targetObj = db.prepare(
      'SELECT id, name, row_count FROM data_objects WHERE id = ?'
    ).get(targetObjectId) as ObjectRow | undefined
    if (!targetObj) continue

    const targetFields = db.prepare(
      'SELECT id, name, position FROM object_fields WHERE object_id = ? ORDER BY position ASC'
    ).all(targetObjectId) as ObjectFieldRow[]

    const fieldById = new Map(targetFields.map(f => [f.id, f.name]))

    // Determine paths (canvas-based or legacy)
    const canvasMapNodeIds: string[] = []
    if (canvas) {
      for (const edge of canvas.edges) {
        if (edge.target === `tgt-${targetObjectId}`) {
          const src = canvas.nodes.find(n => n.id === edge.source)
          if (src?.type === 'mapOperator') canvasMapNodeIds.push(src.id)
        }
      }
    }

    const paths: QueryPath[] = []

    if (canvasMapNodeIds.length > 0) {
      for (const mapNodeId of canvasMapNodeIds) {
        const mappings = byNode.get(mapNodeId) ??
          (mapNodeId === `map-${targetObjectId}` ? byNode.get(null) ?? [] : [])

        // Deduplicate: prefer node-scoped over null-scoped
        const fmByFieldId = new Map<string, FieldMappingRow>()
        for (const fm of mappings) {
          const existing = fmByFieldId.get(fm.target_field_id)
          if (!existing || (existing.map_node_id === null && fm.map_node_id !== null)) {
            fmByFieldId.set(fm.target_field_id, fm)
          }
        }

        const { sourceObjectId, joinChain } = canvas
          ? resolvePathSource(mapNodeId, canvas)
          : { sourceObjectId: null, joinChain: null }

        let sourceObject: string | null = null
        let sourceRowCount: number | null = null

        if (joinChain) {
          sourceObject = joinChain.rootSource
          sourceRowCount = joinChain.rootRowCount
        } else if (sourceObjectId) {
          const srcObj = db.prepare(
            'SELECT name, row_count FROM data_objects WHERE id = ?'
          ).get(sourceObjectId) as { name: string; row_count: number | null } | undefined
          if (srcObj) { sourceObject = srcObj.name; sourceRowCount = srcObj.row_count }
        }

        // If no canvas source found, try to infer from rule configs
        if (!sourceObject && !joinChain) {
          const sourceRefTypes = new Set(['direct', 'concat', 'split', 'substring', 'dateformat', 'picklisttranslate', 'expression'])
          for (const fm of mappings) {
            if (sourceRefTypes.has(fm.rule_type)) {
              try {
                const cfg = JSON.parse(fm.rule_config) as { sourceObjectId?: string }
                if (cfg.sourceObjectId) {
                  const srcObj = db.prepare(
                    'SELECT name, row_count FROM data_objects WHERE id = ?'
                  ).get(cfg.sourceObjectId) as { name: string; row_count: number | null } | undefined
                  if (srcObj) { sourceObject = srcObj.name; sourceRowCount = srcObj.row_count; break }
                }
              } catch { /* skip */ }
            }
          }
        }

        const filters = canvas ? findFilterDescriptions(mapNodeId, canvas) : []

        const mappingLines: MappingLine[] = targetFields.map(tf => {
          const fm = fmByFieldId.get(tf.id)
          if (!fm) return { targetField: tf.name, ruleType: 'unmapped', description: '(unmapped)', rawConfig: '{}' }
          return {
            targetField: tf.name,
            ruleType: fm.rule_type,
            description: describeRule(fm.rule_type, fm.rule_config),
            notes: fm.notes ?? undefined,
            rawConfig: fm.rule_config,
          }
        })

        paths.push({ mapNodeId, sourceObject, sourceRowCount, joinChain: joinChain ?? undefined, filters, mappings: mappingLines })
      }
    } else {
      // Legacy: merge all mappings for this target
      const allForTarget = [...byNode.values()].flat()
      const fmByFieldId = new Map<string, FieldMappingRow>()
      for (const fm of allForTarget) {
        const existing = fmByFieldId.get(fm.target_field_id)
        if (!existing || (existing.map_node_id === null && fm.map_node_id !== null)) {
          fmByFieldId.set(fm.target_field_id, fm)
        }
      }

      let sourceObject: string | null = null
      let sourceRowCount: number | null = null
      const sourceRefTypes = new Set(['direct', 'concat', 'split', 'substring', 'dateformat', 'picklisttranslate', 'expression'])
      for (const fm of allForTarget) {
        if (sourceRefTypes.has(fm.rule_type)) {
          try {
            const cfg = JSON.parse(fm.rule_config) as { sourceObjectId?: string }
            if (cfg.sourceObjectId) {
              const srcObj = db.prepare(
                'SELECT name, row_count FROM data_objects WHERE id = ?'
              ).get(cfg.sourceObjectId) as { name: string; row_count: number | null } | undefined
              if (srcObj) { sourceObject = srcObj.name; sourceRowCount = srcObj.row_count; break }
            }
          } catch { /* skip */ }
        }
      }

      const mappingLines: MappingLine[] = targetFields.map(tf => {
        const fm = fmByFieldId.get(tf.id)
        if (!fm) return { targetField: tf.name, ruleType: 'unmapped', description: '(unmapped)', rawConfig: '{}' }
        return {
          targetField: fieldById.get(tf.id) ?? tf.name,
          ruleType: fm.rule_type,
          description: describeRule(fm.rule_type, fm.rule_config),
          notes: fm.notes ?? undefined,
          rawConfig: fm.rule_config,
        }
      })

      paths.push({ mapNodeId: null, sourceObject, sourceRowCount, filters: [], mappings: mappingLines })
    }

    result.push({
      transformationId: transformation.id,
      transformationName: transformation.name,
      targetObject: targetObj.name,
      targetObjectId,
      paths,
    })
  }

  return result
}
