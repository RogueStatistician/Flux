/**
 * Project service — pure DB operations for project management.
 * No Electron or transport-specific code here.
 */
import path from 'path'
import fs from 'fs'
import { openDatabase, closeDatabase, getDb, isDatabaseOpen } from '../db.js'

interface ProjectRow {
  id: string
  name: string
  description: string | null
  client: string | null
  created_at: string
  updated_at: string
}

export interface RecentEntry {
  filePath: string
  name: string
  openedAt: string
}

function rowToMeta(row: ProjectRow, filePath: string) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    client: row.client ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    filePath,
  }
}

export function createProjectRecord(name: string, description?: string, client?: string) {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO projects (id, name, description, client, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, name, description ?? null, client ?? null, now, now)
  return { id, name, description: description ?? null, client: client ?? null, created_at: now, updated_at: now }
}

export function updateProjectRecord(filePath: string, fields: Partial<{ name: string; description: string; client: string }>) {
  const db = getDb()
  const now = new Date().toISOString()
  const row = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string } | undefined
  if (!row) throw new Error('No project record found.')
  if (fields.name !== undefined)
    db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(fields.name, now, row.id)
  if (fields.description !== undefined)
    db.prepare('UPDATE projects SET description = ?, updated_at = ? WHERE id = ?').run(fields.description, now, row.id)
  if (fields.client !== undefined)
    db.prepare('UPDATE projects SET client = ?, updated_at = ? WHERE id = ?').run(fields.client, now, row.id)
  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(row.id) as ProjectRow
  return rowToMeta(updated, filePath)
}

export function getProjectMetaRecord(filePath: string) {
  if (!isDatabaseOpen()) return null
  const db = getDb()
  const row = db.prepare('SELECT * FROM projects LIMIT 1').get() as ProjectRow | undefined
  return row ? rowToMeta(row, filePath) : null
}

export function loadRecents(recentsFilePath: string): RecentEntry[] {
  try {
    return JSON.parse(fs.readFileSync(recentsFilePath, 'utf-8')) as RecentEntry[]
  } catch {
    return []
  }
}

export function addToRecents(recentsFilePath: string, filePath: string, name: string): void {
  let recents = loadRecents(recentsFilePath).filter(r => r.filePath !== filePath)
  recents.unshift({ filePath, name, openedAt: new Date().toISOString() })
  recents = recents.slice(0, 10)
  try { fs.mkdirSync(path.dirname(recentsFilePath), { recursive: true }) } catch { /* ignore */ }
  fs.writeFileSync(recentsFilePath, JSON.stringify(recents, null, 2), 'utf-8')
}

export function removeFromRecents(recentsFilePath: string, filePath: string): void {
  try {
    const recents = loadRecents(recentsFilePath).filter(r => r.filePath !== filePath)
    fs.writeFileSync(recentsFilePath, JSON.stringify(recents, null, 2), 'utf-8')
  } catch { /* ignore if file missing */ }
}

export function deleteProjectFile(recentsFilePath: string, filePath: string): void {
  closeDatabase()
  removeFromRecents(recentsFilePath, filePath)
  fs.unlinkSync(filePath)
}

// ── Electron-only helpers (use the global _db singleton) ─────────────────────

/** Open a project in Electron mode. Uses the legacy global DB singleton. */
export function openProjectRecord(filePath: string) {
  openDatabase(filePath)   // Electron legacy: single arg = global singleton
  const db = getDb()
  const row = db.prepare('SELECT * FROM projects LIMIT 1').get() as ProjectRow | undefined
  if (!row) throw new Error('Invalid .flux file: no project record found.')
  return rowToMeta(row, filePath)
}

export function closeProjectRecord() {
  closeDatabase()
}
