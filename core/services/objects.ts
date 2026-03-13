/**
 * Objects service — CRUD for data_objects, object_fields, source_rows.
 */
import { getDb } from '../db.js'
import { parseFile, parseHeaders, inferSchema, type ParseOptions } from '../importer.js'

// ── Row types ─────────────────────────────────────────────────────────────────

interface ObjectRow {
  id: string
  project_id: string
  role: string
  name: string
  description: string | null
  system_name: string | null
  file_name: string | null
  row_count: number | null
  output_format: string
  template_header_row: number | null
  template_data_start_row: number | null
  template_skip_columns: number | null
  template_file_path: string | null
  created_at: string
  updated_at: string
}

interface FieldRow {
  id: string
  object_id: string
  name: string
  description: string | null
  data_type: string
  is_required: number
  is_nullable: number
  picklist_id: string | null
  date_format: string | null
  max_length: number | null
  position: number
  notes: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToObject(r: ObjectRow) {
  return {
    id: r.id,
    projectId: r.project_id,
    role: r.role as 'source' | 'target',
    name: r.name,
    description: r.description ?? undefined,
    systemName: r.system_name ?? undefined,
    fileName: r.file_name ?? undefined,
    rowCount: r.row_count ?? undefined,
    outputFormat: r.output_format as 'xlsx' | 'csv',
    templateHeaderRow: r.template_header_row ?? undefined,
    templateDataStartRow: r.template_data_start_row ?? undefined,
    templateSkipColumns: r.template_skip_columns ?? undefined,
    templateFilePath: r.template_file_path ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToField(r: FieldRow) {
  return {
    id: r.id,
    objectId: r.object_id,
    name: r.name,
    description: r.description ?? undefined,
    dataType: r.data_type as import('../../src/types/index.js').FieldType,
    isRequired: r.is_required === 1,
    isNullable: r.is_nullable === 1,
    picklistId: r.picklist_id ?? undefined,
    dateFormat: r.date_format ?? undefined,
    maxLength: r.max_length ?? undefined,
    position: r.position,
    notes: r.notes ?? undefined,
  }
}

function getProjectId(): string {
  const db = getDb()
  const row = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string } | undefined
  if (!row) throw new Error('No project is open.')
  return row.id
}

// ── Service functions ─────────────────────────────────────────────────────────

/** Infer schema from an Excel/CSV file without touching the DB. */
export async function inferSchemaFromFile(filePath: string, options?: ParseOptions) {
  const { headers, rows } = await parseFile(filePath, 200, options)
  const fields = inferSchema(headers, rows)
  return { headers, fields }
}

/** Read only the headers from a file (for target template import). */
export async function inferSchemaFromHeadersOnly(filePath: string, options?: ParseOptions) {
  const headers = await parseHeaders(filePath, options)
  const fields = inferSchema(headers, [])
  return { headers, fields }
}

/** Create a new data object (source or target). */
export function createObject(
  role: 'source' | 'target',
  name: string,
  description?: string,
  systemName?: string,
  outputFormat: 'xlsx' | 'csv' = 'xlsx',
  templateConfig?: {
    /** 0-based index of the row containing column headers. */
    headerRow?: number
    /**
     * 0-based index of the first data row in the output file.
     * Defaults to headerRow + 1 when omitted.
     */
    dataStartRow?: number
    /** Number of leading columns to skip (default 0). */
    skipColumns?: number
    /** Absolute path to the template file for structure-preserving output. */
    filePath?: string
  }
) {
  const db = getDb()
  const projectId = getProjectId()

  const dup = db.prepare('SELECT COUNT(*) as c FROM data_objects WHERE project_id = ? AND role = ? AND name = ?').get(projectId, role, name) as { c: number }
  if (dup.c > 0) throw new Error(`A ${role} named "${name}" already exists.`)

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO data_objects
      (id, project_id, role, name, description, system_name, output_format,
       template_header_row, template_data_start_row, template_skip_columns, template_file_path,
       created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, projectId, role, name,
    description ?? null, systemName ?? null, outputFormat,
    templateConfig?.headerRow ?? null,
    templateConfig?.dataStartRow ?? null,
    templateConfig?.skipColumns ?? null,
    templateConfig?.filePath ?? null,
    now, now
  )

  return rowToObject(
    db.prepare('SELECT * FROM data_objects WHERE id = ?').get(id) as ObjectRow
  )
}

/** List all data objects for the current project, optionally filtered by role. */
export function listObjects(role?: 'source' | 'target') {
  const db = getDb()
  const projectId = getProjectId()
  const rows = role
    ? db.prepare('SELECT * FROM data_objects WHERE project_id = ? AND role = ? ORDER BY created_at ASC').all(projectId, role) as ObjectRow[]
    : db.prepare('SELECT * FROM data_objects WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as ObjectRow[]
  return rows.map(rowToObject)
}

/** Get a single data object plus its field schema. */
export function getObject(id: string) {
  const db = getDb()
  const object = db.prepare('SELECT * FROM data_objects WHERE id = ?').get(id) as ObjectRow | undefined
  if (!object) throw new Error(`Object ${id} not found.`)
  const fields = db.prepare('SELECT * FROM object_fields WHERE object_id = ? ORDER BY position ASC').all(id) as FieldRow[]
  return { object: rowToObject(object), fields: fields.map(rowToField) }
}

/** Update editable metadata on a data object. */
export function updateObject(
  id: string,
  updates: Partial<{ name: string; description: string; systemName: string; outputFormat: 'xlsx' | 'csv' }>
) {
  const db = getDb()
  const now = new Date().toISOString()
  if (updates.name !== undefined) {
    const cur = db.prepare('SELECT role, project_id FROM data_objects WHERE id = ?').get(id) as { role: string; project_id: string } | undefined
    if (cur) {
      const dup = db.prepare('SELECT COUNT(*) as c FROM data_objects WHERE project_id = ? AND role = ? AND name = ? AND id != ?').get(cur.project_id, cur.role, updates.name, id) as { c: number }
      if (dup.c > 0) throw new Error(`A ${cur.role} named "${updates.name}" already exists.`)
    }
    db.prepare('UPDATE data_objects SET name = ?, updated_at = ? WHERE id = ?').run(updates.name, now, id)
  }
  if ('description' in updates)
    db.prepare('UPDATE data_objects SET description = ?, updated_at = ? WHERE id = ?').run(updates.description ?? null, now, id)
  if ('systemName' in updates)
    db.prepare('UPDATE data_objects SET system_name = ?, updated_at = ? WHERE id = ?').run(updates.systemName ?? null, now, id)
  if (updates.outputFormat !== undefined)
    db.prepare('UPDATE data_objects SET output_format = ?, updated_at = ? WHERE id = ?').run(updates.outputFormat, now, id)
  return rowToObject(db.prepare('SELECT * FROM data_objects WHERE id = ?').get(id) as ObjectRow)
}

/** Delete a data object (cascades to fields and source rows). */
export function deleteObject(id: string) {
  getDb().prepare('DELETE FROM data_objects WHERE id = ?').run(id)
}

/**
 * Import rows from a file into an existing data object.
 * Replaces any existing source_rows for that object.
 */
export async function importRows(id: string, filePath: string, options?: ParseOptions) {
  const db = getDb()
  const { rows } = await parseFile(filePath, undefined, options)

  const deleteRows = db.prepare('DELETE FROM source_rows WHERE object_id = ?')
  const insertRow = db.prepare(
    'INSERT INTO source_rows (object_id, row_index, data) VALUES (?, ?, ?)'
  )
  const updateCount = db.prepare(
    'UPDATE data_objects SET row_count = ?, file_name = ?, updated_at = ? WHERE id = ?'
  )

  const fileName = filePath.split(/[\\/]/).pop() ?? filePath
  const now = new Date().toISOString()

  const importAll = db.transaction(() => {
    deleteRows.run(id)
    rows.forEach((row, i) => insertRow.run(id, i, JSON.stringify(row)))
    updateCount.run(rows.length, fileName, now, id)
  })
  importAll()

  return { rowCount: rows.length }
}

/** Get a paginated slice of source rows for a data object. */
export function getRows(id: string, offset: number, limit: number) {
  const db = getDb()
  const total = (db.prepare('SELECT COUNT(*) as c FROM source_rows WHERE object_id = ?').get(id) as { c: number }).c
  const rows = db.prepare(
    'SELECT data FROM source_rows WHERE object_id = ? ORDER BY row_index ASC LIMIT ? OFFSET ?'
  ).all(id, limit, offset) as { data: string }[]
  return { rows: rows.map(r => JSON.parse(r.data) as Record<string, string>), total }
}

/**
 * Replace all fields for a data object.
 * Fields are provided in display order; positions are assigned automatically.
 */
export function upsertFields(
  objectId: string,
  fields: Array<{
    name: string
    description?: string
    dataType: string
    isRequired: boolean
    isNullable: boolean
    picklistId?: string
    dateFormat?: string
    maxLength?: number
    notes?: string
  }>
) {
  const db = getDb()

  // Load existing fields so we can reuse their IDs (preserving field_mappings FK references)
  const existing = db.prepare(
    'SELECT id, name FROM object_fields WHERE object_id = ?'
  ).all(objectId) as { id: string; name: string }[]
  const existingById = new Map(existing.map(r => [r.name, r.id]))
  const incomingNames = new Set(fields.map(f => f.name))

  const delById = db.prepare('DELETE FROM object_fields WHERE id = ?')
  const ins = db.prepare(`
    INSERT INTO object_fields
      (id, object_id, name, description, data_type, is_required, is_nullable,
       picklist_id, date_format, max_length, position, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const upd = db.prepare(`
    UPDATE object_fields
    SET description = ?, data_type = ?, is_required = ?, is_nullable = ?,
        picklist_id = ?, date_format = ?, max_length = ?, position = ?, notes = ?
    WHERE id = ?
  `)

  const upsertAll = db.transaction(() => {
    // Delete fields that are no longer in the incoming list
    for (const r of existing) {
      if (!incomingNames.has(r.name)) delById.run(r.id)
    }
    fields.forEach((f, i) => {
      const existingId = existingById.get(f.name)
      if (existingId) {
        upd.run(
          f.description ?? null,
          f.dataType,
          f.isRequired ? 1 : 0,
          f.isNullable ? 1 : 0,
          f.picklistId || null,
          f.dateFormat ?? null,
          f.maxLength ?? null,
          i,
          f.notes ?? null,
          existingId
        )
      } else {
        ins.run(
          crypto.randomUUID(),
          objectId,
          f.name,
          f.description ?? null,
          f.dataType,
          f.isRequired ? 1 : 0,
          f.isNullable ? 1 : 0,
          f.picklistId || null,
          f.dateFormat ?? null,
          f.maxLength ?? null,
          i,
          f.notes ?? null
        )
      }
    })
  })
  upsertAll()

  return (
    db.prepare('SELECT * FROM object_fields WHERE object_id = ? ORDER BY position ASC').all(objectId) as FieldRow[]
  ).map(rowToField)
}
