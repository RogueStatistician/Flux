/**
 * Transformations service — CRUD for transformations, canvas state, and field mapping rules.
 */
import { getDb } from '../db.js'

// ── Row types ──────────────────────────────────────────────────────────────────

interface TransformationRow {
  id: string
  project_id: string
  name: string
  description: string | null
  canvas_state: string | null
  created_at: string
  updated_at: string
}

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToTransformation(r: TransformationRow) {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    description: r.description ?? undefined,
    canvasState: r.canvas_state ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToFieldMapping(r: FieldMappingRow) {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    targetObjectId: r.target_object_id,
    targetFieldId: r.target_field_id,
    ruleType: r.rule_type,
    ruleConfig: r.rule_config,
    notes: r.notes ?? undefined,
    mapNodeId: r.map_node_id ?? undefined,
  }
}

function getProjectId(): string {
  const db = getDb()
  const row = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string } | undefined
  if (!row) throw new Error('No project is open.')
  return row.id
}

// ── Service functions ─────────────────────────────────────────────────────────

/** Create a new transformation. */
export function createTransformation(name: string, description?: string) {
  const db = getDb()
  const projectId = getProjectId()

  const dup = db.prepare('SELECT COUNT(*) as c FROM transformations WHERE project_id = ? AND name = ?').get(projectId, name) as { c: number }
  if (dup.c > 0) throw new Error(`A transformation named "${name}" already exists.`)

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO transformations (id, project_id, name, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, projectId, name, description ?? null, now, now)

  return rowToTransformation(
    db.prepare('SELECT * FROM transformations WHERE id = ?').get(id) as TransformationRow
  )
}

/** List all transformations for the current project. */
export function listTransformations() {
  const db = getDb()
  const projectId = getProjectId()
  const rows = db.prepare(
    'SELECT * FROM transformations WHERE project_id = ? ORDER BY created_at ASC'
  ).all(projectId) as TransformationRow[]
  return rows.map(rowToTransformation)
}

/** Get a single transformation (includes canvasState). */
export function getTransformation(id: string) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM transformations WHERE id = ?').get(id) as TransformationRow | undefined
  if (!row) throw new Error(`Transformation ${id} not found.`)
  return rowToTransformation(row)
}

/** Update transformation name / description. */
export function updateTransformation(id: string, updates: Partial<{ name: string; description: string }>) {
  const db = getDb()
  const now = new Date().toISOString()
  if (updates.name !== undefined) {
    const cur = db.prepare('SELECT project_id FROM transformations WHERE id = ?').get(id) as { project_id: string } | undefined
    if (cur) {
      const dup = db.prepare('SELECT COUNT(*) as c FROM transformations WHERE project_id = ? AND name = ? AND id != ?').get(cur.project_id, updates.name, id) as { c: number }
      if (dup.c > 0) throw new Error(`A transformation named "${updates.name}" already exists.`)
    }
    db.prepare('UPDATE transformations SET name = ?, updated_at = ? WHERE id = ?').run(updates.name, now, id)
  }
  if ('description' in updates)
    db.prepare('UPDATE transformations SET description = ?, updated_at = ? WHERE id = ?').run(updates.description ?? null, now, id)
  return rowToTransformation(db.prepare('SELECT * FROM transformations WHERE id = ?').get(id) as TransformationRow)
}

/** Persist React Flow canvas state (node positions / viewport). */
export function saveCanvas(id: string, canvasState: string) {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare('UPDATE transformations SET canvas_state = ?, updated_at = ? WHERE id = ?').run(canvasState, now, id)
}

/** Delete a transformation and all associated data. */
export function deleteTransformation(id: string) {
  const db = getDb()
  // runs.transformation_id has no ON DELETE CASCADE, so delete manually.
  // run_issues.run_id does CASCADE, so those are cleaned up automatically.
  db.prepare('DELETE FROM runs WHERE transformation_id = ?').run(id)
  // field_mappings has ON DELETE CASCADE, but this also handles any stragglers.
  db.prepare('DELETE FROM transformations WHERE id = ?').run(id)
}

/** Duplicate a transformation (new name, same canvas state and field mappings). */
export function duplicateTransformation(id: string) {
  const db = getDb()
  const projectId = getProjectId()
  const src = db.prepare('SELECT * FROM transformations WHERE id = ?').get(id) as TransformationRow | undefined
  if (!src) throw new Error(`Transformation ${id} not found.`)

  const newId = crypto.randomUUID()
  const now = new Date().toISOString()

  // Find a unique name: "X (copy)", "X (copy 2)", "X (copy 3)", …
  const existingNames = (db.prepare('SELECT name FROM transformations WHERE project_id = ?').all(projectId) as { name: string }[]).map(r => r.name)
  let newName = `${src.name} (copy)`
  let suffix = 2
  while (existingNames.includes(newName)) {
    newName = `${src.name} (copy ${suffix++})`
  }

  db.prepare(`
    INSERT INTO transformations (id, project_id, name, description, canvas_state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(newId, projectId, newName, src.description, src.canvas_state, now, now)

  // Copy all field mappings with new IDs
  const mappings = db.prepare(
    'SELECT * FROM field_mappings WHERE transformation_id = ?'
  ).all(id) as FieldMappingRow[]

  for (const m of mappings) {
    db.prepare(`
      INSERT INTO field_mappings
        (id, transformation_id, target_object_id, target_field_id, rule_type, rule_config, notes, map_node_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), newId, m.target_object_id, m.target_field_id, m.rule_type, m.rule_config, m.notes, m.map_node_id)
  }

  return rowToTransformation(
    db.prepare('SELECT * FROM transformations WHERE id = ?').get(newId) as TransformationRow
  )
}

// ── Field mapping rules ──────────────────────────────────────────────────────

/** Create a new field mapping rule. */
export function createFieldMapping(
  transformationId: string,
  targetObjectId: string,
  targetFieldId: string,
  ruleType: string,
  ruleConfig: string,
  notes?: string,
  mapNodeId?: string
) {
  const db = getDb()
  // Remove any existing mapping for the same target field, scoped to the same MapNode
  // (or to legacy null-scoped mappings when mapNodeId is absent).
  if (mapNodeId) {
    db.prepare(
      'DELETE FROM field_mappings WHERE transformation_id = ? AND target_field_id = ? AND map_node_id = ?'
    ).run(transformationId, targetFieldId, mapNodeId)
  } else {
    db.prepare(
      'DELETE FROM field_mappings WHERE transformation_id = ? AND target_field_id = ? AND map_node_id IS NULL'
    ).run(transformationId, targetFieldId)
  }

  const id = crypto.randomUUID()
  db.prepare(`
    INSERT INTO field_mappings
      (id, transformation_id, target_object_id, target_field_id, rule_type, rule_config, notes, map_node_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, transformationId, targetObjectId, targetFieldId, ruleType, ruleConfig, notes ?? null, mapNodeId ?? null)

  return rowToFieldMapping(
    db.prepare('SELECT * FROM field_mappings WHERE id = ?').get(id) as FieldMappingRow
  )
}

/** Update an existing field mapping rule type / config. */
export function updateFieldMapping(id: string, updates: Partial<{ ruleType: string; ruleConfig: string; notes: string }>) {
  const db = getDb()
  if (updates.ruleType !== undefined)
    db.prepare('UPDATE field_mappings SET rule_type = ? WHERE id = ?').run(updates.ruleType, id)
  if (updates.ruleConfig !== undefined)
    db.prepare('UPDATE field_mappings SET rule_config = ? WHERE id = ?').run(updates.ruleConfig, id)
  if ('notes' in updates)
    db.prepare('UPDATE field_mappings SET notes = ? WHERE id = ?').run(updates.notes ?? null, id)
  return rowToFieldMapping(db.prepare('SELECT * FROM field_mappings WHERE id = ?').get(id) as FieldMappingRow)
}

/** Delete a single field mapping rule by id. */
export function deleteFieldMapping(id: string) {
  getDb().prepare('DELETE FROM field_mappings WHERE id = ?').run(id)
}

/** Delete ALL field mapping rules for a given target object in a transformation. */
export function deleteFieldMappingsByTarget(transformationId: string, targetObjectId: string) {
  getDb().prepare(
    'DELETE FROM field_mappings WHERE transformation_id = ? AND target_object_id = ?'
  ).run(transformationId, targetObjectId)
}

/** Get all field mapping rules for a transformation. */
export function getFieldMappings(transformationId: string) {
  const db = getDb()
  const rows = db.prepare(
    'SELECT * FROM field_mappings WHERE transformation_id = ?'
  ).all(transformationId) as FieldMappingRow[]
  return rows.map(rowToFieldMapping)
}

/** Get field mapping rules owned by a specific MapNode. */
export function getFieldMappingsByNode(mapNodeId: string) {
  const db = getDb()
  const rows = db.prepare(
    'SELECT * FROM field_mappings WHERE map_node_id = ?'
  ).all(mapNodeId) as FieldMappingRow[]
  return rows.map(rowToFieldMapping)
}

/** Delete all field mapping rules owned by a specific MapNode. */
export function deleteFieldMappingsByNode(mapNodeId: string) {
  getDb().prepare('DELETE FROM field_mappings WHERE map_node_id = ?').run(mapNodeId)
}
