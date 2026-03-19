/**
 * Users service — CRUD for users and refresh_token allowlist.
 * All password operations use bcryptjs async API (never blocks the event loop).
 */
import bcrypt from 'bcryptjs'
import { getUsersDb } from '../db-users.js'

const BCRYPT_COST = 12

// A pre-computed dummy hash used for constant-time comparison when a user
// is not found (prevents timing-based user enumeration).
const DUMMY_HASH = '$2a$12$irrelevant.hash.used.only.to.prevent.timing.attacks.....xx'

// ── Row types ─────────────────────────────────────────────────────────────────

interface UserRow {
  id: string
  username: string
  password_hash: string
  role: string
  created_at: string
  last_login: string | null
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface UserRecord {
  id: string
  username: string
  role: 'admin' | 'user'
  createdAt: string
  lastLogin: string | null
}

function rowToRecord(r: UserRow): UserRecord {
  return {
    id: r.id,
    username: r.username,
    role: r.role as 'admin' | 'user',
    createdAt: r.created_at,
    lastLogin: r.last_login,
  }
}

// ── Users ─────────────────────────────────────────────────────────────────────

/** Return the total number of users (used to determine first-user admin promotion). */
export function getUserCount(): number {
  const db = getUsersDb()
  return (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c
}

/** Create a new user with a bcrypt-hashed password. Returns the new record. */
export async function createUser(
  username: string,
  password: string,
  role: 'admin' | 'user'
): Promise<UserRecord> {
  const db = getUsersDb()
  const hash = await bcrypt.hash(password, BCRYPT_COST)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  db.prepare(
    'INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, username.toLowerCase().trim(), hash, role, now)

  return rowToRecord(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow)
}

/**
 * Verify credentials. Returns the UserRecord on success, null on failure.
 * Always runs bcrypt.compare() to prevent timing-based user enumeration.
 */
export async function verifyPassword(username: string, password: string): Promise<UserRecord | null> {
  const db = getUsersDb()
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(
    username.toLowerCase().trim()
  ) as UserRow | undefined

  const hashToCompare = row?.password_hash ?? DUMMY_HASH
  const match = await bcrypt.compare(password, hashToCompare)

  if (!match || !row) return null

  // Update last_login (best effort, non-transactional)
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(new Date().toISOString(), row.id)

  return rowToRecord(row)
}

/** Get a user by ID. Returns null if not found. */
export function getUserById(id: string): UserRecord | null {
  const db = getUsersDb()
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  return row ? rowToRecord(row) : null
}

/** List all users (admin use — never includes password_hash). */
export function listUsers(): UserRecord[] {
  const db = getUsersDb()
  return (db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as UserRow[]).map(rowToRecord)
}

/** Delete a user and all their refresh tokens (CASCADE handles the tokens). */
export function deleteUser(id: string): void {
  getUsersDb().prepare('DELETE FROM users WHERE id = ?').run(id)
}

// ── Refresh tokens ────────────────────────────────────────────────────────────

/**
 * Store a new refresh token jti in the allowlist.
 * expiresAt should be an ISO date string matching the JWT exp.
 */
export function createRefreshToken(jti: string, userId: string, expiresAt: string): void {
  getUsersDb()
    .prepare('INSERT INTO refresh_tokens (jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(jti, userId, expiresAt, new Date().toISOString())
}

/**
 * Rotate a refresh token: atomically delete the old jti and insert the new one.
 * Returns false if the old jti was not found (token already consumed → reuse detected).
 */
export function rotateRefreshToken(
  oldJti: string,
  newJti: string,
  userId: string,
  newExpiresAt: string
): boolean {
  const db = getUsersDb()

  let succeeded = false
  const tx = db.transaction(() => {
    const deleted = db.prepare('DELETE FROM refresh_tokens WHERE jti = ?').run(oldJti)
    if (deleted.changes === 0) return  // jti not found — already rotated
    db.prepare('INSERT INTO refresh_tokens (jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(newJti, userId, newExpiresAt, new Date().toISOString())
    succeeded = true
  })
  tx()

  return succeeded
}

/** Delete a single refresh token (on logout). No-op if not found. */
export function deleteRefreshToken(jti: string): void {
  getUsersDb().prepare('DELETE FROM refresh_tokens WHERE jti = ?').run(jti)
}

/** Wipe all refresh tokens for a user (on reuse detection → full session invalidation). */
export function wipeUserRefreshTokens(userId: string): void {
  getUsersDb().prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId)
}

/** Look up a refresh token row. Returns the userId if valid and not expired, null otherwise. */
export function lookupRefreshToken(jti: string): string | null {
  const db = getUsersDb()
  const row = db.prepare(
    "SELECT user_id FROM refresh_tokens WHERE jti = ? AND expires_at > datetime('now')"
  ).get(jti) as { user_id: string } | undefined
  return row?.user_id ?? null
}

// ── Role management ───────────────────────────────────────────────────────────

/** Count how many users have the admin role. */
export function countAdmins(): number {
  return (getUsersDb().prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as { c: number }).c
}

/**
 * Update a user's role. Rejects if the change would leave zero admins.
 * Returns the updated UserRecord, or null if the user was not found.
 */
export function updateUserRole(id: string, role: 'admin' | 'user'): UserRecord | null {
  const db = getUsersDb()

  if (role === 'user') {
    // Ensure at least one admin remains
    const admins = countAdmins()
    const target = db.prepare("SELECT role FROM users WHERE id = ?").get(id) as { role: string } | undefined
    if (!target) return null
    if (target.role === 'admin' && admins <= 1) {
      throw new Error('LAST_ADMIN')
    }
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id)
  return getUserById(id)
}

// ── Password management ───────────────────────────────────────────────────────

/** Update a user's password (async bcrypt). No current-password check — caller must verify. */
export async function updateUserPassword(id: string, newPassword: string): Promise<void> {
  const hash = await bcrypt.hash(newPassword, BCRYPT_COST)
  getUsersDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id)
}

// ── Invite tokens ─────────────────────────────────────────────────────────────

export interface InviteToken {
  token: string
  createdBy: string
  role: 'admin' | 'user'
  createdAt: string
  expiresAt: string
}

interface InviteRow {
  token: string
  created_by: string
  role: string
  created_at: string
  expires_at: string
}

function rowToInvite(r: InviteRow): InviteToken {
  return {
    token: r.token,
    createdBy: r.created_by,
    role: r.role as 'admin' | 'user',
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }
}

/** Create a new invite token valid for 7 days. Returns the token string. */
export function createInviteToken(createdBy: string, role: 'admin' | 'user' = 'user'): InviteToken {
  const db = getUsersDb()
  const token = crypto.randomUUID()
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  db.prepare(
    'INSERT INTO invite_tokens (token, created_by, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(token, createdBy, role, now, expiresAt)
  return rowToInvite(db.prepare('SELECT * FROM invite_tokens WHERE token = ?').get(token) as InviteRow)
}

/** List all non-expired invite tokens (for admin display). */
export function listInviteTokens(): InviteToken[] {
  return (
    getUsersDb()
      .prepare("SELECT * FROM invite_tokens WHERE expires_at > datetime('now') ORDER BY created_at DESC")
      .all() as InviteRow[]
  ).map(rowToInvite)
}

/**
 * Validate an invite token. Returns the token record if valid, null if expired/not found.
 * Does NOT consume the token.
 */
export function validateInviteToken(token: string): InviteToken | null {
  const row = getUsersDb().prepare(
    "SELECT * FROM invite_tokens WHERE token = ? AND expires_at > datetime('now')"
  ).get(token) as InviteRow | undefined
  return row ? rowToInvite(row) : null
}

/**
 * Consume an invite token (single use). Returns the token record if valid, null if not.
 * Deletes the token atomically.
 */
export function consumeInviteToken(token: string): InviteToken | null {
  const db = getUsersDb()
  let result: InviteToken | null = null
  const tx = db.transaction(() => {
    const row = db.prepare(
      "SELECT * FROM invite_tokens WHERE token = ? AND expires_at > datetime('now')"
    ).get(token) as InviteRow | undefined
    if (!row) return
    db.prepare('DELETE FROM invite_tokens WHERE token = ?').run(token)
    result = rowToInvite(row)
  })
  tx()
  return result
}

/** Delete (revoke) an invite token. No-op if not found. */
export function deleteInviteToken(token: string): void {
  getUsersDb().prepare('DELETE FROM invite_tokens WHERE token = ?').run(token)
}

/** Remove all expired invite tokens. Call periodically. */
export function purgeExpiredInviteTokens(): void {
  getUsersDb().prepare("DELETE FROM invite_tokens WHERE expires_at < datetime('now')").run()
}
