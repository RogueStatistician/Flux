/**
 * Users database — opens/initialises a separate SQLite file for auth.
 * Unlike the project DB (core/db.ts), this DB has no open/close lifecycle:
 * it is initialised once at server startup and stays open for the process lifetime.
 */
import Database from 'better-sqlite3'
import os from 'os'
import path from 'path'

let _db: Database.Database | null = null

// ── Schema ────────────────────────────────────────────────────────────────────

const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user'
                CHECK(role IN ('admin', 'user')),
  created_at    TEXT NOT NULL,
  last_login    TEXT
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  jti        TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
`

const MIGRATION_V2 = `
CREATE TABLE IF NOT EXISTS invite_tokens (
  token       TEXT PRIMARY KEY,
  created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'user'
              CHECK(role IN ('admin', 'user')),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
`

function applyMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)

  const row = db.prepare('SELECT value FROM _meta WHERE key = ?').get('schema_version') as { value: string } | undefined
  const currentVersion = row ? parseInt(row.value, 10) : 0

  if (currentVersion < 1) {
    db.exec(MIGRATION_V1)
    db.prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)').run('schema_version', '1')
  }

  if (currentVersion < 2) {
    db.exec(MIGRATION_V2)
    db.prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)').run('schema_version', '2')
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise the users database. Must be called once at server startup
 * before any auth operations. Safe to call multiple times (idempotent).
 */
export function initUsersDb(filePath?: string): void {
  if (_db) return  // already initialised

  const resolvedPath = filePath
    ?? process.env.USERS_DB_PATH
    ?? path.join(process.env.FLUX_DATA_DIR ?? path.join(os.homedir(), '.flux'), 'users.db')

  _db = new Database(resolvedPath)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  applyMigrations(_db)
}

/** Return the open users DB. Throws if initUsersDb() was not called. */
export function getUsersDb(): Database.Database {
  if (!_db) throw new Error('Users DB is not initialised. Call initUsersDb() at startup.')
  return _db
}

/** Purge expired refresh tokens and invite tokens. Call on server startup. */
export function purgeExpiredRefreshTokens(): void {
  const db = getUsersDb()
  db.prepare("DELETE FROM refresh_tokens WHERE expires_at < datetime('now')").run()
  db.prepare("DELETE FROM invite_tokens WHERE expires_at < datetime('now')").run()
}
