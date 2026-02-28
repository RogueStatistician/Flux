/**
 * Picklist Mappings IPC handlers — CRUD for picklist_mappings + picklist_mapping_entries.
 */
import { ipcMain } from 'electron'
import { getDb } from '../db.js'

// ── Row types ──────────────────────────────────────────────────────────────────

interface MappingRow {
  id: string
  project_id: string
  name: string
  source_picklist_id: string | null
  target_picklist_id: string | null
  created_at: string
}

interface EntryRow {
  id: string
  mapping_id: string
  source_key: string
  target_key: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToMapping(r: MappingRow) {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    sourcePicklistId: r.source_picklist_id ?? undefined,
    targetPicklistId: r.target_picklist_id ?? undefined,
    createdAt: r.created_at,
  }
}

function rowToEntry(r: EntryRow) {
  return {
    id: r.id,
    mappingId: r.mapping_id,
    sourceKey: r.source_key,
    targetKey: r.target_key,
  }
}

function getProjectId(): string {
  const db = getDb()
  const row = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string } | undefined
  if (!row) throw new Error('No project is open.')
  return row.id
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerPlMappingHandlers(): void {

  /** Create a new picklist mapping. */
  ipcMain.handle(
    'plmappings:create',
    async (_e, name: string, sourcePicklistId?: string, targetPicklistId?: string) => {
      const db = getDb()
      const projectId = getProjectId()
      const id = crypto.randomUUID()
      const now = new Date().toISOString()

      db.prepare(`
        INSERT INTO picklist_mappings (id, project_id, name, source_picklist_id, target_picklist_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, projectId, name, sourcePicklistId ?? null, targetPicklistId ?? null, now)

      return rowToMapping(
        db.prepare('SELECT * FROM picklist_mappings WHERE id = ?').get(id) as MappingRow
      )
    }
  )

  /** List all picklist mappings for the current project. */
  ipcMain.handle('plmappings:list', async () => {
    const db = getDb()
    const projectId = getProjectId()
    const rows = db.prepare(
      'SELECT * FROM picklist_mappings WHERE project_id = ? ORDER BY created_at ASC'
    ).all(projectId) as MappingRow[]
    return rows.map(rowToMapping)
  })

  /** Get a single mapping with all its entries. */
  ipcMain.handle('plmappings:get', async (_e, id: string) => {
    const db = getDb()
    const mapping = db.prepare('SELECT * FROM picklist_mappings WHERE id = ?').get(id) as MappingRow | undefined
    if (!mapping) throw new Error(`Mapping ${id} not found.`)
    const entries = db.prepare(
      'SELECT * FROM picklist_mapping_entries WHERE mapping_id = ?'
    ).all(id) as EntryRow[]
    return { mapping: rowToMapping(mapping), entries: entries.map(rowToEntry) }
  })

  /** Update mapping name or linked picklists. */
  ipcMain.handle(
    'plmappings:update',
    async (
      _e,
      id: string,
      updates: Partial<{ name: string; sourcePicklistId: string | null; targetPicklistId: string | null }>
    ) => {
      const db = getDb()
      if (updates.name !== undefined)
        db.prepare('UPDATE picklist_mappings SET name = ? WHERE id = ?').run(updates.name, id)
      if ('sourcePicklistId' in updates)
        db.prepare('UPDATE picklist_mappings SET source_picklist_id = ? WHERE id = ?').run(updates.sourcePicklistId ?? null, id)
      if ('targetPicklistId' in updates)
        db.prepare('UPDATE picklist_mappings SET target_picklist_id = ? WHERE id = ?').run(updates.targetPicklistId ?? null, id)
      return rowToMapping(db.prepare('SELECT * FROM picklist_mappings WHERE id = ?').get(id) as MappingRow)
    }
  )

  /** Delete a picklist mapping (cascades to entries). */
  ipcMain.handle('plmappings:delete', async (_e, id: string) => {
    getDb().prepare('DELETE FROM picklist_mappings WHERE id = ?').run(id)
  })

  /**
   * Replace all entries for a mapping.
   * entries: Array<{ sourceKey: string; targetKey: string }>
   */
  ipcMain.handle(
    'plmappings:setEntries',
    async (_e, id: string, entries: Array<{ sourceKey: string; targetKey: string }>) => {
      const db = getDb()
      const del = db.prepare('DELETE FROM picklist_mapping_entries WHERE mapping_id = ?')
      const ins = db.prepare(`
        INSERT INTO picklist_mapping_entries (id, mapping_id, source_key, target_key)
        VALUES (?, ?, ?, ?)
      `)

      const replaceAll = db.transaction(() => {
        del.run(id)
        entries.forEach(e => {
          ins.run(crypto.randomUUID(), id, e.sourceKey, e.targetKey)
        })
      })
      replaceAll()

      return (
        db.prepare('SELECT * FROM picklist_mapping_entries WHERE mapping_id = ?').all(id) as EntryRow[]
      ).map(rowToEntry)
    }
  )
}
