/**
 * Project registry service — tracks ownership and sharing of .flux files.
 *
 * Data lives in users.db (not the per-project .flux file) so it survives
 * across project open/close cycles and is accessible without opening the file.
 *
 * Role model:
 *  - owner   (stored in project_registry.owner_id): full access
 *  - editor  (project_access.role): open, edit, download; no share/delete
 *  - viewer  (project_access.role): download only; no live session
 */
import path from 'path'
import fs from 'fs'
import { getUsersDb } from '../db-users.js'

export type ProjectRole = 'owner' | 'editor' | 'viewer'

export interface ProjectEntry {
  projectUuid: string
  filePath: string
  fileName: string
  role: ProjectRole
  ownerUsername: string
  ownerId: string
}

export interface ProjectMember {
  userId: string
  username: string
  role: ProjectRole
}

interface RegistryRow {
  project_uuid: string
  file_path: string
  owner_id: string
  registered_at: string
}

interface AccessRow {
  project_uuid: string
  user_id: string
  role: string
  granted_by: string
  granted_at: string
}

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Register a project in the registry (called on create or first open).
 * Safe to call multiple times — uses INSERT OR IGNORE.
 */
export function registerProject(projectUuid: string, filePath: string, ownerId: string): void {
  const db = getUsersDb()
  db.prepare(
    'INSERT OR IGNORE INTO project_registry (project_uuid, file_path, owner_id, registered_at) VALUES (?, ?, ?, ?)'
  ).run(projectUuid, filePath, ownerId, new Date().toISOString())
}

/**
 * Update the stored file path for a project (e.g. after a rename).
 */
export function updateProjectPath(projectUuid: string, newFilePath: string): void {
  getUsersDb()
    .prepare('UPDATE project_registry SET file_path = ? WHERE project_uuid = ?')
    .run(newFilePath, projectUuid)
}

// ── Access checks ─────────────────────────────────────────────────────────────

/**
 * Return the effective role for userId on projectUuid, or null if no access.
 * Owner always has the 'owner' role regardless of project_access rows.
 */
export function getProjectAccess(projectUuid: string, userId: string): ProjectRole | null {
  const db = getUsersDb()

  const reg = db.prepare('SELECT owner_id FROM project_registry WHERE project_uuid = ?')
    .get(projectUuid) as RegistryRow | undefined

  if (!reg) return null
  if (reg.owner_id === userId) return 'owner'

  const access = db.prepare(
    'SELECT role FROM project_access WHERE project_uuid = ? AND user_id = ?'
  ).get(projectUuid, userId) as AccessRow | undefined

  return access ? (access.role as ProjectRole) : null
}

/** True if userId is the registered owner of projectUuid. */
export function isOwner(projectUuid: string, userId: string): boolean {
  const row = getUsersDb()
    .prepare('SELECT owner_id FROM project_registry WHERE project_uuid = ?')
    .get(projectUuid) as RegistryRow | undefined
  return row?.owner_id === userId
}

// ── Project listing ───────────────────────────────────────────────────────────

/**
 * Return all projects accessible by userId (owned + shared).
 * Files that no longer exist on disk are silently excluded.
 */
export function listAccessibleProjects(userId: string): ProjectEntry[] {
  const db = getUsersDb()

  // Owned projects
  const owned = db.prepare(`
    SELECT pr.project_uuid, pr.file_path, u.username as owner_username, u.id as owner_id, 'owner' as role
    FROM project_registry pr
    JOIN users u ON u.id = pr.owner_id
    WHERE pr.owner_id = ?
  `).all(userId) as Array<{ project_uuid: string; file_path: string; owner_username: string; owner_id: string; role: string }>

  // Shared projects
  const shared = db.prepare(`
    SELECT pr.project_uuid, pr.file_path, u.username as owner_username, u.id as owner_id, pa.role
    FROM project_access pa
    JOIN project_registry pr ON pr.project_uuid = pa.project_uuid
    JOIN users u ON u.id = pr.owner_id
    WHERE pa.user_id = ?
  `).all(userId) as Array<{ project_uuid: string; file_path: string; owner_username: string; owner_id: string; role: string }>

  return [...owned, ...shared]
    .filter(r => {
      try { return fs.existsSync(r.file_path) } catch { return false }
    })
    .map(r => ({
      projectUuid: r.project_uuid,
      filePath: r.file_path,
      fileName: path.basename(r.file_path),
      role: r.role as ProjectRole,
      ownerUsername: r.owner_username,
      ownerId: r.owner_id,
    }))
}

/**
 * Return all projects in the registry (admin use — all users, all projects).
 */
export function listAllProjects(): Array<ProjectEntry & { registeredAt: string }> {
  const db = getUsersDb()
  const rows = db.prepare(`
    SELECT pr.project_uuid, pr.file_path, pr.registered_at,
           u.username as owner_username, u.id as owner_id
    FROM project_registry pr
    JOIN users u ON u.id = pr.owner_id
    ORDER BY pr.registered_at DESC
  `).all() as Array<{ project_uuid: string; file_path: string; registered_at: string; owner_username: string; owner_id: string }>

  return rows.map(r => ({
    projectUuid: r.project_uuid,
    filePath: r.file_path,
    fileName: path.basename(r.file_path),
    role: 'owner' as ProjectRole,   // admin context — treat as owner
    ownerUsername: r.owner_username,
    ownerId: r.owner_id,
    registeredAt: r.registered_at,
  }))
}

/** Resolve project_uuid from a file path (for legacy open-by-path flow). */
export function getProjectUuidByPath(filePath: string): string | null {
  const row = getUsersDb()
    .prepare('SELECT project_uuid FROM project_registry WHERE file_path = ?')
    .get(filePath) as RegistryRow | undefined
  return row?.project_uuid ?? null
}

// ── Sharing ───────────────────────────────────────────────────────────────────

/**
 * Grant userId access to a project with the given role.
 * Replaces any existing access row for that user.
 */
export function shareProject(
  projectUuid: string,
  targetUserId: string,
  role: 'editor' | 'viewer',
  grantedBy: string
): void {
  const db = getUsersDb()
  db.prepare(`
    INSERT INTO project_access (project_uuid, user_id, role, granted_by, granted_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_uuid, user_id) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by, granted_at = excluded.granted_at
  `).run(projectUuid, targetUserId, role, grantedBy, new Date().toISOString())
}

/**
 * Revoke a user's access to a project. No-op if not found.
 */
export function revokeAccess(projectUuid: string, userId: string): void {
  getUsersDb()
    .prepare('DELETE FROM project_access WHERE project_uuid = ? AND user_id = ?')
    .run(projectUuid, userId)
}

/**
 * List all members of a project (owner + editors + viewers).
 */
export function listProjectMembers(projectUuid: string): ProjectMember[] {
  const db = getUsersDb()

  const reg = db.prepare(`
    SELECT u.id, u.username
    FROM project_registry pr JOIN users u ON u.id = pr.owner_id
    WHERE pr.project_uuid = ?
  `).get(projectUuid) as { id: string; username: string } | undefined

  if (!reg) return []

  const shared = db.prepare(`
    SELECT u.id, u.username, pa.role
    FROM project_access pa JOIN users u ON u.id = pa.user_id
    WHERE pa.project_uuid = ?
    ORDER BY pa.granted_at ASC
  `).all(projectUuid) as Array<{ id: string; username: string; role: string }>

  return [
    { userId: reg.id, username: reg.username, role: 'owner' },
    ...shared.map(r => ({ userId: r.id, username: r.username, role: r.role as ProjectRole })),
  ]
}

/**
 * Remove a project from the registry entirely (called on project deletion).
 * Cascades to project_access rows.
 */
export function unregisterProject(projectUuid: string): void {
  getUsersDb()
    .prepare('DELETE FROM project_registry WHERE project_uuid = ?')
    .run(projectUuid)
}
