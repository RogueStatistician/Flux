import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openDatabase, closeDatabase, getDb, isDatabaseOpen } from '../../core/db.js'
import { openMemoryDb, openTempDb } from '../helpers/db.js'
import fs from 'fs'

describe('DB lifecycle', () => {
  afterEach(() => { try { closeDatabase() } catch { /* already closed */ } })

  it('isDatabaseOpen returns false before opening', () => {
    expect(isDatabaseOpen()).toBe(false)
  })

  it('opens an in-memory DB successfully', () => {
    openDatabase(':memory:')
    expect(isDatabaseOpen()).toBe(true)
  })

  it('getDb throws when no DB is open', () => {
    expect(() => getDb()).toThrow()
  })

  it('getDb returns the DB instance when open', () => {
    openDatabase(':memory:')
    expect(() => getDb()).not.toThrow()
  })

  it('isDatabaseOpen returns false after closing', () => {
    openDatabase(':memory:')
    closeDatabase()
    expect(isDatabaseOpen()).toBe(false)
  })

  it('creates the DB file when opening a file path', () => {
    const { filePath, cleanup } = openTempDb()
    try {
      expect(fs.existsSync(filePath)).toBe(true)
    } finally {
      cleanup()
    }
  })
})

describe('DB schema', () => {
  let closeDb: () => void

  beforeEach(() => { closeDb = openMemoryDb() })
  afterEach(() => closeDb())

  it('creates the projects table', () => {
    const db = getDb()
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[]
    const names = tables.map(t => t.name)
    expect(names).toContain('projects')
  })

  it('creates all expected tables', () => {
    const db = getDb()
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[]
    const names = tables.map(t => t.name)

    for (const expected of [
      'data_objects', 'field_mappings', 'object_fields',
      'picklist_mapping_entries', 'picklist_mappings', 'picklist_values',
      'picklists', 'projects', 'run_issues', 'runs',
      'source_rows', 'transformations',
    ]) {
      expect(names, `Missing table: ${expected}`).toContain(expected)
    }
  })

  it('stores the current schema version in _meta', () => {
    const db = getDb()
    const meta = db.prepare('SELECT value FROM _meta WHERE key = ?').get('schema_version') as { value: string } | undefined
    expect(meta?.value).toBeDefined()
    expect(Number(meta!.value)).toBeGreaterThanOrEqual(1)
  })

  it('object_fields has description column (migration v2)', () => {
    const db = getDb()
    const cols = db.prepare('PRAGMA table_info(object_fields)').all() as { name: string }[]
    expect(cols.map(c => c.name)).toContain('description')
  })

  it('object_fields has template columns (migration v3/v4)', () => {
    const db = getDb()
    const cols = db.prepare('PRAGMA table_info(data_objects)').all() as { name: string }[]
    const colNames = cols.map(c => c.name)
    expect(colNames).toContain('template_header_row')
    expect(colNames).toContain('template_data_start_row')
    expect(colNames).toContain('template_skip_columns')
    expect(colNames).toContain('template_file_path')
  })

  it('field_mappings has map_node_id column (migration v5)', () => {
    const db = getDb()
    const cols = db.prepare('PRAGMA table_info(field_mappings)').all() as { name: string }[]
    expect(cols.map(c => c.name)).toContain('map_node_id')
  })

  it('foreign keys are enforced', () => {
    const db = getDb()
    const result = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }
    expect(result.foreign_keys).toBe(1)
  })

  it('WAL journal mode is enabled for file-based DBs', () => {
    // :memory: DBs use 'memory' mode — test WAL with a real temp file
    const { filePath, cleanup } = openTempDb()
    try {
      const db = getDb()
      const result = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
      expect(result.journal_mode).toBe('wal')
    } finally {
      cleanup()
      // Re-open the in-memory DB so afterEach doesn't fail
      openMemoryDb()
    }
  })
})
