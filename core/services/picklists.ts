/**
 * Picklists service — CRUD for picklists + picklist_values.
 */
import ExcelJS from 'exceljs'
import { getDb, getCurrentProjectId } from '../db.js'
import { parseFile, parseAllSheets } from '../importer.js'

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

// ── Service functions ─────────────────────────────────────────────────────────

/** Create a new picklist. */
export function createPicklist(side: 'source' | 'target', name: string, description?: string) {
  const db = getDb()
  const projectId = getCurrentProjectId()
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

/** List picklists for the current project, optionally filtered by side. */
export function listPicklists(side?: 'source' | 'target') {
  const db = getDb()
  const projectId = getCurrentProjectId()
  const rows = side
    ? db.prepare('SELECT * FROM picklists WHERE project_id = ? AND side = ? ORDER BY created_at ASC').all(projectId, side) as PicklistRow[]
    : db.prepare('SELECT * FROM picklists WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as PicklistRow[]
  return rows.map(rowToPicklist)
}

/** Get a single picklist with its values. */
export function getPicklist(id: string) {
  const db = getDb()
  const picklist = db.prepare('SELECT * FROM picklists WHERE id = ?').get(id) as PicklistRow | undefined
  if (!picklist) throw new Error(`Picklist ${id} not found.`)
  const values = db.prepare(
    'SELECT * FROM picklist_values WHERE picklist_id = ? ORDER BY position ASC'
  ).all(id) as PicklistValueRow[]
  return { picklist: rowToPicklist(picklist), values: values.map(rowToValue) }
}

/** Update picklist name / description. */
export function updatePicklist(id: string, updates: Partial<{ name: string; description: string }>) {
  const db = getDb()
  if (updates.name !== undefined)
    db.prepare('UPDATE picklists SET name = ? WHERE id = ?').run(updates.name, id)
  if ('description' in updates)
    db.prepare('UPDATE picklists SET description = ? WHERE id = ?').run(updates.description ?? null, id)
  return rowToPicklist(db.prepare('SELECT * FROM picklists WHERE id = ?').get(id) as PicklistRow)
}

/** Delete a picklist (cascades to values). */
export function deletePicklist(id: string) {
  getDb().prepare('DELETE FROM picklists WHERE id = ?').run(id)
}

/**
 * Replace all values for a picklist.
 * Each value: { key: string; label?: string }
 */
export function setPicklistValues(id: string, values: Array<{ key: string; label?: string }>) {
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

/**
 * Import picklist values from an Excel/CSV file.
 * keyCol and labelCol are header names (strings) from the file.
 */
export async function importPicklistFromFile(id: string, filePath: string, keyCol: string, labelCol?: string) {
  const { rows } = await parseFile(filePath)

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

/**
 * Bulk-import picklists from a multi-sheet Excel file.
 * Each sheet becomes one picklist (named after the sheet).
 * Required column: "key" (case-insensitive). Optional: "label".
 * If a picklist with the same name already exists, its values are replaced.
 */
export async function bulkImportPicklistsFromFile(filePath: string, side: 'source' | 'target') {
  const db = getDb()
  const projectId = getCurrentProjectId()
  const sheets = await parseAllSheets(filePath)

  const results: Array<{ name: string; created: boolean; valueCount: number }> = []
  const errors: Array<{ name: string; error: string }> = []

  const findCol = (headers: string[], names: string[]): string | undefined =>
    headers.find(h => names.includes(h.toLowerCase()))

  const insPicklist = db.prepare(`
    INSERT INTO picklists (id, project_id, name, description, side, created_at)
    VALUES (?, ?, ?, NULL, ?, ?)
  `)
  const delValues = db.prepare('DELETE FROM picklist_values WHERE picklist_id = ?')
  const insValue = db.prepare(`
    INSERT INTO picklist_values (id, picklist_id, key, label, position)
    VALUES (?, ?, ?, ?, ?)
  `)

  for (const { sheetName, headers, rows } of sheets) {
    const name = sheetName.trim()
    if (!name) continue

    const keyCol = findCol(headers, ['key'])
    if (!keyCol) {
      errors.push({ name, error: `No "key" column found. Headers: ${headers.join(', ') || '(empty)'}` })
      continue
    }
    const labelCol = findCol(headers, ['label'])

    const importSheet = db.transaction(() => {
      // Find or create the picklist
      let pl = db.prepare(
        'SELECT * FROM picklists WHERE project_id = ? AND side = ? AND name = ?'
      ).get(projectId, side, name) as PicklistRow | undefined

      let created = false
      if (!pl) {
        const newId = crypto.randomUUID()
        insPicklist.run(newId, projectId, name, side, new Date().toISOString())
        pl = db.prepare('SELECT * FROM picklists WHERE id = ?').get(newId) as PicklistRow
        created = true
      }

      // Replace values
      delValues.run(pl.id)
      let pos = 0
      for (const row of rows) {
        const key = (row[keyCol] ?? '').trim()
        if (!key) continue
        const label = labelCol ? (row[labelCol] ?? '').trim() || null : null
        insValue.run(crypto.randomUUID(), pl.id, key, label, pos++)
      }

      return { created, valueCount: pos }
    })

    try {
      const { created, valueCount } = importSheet()
      results.push({ name, created, valueCount })
    } catch (e) {
      errors.push({ name, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return { results, errors }
}

/**
 * Export all picklists (optionally filtered by side) to an Excel buffer.
 * One sheet per picklist, columns: key, label — matches bulk-import format.
 */
export async function exportPicklistsToBuffer(side?: 'source' | 'target'): Promise<Buffer> {
  const db = getDb()
  const projectId = getCurrentProjectId()

  const lists = side
    ? (db.prepare('SELECT * FROM picklists WHERE project_id = ? AND side = ? ORDER BY name ASC').all(projectId, side) as PicklistRow[])
    : (db.prepare('SELECT * FROM picklists WHERE project_id = ? ORDER BY name ASC').all(projectId) as PicklistRow[])

  const wb = new ExcelJS.Workbook()

  for (const pl of lists) {
    const values = db.prepare(
      'SELECT * FROM picklist_values WHERE picklist_id = ? ORDER BY position ASC'
    ).all(pl.id) as PicklistValueRow[]

    const sheetName = pl.name.slice(0, 31)
    const ws = wb.addWorksheet(sheetName)
    ws.addRow(['key', 'label'])
    for (const v of values) {
      ws.addRow([v.key, v.label ?? ''])
    }
  }

  // Add a blank sheet so the workbook is valid even when there are no picklists
  if (lists.length === 0) wb.addWorksheet('Sheet1')

  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer)
}
