/**
 * Picklists IPC handlers — CRUD for picklists + picklist_values.
 */
import { ipcMain } from 'electron'
import { getDb } from '../db.js'
import { parseFile } from '../importer.js'

// ── Row types ──────────────────────────────────────────────────────────────────

interface PicklistRow {
  id: string
  project_id: string
  name: string
  description: string | null
  side: string
  created_at: string
}

interface PicklistValueRow {
  id: string
  picklist_id: string
  key: string
  label: string | null
  position: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToPicklist(r: PicklistRow) {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    description: r.description ?? undefined,
    side: r.side as 'source' | 'target',
    createdAt: r.created_at,
  }
}

function rowToValue(r: PicklistValueRow) {
  return {
    id: r.id,
    picklistId: r.picklist_id,
    key: r.key,
    label: r.label ?? undefined,
    position: r.position,
  }
}

function getProjectId(): string {
  const db = getDb()
  const row = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string } | undefined
  if (!row) throw new Error('No project is open.')
  return row.id
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerPicklistHandlers(): void {

  /** Create a new picklist. */
  ipcMain.handle(
    'picklists:create',
    async (_e, side: 'source' | 'target', name: string, description?: string) => {
      const db = getDb()
      const projectId = getProjectId()
      const id = crypto.randomUUID()
      const now = new Date().toISOString()

      db.prepare(`
        INSERT INTO picklists (id, project_id, name, description, side, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, projectId, name, description ?? null, side, now)

      return rowToPicklist(
        db.prepare('SELECT * FROM picklists WHERE id = ?').get(id) as PicklistRow
      )
    }
  )

  /** List picklists for the current project, optionally filtered by side. */
  ipcMain.handle('picklists:list', async (_e, side?: 'source' | 'target') => {
    const db = getDb()
    const projectId = getProjectId()
    const rows = side
      ? db.prepare('SELECT * FROM picklists WHERE project_id = ? AND side = ? ORDER BY created_at ASC').all(projectId, side) as PicklistRow[]
      : db.prepare('SELECT * FROM picklists WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as PicklistRow[]
    return rows.map(rowToPicklist)
  })

  /** Get a single picklist with its values. */
  ipcMain.handle('picklists:get', async (_e, id: string) => {
    const db = getDb()
    const picklist = db.prepare('SELECT * FROM picklists WHERE id = ?').get(id) as PicklistRow | undefined
    if (!picklist) throw new Error(`Picklist ${id} not found.`)
    const values = db.prepare(
      'SELECT * FROM picklist_values WHERE picklist_id = ? ORDER BY position ASC'
    ).all(id) as PicklistValueRow[]
    return { picklist: rowToPicklist(picklist), values: values.map(rowToValue) }
  })

  /** Update picklist name / description. */
  ipcMain.handle(
    'picklists:update',
    async (_e, id: string, updates: Partial<{ name: string; description: string }>) => {
      const db = getDb()
      if (updates.name !== undefined)
        db.prepare('UPDATE picklists SET name = ? WHERE id = ?').run(updates.name, id)
      if ('description' in updates)
        db.prepare('UPDATE picklists SET description = ? WHERE id = ?').run(updates.description ?? null, id)
      return rowToPicklist(db.prepare('SELECT * FROM picklists WHERE id = ?').get(id) as PicklistRow)
    }
  )

  /** Delete a picklist (cascades to values). */
  ipcMain.handle('picklists:delete', async (_e, id: string) => {
    getDb().prepare('DELETE FROM picklists WHERE id = ?').run(id)
  })

  /**
   * Replace all values for a picklist.
   * Each value: { key: string; label?: string }
   */
  ipcMain.handle(
    'picklists:setValues',
    async (_e, id: string, values: Array<{ key: string; label?: string }>) => {
      const db = getDb()
      const del = db.prepare('DELETE FROM picklist_values WHERE picklist_id = ?')
      const ins = db.prepare(`
        INSERT INTO picklist_values (id, picklist_id, key, label, position)
        VALUES (?, ?, ?, ?, ?)
      `)

      const replaceAll = db.transaction(() => {
        del.run(id)
        values.forEach((v, i) => {
          ins.run(crypto.randomUUID(), id, v.key, v.label ?? null, i)
        })
      })
      replaceAll()

      return (
        db.prepare('SELECT * FROM picklist_values WHERE picklist_id = ? ORDER BY position ASC').all(id) as PicklistValueRow[]
      ).map(rowToValue)
    }
  )

  /**
   * Import picklist values from an Excel/CSV file.
   * keyCol and labelCol are header names (strings) from the file.
   */
  ipcMain.handle(
    'picklists:importFromFile',
    async (_e, id: string, filePath: string, keyCol: string, labelCol?: string) => {
      const { rows } = parseFile(filePath)

      const db = getDb()
      const del = db.prepare('DELETE FROM picklist_values WHERE picklist_id = ?')
      const ins = db.prepare(`
        INSERT INTO picklist_values (id, picklist_id, key, label, position)
        VALUES (?, ?, ?, ?, ?)
      `)

      const importAll = db.transaction(() => {
        del.run(id)
        let pos = 0
        rows.forEach(row => {
          const key = (row[keyCol] ?? '').trim()
          if (!key) return
          const label = labelCol ? (row[labelCol] ?? '').trim() || null : null
          ins.run(crypto.randomUUID(), id, key, label, pos++)
        })
      })
      importAll()

      const count = (db.prepare('SELECT COUNT(*) as c FROM picklist_values WHERE picklist_id = ?').get(id) as { c: number }).c
      return { valueCount: count }
    }
  )
}
