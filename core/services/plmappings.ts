/**
 * Picklist Mappings service — CRUD for picklist_mappings + picklist_mapping_entries.
 */
import ExcelJS from 'exceljs'
import { getDb } from '../db.js'
import { parseFile, parseAllSheets } from '../importer.js'

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

// ── Service functions ─────────────────────────────────────────────────────────

/** Create a new picklist mapping. */
export function createPlMapping(name: string, sourcePicklistId?: string, targetPicklistId?: string) {
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

/** List all picklist mappings for the current project. */
export function listPlMappings() {
  const db = getDb()
  const projectId = getProjectId()
  const rows = db.prepare(
    'SELECT * FROM picklist_mappings WHERE project_id = ? ORDER BY created_at ASC'
  ).all(projectId) as MappingRow[]
  return rows.map(rowToMapping)
}

/** Get a single mapping with all its entries. */
export function getPlMapping(id: string) {
  const db = getDb()
  const mapping = db.prepare('SELECT * FROM picklist_mappings WHERE id = ?').get(id) as MappingRow | undefined
  if (!mapping) throw new Error(`Mapping ${id} not found.`)
  const entries = db.prepare(
    'SELECT * FROM picklist_mapping_entries WHERE mapping_id = ?'
  ).all(id) as EntryRow[]
  return { mapping: rowToMapping(mapping), entries: entries.map(rowToEntry) }
}

/** Update mapping name or linked picklists. */
export function updatePlMapping(
  id: string,
  updates: Partial<{ name: string; sourcePicklistId: string | null; targetPicklistId: string | null }>
) {
  const db = getDb()
  if (updates.name !== undefined)
    db.prepare('UPDATE picklist_mappings SET name = ? WHERE id = ?').run(updates.name, id)
  if ('sourcePicklistId' in updates)
    db.prepare('UPDATE picklist_mappings SET source_picklist_id = ? WHERE id = ?').run(updates.sourcePicklistId ?? null, id)
  if ('targetPicklistId' in updates)
    db.prepare('UPDATE picklist_mappings SET target_picklist_id = ? WHERE id = ?').run(updates.targetPicklistId ?? null, id)
  return rowToMapping(db.prepare('SELECT * FROM picklist_mappings WHERE id = ?').get(id) as MappingRow)
}

/** Delete a picklist mapping (cascades to entries). */
export function deletePlMapping(id: string) {
  getDb().prepare('DELETE FROM picklist_mappings WHERE id = ?').run(id)
}

/**
 * Replace all entries for a mapping.
 * entries: Array<{ sourceKey: string; targetKey: string }>
 */
export function setPlMappingEntries(id: string, entries: Array<{ sourceKey: string; targetKey: string }>) {
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

/**
 * Import mapping entries from an Excel/CSV file.
 * sourceKeyCol and targetKeyCol are the column header names in the file.
 * Replaces all existing entries for the mapping.
 */
export async function importPlMappingEntriesFromFile(id: string, filePath: string, sourceKeyCol: string, targetKeyCol: string) {
  const { rows } = await parseFile(filePath)
  const db = getDb()
  const del = db.prepare('DELETE FROM picklist_mapping_entries WHERE mapping_id = ?')
  const ins = db.prepare(`
    INSERT INTO picklist_mapping_entries (id, mapping_id, source_key, target_key)
    VALUES (?, ?, ?, ?)
  `)

  const importAll = db.transaction(() => {
    del.run(id)
    rows.forEach(row => {
      const sourceKey = (row[sourceKeyCol] ?? '').trim()
      const targetKey = (row[targetKeyCol] ?? '').trim()
      if (!sourceKey || !targetKey) return
      ins.run(crypto.randomUUID(), id, sourceKey, targetKey)
    })
  })
  importAll()

  const count = (db.prepare('SELECT COUNT(*) as c FROM picklist_mapping_entries WHERE mapping_id = ?').get(id) as { c: number }).c
  return { entryCount: count }
}

/**
 * Bulk-import picklist mappings from a multi-sheet Excel file.
 * Each sheet becomes one mapping (named after the sheet).
 * Required columns: "source_key" and "target_key" (case-insensitive).
 * If a mapping with the same name already exists, its entries are replaced.
 */
export async function bulkImportPlMappingsFromFile(filePath: string) {
  const db = getDb()
  const projectId = getProjectId()
  const sheets = await parseAllSheets(filePath)

  const results: Array<{ name: string; created: boolean; entryCount: number }> = []
  const errors: Array<{ name: string; error: string }> = []

  const findCol = (headers: string[], names: string[]): string | undefined =>
    headers.find(h => names.includes(h.toLowerCase()))

  const insMapping = db.prepare(`
    INSERT INTO picklist_mappings (id, project_id, name, source_picklist_id, target_picklist_id, created_at)
    VALUES (?, ?, ?, NULL, NULL, ?)
  `)
  const delEntries = db.prepare('DELETE FROM picklist_mapping_entries WHERE mapping_id = ?')
  const insEntry = db.prepare(`
    INSERT INTO picklist_mapping_entries (id, mapping_id, source_key, target_key)
    VALUES (?, ?, ?, ?)
  `)

  for (const { sheetName, headers, rows } of sheets) {
    const name = sheetName.trim()
    if (!name) continue

    const sourceKeyCol = findCol(headers, ['source_key', 'source key', 'sourcekey'])
    const targetKeyCol = findCol(headers, ['target_key', 'target key', 'targetkey'])

    if (!sourceKeyCol || !targetKeyCol) {
      const missing = [!sourceKeyCol && 'source_key', !targetKeyCol && 'target_key'].filter(Boolean).join(', ')
      errors.push({ name, error: `Missing column(s): ${missing}. Headers: ${headers.join(', ') || '(empty)'}` })
      continue
    }

    const importSheet = db.transaction(() => {
      let mapping = db.prepare(
        'SELECT * FROM picklist_mappings WHERE project_id = ? AND name = ?'
      ).get(projectId, name) as MappingRow | undefined

      let created = false
      if (!mapping) {
        const newId = crypto.randomUUID()
        insMapping.run(newId, projectId, name, new Date().toISOString())
        mapping = db.prepare('SELECT * FROM picklist_mappings WHERE id = ?').get(newId) as MappingRow
        created = true
      }

      delEntries.run(mapping.id)
      let count = 0
      for (const row of rows) {
        const sourceKey = (row[sourceKeyCol] ?? '').trim()
        const targetKey = (row[targetKeyCol] ?? '').trim()
        if (!sourceKey || !targetKey) continue
        insEntry.run(crypto.randomUUID(), mapping.id, sourceKey, targetKey)
        count++
      }

      return { created, entryCount: count }
    })

    try {
      const { created, entryCount } = importSheet()
      results.push({ name, created, entryCount })
    } catch (e) {
      errors.push({ name, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return { results, errors }
}

/**
 * Export all picklist mappings to an Excel buffer.
 * One sheet per mapping, columns: source_key, target_key — matches bulk-import format.
 */
export async function exportPlMappingsToBuffer(): Promise<Buffer> {
  const db = getDb()
  const projectId = getProjectId()

  const mappings = db.prepare(
    'SELECT * FROM picklist_mappings WHERE project_id = ? ORDER BY name ASC'
  ).all(projectId) as MappingRow[]

  const wb = new ExcelJS.Workbook()

  for (const m of mappings) {
    const entries = db.prepare(
      'SELECT * FROM picklist_mapping_entries WHERE mapping_id = ?'
    ).all(m.id) as EntryRow[]

    const sheetName = m.name.slice(0, 31)
    const ws = wb.addWorksheet(sheetName)
    ws.addRow(['source_key', 'target_key'])
    for (const e of entries) {
      ws.addRow([e.source_key, e.target_key])
    }
  }

  if (mappings.length === 0) wb.addWorksheet('Sheet1')

  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer)
}
