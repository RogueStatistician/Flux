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
}

export interface QueryPath {
  mapNodeId: string | null
  sourceObject: string | null
  sourceRowCount: number | null
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
interface CanvasEdge { id: string; source: string; target: string }
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
interface FilterNodeData { field?: string; operator?: string; value?: string; sourceObjectId?: string }

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

/** Find the source object ID by walking canvas edges from a map node. */
function findSourceObjectId(mapNodeId: string, canvas: Canvas): string | null {
  // Walk edges: mapNode ← ... ← sourceObject node
  const visited = new Set<string>()
  const queue = [mapNodeId]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)
    // Find what connects INTO `current`
    for (const edge of canvas.edges) {
      if (edge.target === current) {
        const sourceNode = canvas.nodes.find(n => n.id === edge.source)
        if (!sourceNode) continue
        if (sourceNode.type === 'sourceObject') {
          return (sourceNode.data?.objectId as string) ?? null
        }
        // Continue walking upstream
        queue.push(edge.source)
      }
    }
  }
  return null
}

/** Extract filter conditions visible on canvas edges going into a map node. */
function findFilterDescriptions(mapNodeId: string, canvas: Canvas): string[] {
  const filters: string[] = []
  for (const edge of canvas.edges) {
    if (edge.target === mapNodeId) {
      const upstream = canvas.nodes.find(n => n.id === edge.source)
      if (upstream?.type === 'filterOperator') {
        const d = upstream.data as FilterNodeData
        if (d?.field) {
          filters.push(`${d.field} ${d.operator ?? '='} "${d.value ?? ''}"`)
        }
        // Recurse to find more filters upstream
        const moreFilters = findFilterDescriptions(upstream.id, canvas)
        filters.push(...moreFilters)
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

        const sourceObjectId = canvas ? findSourceObjectId(mapNodeId, canvas) : null
        let sourceObject: string | null = null
        let sourceRowCount: number | null = null

        if (sourceObjectId) {
          const srcObj = db.prepare(
            'SELECT name, row_count FROM data_objects WHERE id = ?'
          ).get(sourceObjectId) as { name: string; row_count: number | null } | undefined
          if (srcObj) { sourceObject = srcObj.name; sourceRowCount = srcObj.row_count }
        }

        // If no canvas source found, try to infer from rule configs
        if (!sourceObject) {
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
          if (!fm) return { targetField: tf.name, ruleType: 'unmapped', description: '(unmapped)' }
          return {
            targetField: tf.name,
            ruleType: fm.rule_type,
            description: describeRule(fm.rule_type, fm.rule_config),
            notes: fm.notes ?? undefined,
          }
        })

        paths.push({ mapNodeId, sourceObject, sourceRowCount, filters, mappings: mappingLines })
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
        if (!fm) return { targetField: tf.name, ruleType: 'unmapped', description: '(unmapped)' }
        return {
          targetField: fieldById.get(tf.id) ?? tf.name,
          ruleType: fm.rule_type,
          description: describeRule(fm.rule_type, fm.rule_config),
          notes: fm.notes ?? undefined,
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
