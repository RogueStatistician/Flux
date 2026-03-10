/**
 * Database layer — opens/closes a SQLite .flux project file and runs migrations.
 *
 * All access to better-sqlite3 stays in the main process (Node.js). The
 * renderer communicates via typed IPC handlers in electron/ipc/.
 */
import Database from 'better-sqlite3'

let _db: Database.Database | null = null

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
 *
 * template_header_row  — 0-based index of the row that contains column names.
 * template_skip_columns — number of leading columns to ignore when reading/writing data.
 * template_file_path   — absolute path to the original uploaded template file, used by
 *                        the engine to preserve the template structure on output.
 */
const MIGRATION_V3 = `
ALTER TABLE data_objects ADD COLUMN template_header_row    INTEGER DEFAULT 0;
ALTER TABLE data_objects ADD COLUMN template_skip_columns  INTEGER DEFAULT 0;
ALTER TABLE data_objects ADD COLUMN template_file_path     TEXT;
`

/**
 * Migration v3 → v4: decouples "where column names live" from "where data starts".
 *
 * template_data_start_row — 0-based index of the first row that should contain
 *                           transformed data in the output file.  When NULL the
 *                           engine falls back to template_header_row + 1, which
 *                           preserves the behaviour of databases created before
 *                           this migration.
 */
const MIGRATION_V4 = `
ALTER TABLE data_objects ADD COLUMN template_data_start_row INTEGER DEFAULT NULL;
`

/**
 * Migration v4 → v5: supports multiple MapNodes per target object.
 *
 * map_node_id — canvas node ID of the map-operator node that owns this rule.
 *               NULL for legacy single-MapNode transformations (backward-compatible).
 *               When set, rules are scoped to a specific MapNode so two
 *               independent mapping paths can target the same output object
 *               with different source fields.
 */
const MIGRATION_V5 = `
ALTER TABLE field_mappings ADD COLUMN map_node_id TEXT;
CREATE INDEX idx_field_mappings_node ON field_mappings(map_node_id);
`

/**
 * Open (or create) a .flux SQLite file and run any pending migrations.
 * Throws if the file path is invalid or the DB is not a valid Flux project.
 */
export function openDatabase(filePath: string): void {
  if (_db) {
    _db.close()
    _db = null
  }
  _db = new Database(filePath)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  applyMigrations(_db)
}

/** Close the current database. Safe to call when no DB is open. */
export function closeDatabase(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

/** Return the open database. Throws if no project is open. */
export function getDb(): Database.Database {
  if (!_db) throw new Error('No project is open.')
  return _db
}

/** True when a project file is currently open. */
export function isDatabaseOpen(): boolean {
  return _db !== null
}

// ── Migrations ────────────────────────────────────────────────────────────────

function applyMigrations(db: Database.Database): void {
  // Ensure the _meta table exists
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
    db.prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      '1'
    )
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
}
