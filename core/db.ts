/**
 * Database layer — opens/closes SQLite .flux project files and runs migrations.
 *
 * Two operational modes (both can coexist):
 *
 * 1. **Electron / legacy** — single global `_db` singleton, accessed via
 *    `openDatabase(filePath)` / `closeDatabase()` / `getDb()`.
 *
 * 2. **Web / multi-user** — per-user connection map, accessed via
 *    `openDatabase(userId, filePath)` / `closeDatabase(userId)`.
 *    Service functions automatically use the right connection via
 *    `withUser(userId, fn)` + `AsyncLocalStorage` — no signature changes
 *    to any service function needed.
 */
import Database from 'better-sqlite3'
import { AsyncLocalStorage } from 'node:async_hooks'

// ── Connection storage ────────────────────────────────────────────────────────

/** Electron singleton (legacy path — no userId). */
let _db: Database.Database | null = null

/** Web per-user connections, keyed by userId. */
const _connections = new Map<string, Database.Database>()

/** AsyncLocalStorage tracks which userId is active for the current request. */
const _currentUserId = new AsyncLocalStorage<string>()

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Open (or replace) a .flux file for a specific user (web mode).
 * Call with a single argument for Electron legacy mode.
 */
export function openDatabase(userIdOrPath: string, filePath?: string): void {
  if (filePath !== undefined) {
    // Web mode: openDatabase(userId, filePath)
    const existing = _connections.get(userIdOrPath)
    if (existing) { try { existing.close() } catch { /* ignore */ } }
    const db = new Database(filePath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    applyMigrations(db)
    _connections.set(userIdOrPath, db)
  } else {
    // Electron legacy mode: openDatabase(filePath)
    if (_db) { try { _db.close() } catch { /* ignore */ } }
    _db = new Database(userIdOrPath)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
    applyMigrations(_db)
  }
}

/**
 * Close the database for a specific user (web mode), or the global singleton
 * when called with no arguments (Electron legacy mode).
 */
export function closeDatabase(userId?: string): void {
  if (userId !== undefined) {
    const db = _connections.get(userId)
    if (db) { try { db.close() } catch { /* ignore */ } }
    _connections.delete(userId)
  } else {
    if (_db) { try { _db.close() } catch { /* ignore */ } }
    _db = null
  }
}

/**
 * Return the active database.
 * - Inside a `withUser()` call: returns the per-user connection.
 * - Outside (Electron IPC path): returns the global singleton.
 */
export function getDb(): Database.Database {
  const userId = _currentUserId.getStore()
  if (userId !== undefined) {
    const db = _connections.get(userId)
    if (!db) throw new Error(`No project is open for user ${userId}.`)
    return db
  }
  if (!_db) throw new Error('No project is open.')
  return _db
}

/**
 * True when a project is open for the given user (web), or globally (Electron).
 */
export function isDatabaseOpen(userId?: string): boolean {
  if (userId !== undefined) return _connections.has(userId)
  const uid = _currentUserId.getStore()
  if (uid !== undefined) return _connections.has(uid)
  return _db !== null
}

/**
 * Run `fn` in a context where `getDb()` automatically returns this user's
 * connection. Used by Express route handlers to scope all service-function
 * calls to the right SQLite connection without changing service signatures.
 *
 * @example
 * router.get('/objects', (req, res) => {
 *   withUser(req.user!.sub, () => {
 *     res.json(listObjects())
 *   })
 * })
 */
export function withUser<T>(userId: string, fn: () => T): T {
  return _currentUserId.run(userId, fn)
}

/**
 * Returns the file path for a user's currently open project, or null.
 * Opens a read-only connection to query the filename if needed.
 */
export function getCurrentFilePath(userId: string): string | null {
  const db = _connections.get(userId)
  if (!db) return null
  // better-sqlite3 exposes the filename on the Database object
  return (db as unknown as { name: string }).name ?? null
}

/**
 * Return the ID of the single project in the currently open database.
 * Throws if no project is open or the database contains no project record.
 * Used by every service function that needs to scope queries to the active project.
 */
export function getCurrentProjectId(): string {
  const row = getDb().prepare('SELECT id FROM projects LIMIT 1').get() as { id: string } | undefined
  if (!row) throw new Error('No project is open.')
  return row.id
}

/** Return all currently open user sessions (userId → filePath). */
export function getAllOpenSessions(): Map<string, string> {
  const result = new Map<string, string>()
  for (const [userId, db] of _connections) {
    result.set(userId, (db as unknown as { name: string }).name ?? '')
  }
  return result
}

// ── Schema DDL ────────────────────────────────────────────────────────────────

/** Full schema applied on database version 0 → 1. */
const MIGRATION_V1 = `
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  client      TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE picklists (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  side        TEXT NOT NULL CHECK(side IN ('source','target')),
  created_at  TEXT NOT NULL
);

CREATE TABLE picklist_values (
  id          TEXT PRIMARY KEY,
  picklist_id TEXT NOT NULL REFERENCES picklists(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  label       TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(picklist_id, key)
);

CREATE TABLE data_objects (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK(role IN ('source','target')),
  name          TEXT NOT NULL,
  description   TEXT,
  system_name   TEXT,
  file_name     TEXT,
  row_count     INTEGER,
  output_format TEXT NOT NULL DEFAULT 'xlsx',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE object_fields (
  id           TEXT PRIMARY KEY,
  object_id    TEXT NOT NULL REFERENCES data_objects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  display_name TEXT,
  data_type    TEXT NOT NULL CHECK(data_type IN ('string','integer','float','date','datetime','picklist')),
  is_required  INTEGER NOT NULL DEFAULT 0,
  is_nullable  INTEGER NOT NULL DEFAULT 1,
  picklist_id  TEXT REFERENCES picklists(id),
  date_format  TEXT,
  max_length   INTEGER,
  position     INTEGER NOT NULL,
  notes        TEXT
);

CREATE TABLE source_rows (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id TEXT NOT NULL REFERENCES data_objects(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  data      TEXT NOT NULL
);
CREATE INDEX idx_source_rows_object ON source_rows(object_id);

CREATE TABLE picklist_mappings (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  source_picklist_id TEXT REFERENCES picklists(id),
  target_picklist_id TEXT REFERENCES picklists(id),
  created_at         TEXT NOT NULL
);

CREATE TABLE picklist_mapping_entries (
  id         TEXT PRIMARY KEY,
  mapping_id TEXT NOT NULL REFERENCES picklist_mappings(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  target_key TEXT NOT NULL
);

CREATE TABLE transformations (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  canvas_state TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE field_mappings (
  id                TEXT PRIMARY KEY,
  transformation_id TEXT NOT NULL REFERENCES transformations(id) ON DELETE CASCADE,
  target_object_id  TEXT NOT NULL REFERENCES data_objects(id),
  target_field_id   TEXT NOT NULL REFERENCES object_fields(id),
  rule_type         TEXT NOT NULL,
  rule_config       TEXT NOT NULL,
  notes             TEXT
);

CREATE TABLE runs (
  id                TEXT PRIMARY KEY,
  transformation_id TEXT NOT NULL REFERENCES transformations(id),
  started_at        TEXT NOT NULL,
  completed_at      TEXT,
  status            TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  stats             TEXT,
  output_manifest   TEXT
);

CREATE TABLE run_issues (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  row_index  INTEGER,
  field_name TEXT,
  severity   TEXT NOT NULL CHECK(severity IN ('warning','error')),
  message    TEXT NOT NULL
);
`

/** Migration v1 → v2: adds description column to object_fields. */
const MIGRATION_V2 = `
ALTER TABLE object_fields ADD COLUMN description TEXT;
`

/**
 * Migration v2 → v3: adds Workday-style template layout fields to data_objects.
 */
const MIGRATION_V3 = `
ALTER TABLE data_objects ADD COLUMN template_header_row    INTEGER DEFAULT 0;
ALTER TABLE data_objects ADD COLUMN template_skip_columns  INTEGER DEFAULT 0;
ALTER TABLE data_objects ADD COLUMN template_file_path     TEXT;
`

/**
 * Migration v3 → v4: decouples "where column names live" from "where data starts".
 */
const MIGRATION_V4 = `
ALTER TABLE data_objects ADD COLUMN template_data_start_row INTEGER DEFAULT NULL;
`

/**
 * Migration v4 → v5: supports multiple MapNodes per target object.
 */
const MIGRATION_V5 = `
ALTER TABLE field_mappings ADD COLUMN map_node_id TEXT;
CREATE INDEX idx_field_mappings_node ON field_mappings(map_node_id);
`

/**
 * Migration v5 → v6: store source file path + import options so the run engine
 * reads directly from the original file instead of re-hydrating all rows from
 * the DB. Only a preview sample (up to PREVIEW_ROWS rows) is kept in source_rows.
 * Existing projects keep their source_rows untouched — the engine falls back to
 * the DB when source_file_path is NULL.
 */
const MIGRATION_V6 = `
ALTER TABLE data_objects ADD COLUMN source_file_path      TEXT;
ALTER TABLE data_objects ADD COLUMN source_separator      TEXT;
ALTER TABLE data_objects ADD COLUMN source_skip_rows      INTEGER DEFAULT 0;
ALTER TABLE data_objects ADD COLUMN source_skip_columns   INTEGER DEFAULT 0;
ALTER TABLE data_objects ADD COLUMN source_data_start_row INTEGER DEFAULT NULL;
`


// ── Migrations ────────────────────────────────────────────────────────────────

function applyMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  const row = db
    .prepare('SELECT value FROM _meta WHERE key = ?')
    .get('schema_version') as { value: string } | undefined

  const currentVersion = row ? parseInt(row.value, 10) : 0

  if (currentVersion < 1) {
    db.exec(MIGRATION_V1)
    db.prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)').run('schema_version', '1')
  }
  if (currentVersion < 2) {
    db.exec(MIGRATION_V2)
    db.prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)').run('schema_version', '2')
  }
  if (currentVersion < 3) {
    db.exec(MIGRATION_V3)
    db.prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)').run('schema_version', '3')
  }
  if (currentVersion < 4) {
    db.exec(MIGRATION_V4)
    db.prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)').run('schema_version', '4')
  }
  if (currentVersion < 5) {
    db.exec(MIGRATION_V5)
    db.prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)').run('schema_version', '5')
  }
  if (currentVersion < 6) {
    db.exec(MIGRATION_V6)
    db.prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)').run('schema_version', '6')
  }
}
