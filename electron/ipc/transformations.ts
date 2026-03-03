/**
 * Transformations IPC handlers.
 * Covers transformation CRUD, canvas state persistence, and field mapping rules.
 */
import { ipcMain } from 'electron'
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
  }
}

function getProjectId(): string {
  const db = getDb()
  const row = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string } | undefined
  if (!row) throw new Error('No project is open.')
  return row.id
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerTransformationHandlers(): void {

  /** Create a new transformation. */
  ipcMain.handle('transformations:create', async (_e, name: string, description?: string) => {
    const db = getDb()
    const projectId = getProjectId()
    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO transformations (id, project_id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, projectId, name, description ?? null, now, now)

    return rowToTransformation(
      db.prepare('SELECT * FROM transformations WHERE id = ?').get(id) as TransformationRow
    )
  })

  /** List all transformations for the current project. */
  ipcMain.handle('transformations:list', async () => {
    const db = getDb()
    const projectId = getProjectId()
    const rows = db.prepare(
      'SELECT * FROM transformations WHERE project_id = ? ORDER BY created_at ASC'
    ).all(projectId) as TransformationRow[]
    return rows.map(rowToTransformation)
  })

  /** Get a single transformation (includes canvasState). */
  ipcMain.handle('transformations:get', async (_e, id: string) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM transformations WHERE id = ?').get(id) as TransformationRow | undefined
    if (!row) throw new Error(`Transformation ${id} not found.`)
    return rowToTransformation(row)
  })

  /** Update transformation name / description. */
  ipcMain.handle(
    'transformations:update',
    async (_e, id: string, updates: Partial<{ name: string; description: string }>) => {
      const db = getDb()
      const now = new Date().toISOString()
      if (updates.name !== undefined)
        db.prepare('UPDATE transformations SET name = ?, updated_at = ? WHERE id = ?').run(updates.name, now, id)
      if ('description' in updates)
        db.prepare('UPDATE transformations SET description = ?, updated_at = ? WHERE id = ?').run(updates.description ?? null, now, id)
      return rowToTransformation(db.prepare('SELECT * FROM transformations WHERE id = ?').get(id) as TransformationRow)
    }
  )

  /** Persist React Flow canvas state (node positions / viewport). */
  ipcMain.handle('transformations:saveCanvas', async (_e, id: string, canvasState: string) => {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare('UPDATE transformations SET canvas_state = ?, updated_at = ? WHERE id = ?').run(canvasState, now, id)
  })

  /** Delete a transformation and all associated data. */
  ipcMain.handle('transformations:delete', async (_e, id: string) => {
    const db = getDb()
    // runs.transformation_id has no ON DELETE CASCADE, so delete manually.
    // run_issues.run_id does CASCADE, so those are cleaned up automatically.
    db.prepare('DELETE FROM runs WHERE transformation_id = ?').run(id)
    // field_mappings has ON DELETE CASCADE, but this also handles any stragglers.
    db.prepare('DELETE FROM transformations WHERE id = ?').run(id)
  })

  // ── Field mapping rules ──────────────────────────────────────────────────────

  /** Create a new field mapping rule. */
  ipcMain.handle(
    'transformations:createFieldMapping',
    async (
      _e,
      transformationId: string,
      targetObjectId: string,
      targetFieldId: string,
      ruleType: string,
      ruleConfig: string,
      notes?: string
    ) => {
      const db = getDb()
      // Remove any existing mapping for the same target field in this transformation
      db.prepare(
        'DELETE FROM field_mappings WHERE transformation_id = ? AND target_field_id = ?'
      ).run(transformationId, targetFieldId)

      const id = crypto.randomUUID()
      db.prepare(`
        INSERT INTO field_mappings
          (id, transformation_id, target_object_id, target_field_id, rule_type, rule_config, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, transformationId, targetObjectId, targetFieldId, ruleType, ruleConfig, notes ?? null)

      return rowToFieldMapping(
        db.prepare('SELECT * FROM field_mappings WHERE id = ?').get(id) as FieldMappingRow
      )
    }
  )

  /** Update an existing field mapping rule type / config. */
  ipcMain.handle(
    'transformations:updateFieldMapping',
    async (_e, id: string, updates: Partial<{ ruleType: string; ruleConfig: string; notes: string }>) => {
      const db = getDb()
      if (updates.ruleType !== undefined)
        db.prepare('UPDATE field_mappings SET rule_type = ? WHERE id = ?').run(updates.ruleType, id)
      if (updates.ruleConfig !== undefined)
        db.prepare('UPDATE field_mappings SET rule_config = ? WHERE id = ?').run(updates.ruleConfig, id)
      if ('notes' in updates)
        db.prepare('UPDATE field_mappings SET notes = ? WHERE id = ?').run(updates.notes ?? null, id)
      return rowToFieldMapping(db.prepare('SELECT * FROM field_mappings WHERE id = ?').get(id) as FieldMappingRow)
    }
  )

  /** Delete a single field mapping rule by id. */
  ipcMain.handle('transformations:deleteFieldMapping', async (_e, id: string) => {
    getDb().prepare('DELETE FROM field_mappings WHERE id = ?').run(id)
  })

  /** Delete ALL field mapping rules for a given target object in a transformation. */
  ipcMain.handle('transformations:deleteFieldMappingsByTarget', async (_e, transformationId: string, targetObjectId: string) => {
    getDb().prepare(
      'DELETE FROM field_mappings WHERE transformation_id = ? AND target_object_id = ?'
    ).run(transformationId, targetObjectId)
  })

  /** Get all field mapping rules for a transformation. */
  ipcMain.handle('transformations:getFieldMappings', async (_e, transformationId: string) => {
    const db = getDb()
    const rows = db.prepare(
      'SELECT * FROM field_mappings WHERE transformation_id = ?'
    ).all(transformationId) as FieldMappingRow[]
    return rows.map(rowToFieldMapping)
  })
}
