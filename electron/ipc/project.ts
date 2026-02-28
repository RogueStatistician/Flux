/**
 * Project IPC handlers — create, open, close, and update .flux project files.
 * Recent projects list is persisted as a small JSON file in userData.
 */
import { ipcMain, app, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import { openDatabase, closeDatabase, getDb, isDatabaseOpen } from '../db.js'

// ── Types (mirrored in src/types/index.ts) ────────────────────────────────────

interface ProjectRow {
  id: string
  name: string
  description: string | null
  client: string | null
  created_at: string
  updated_at: string
}

interface RecentEntry {
  filePath: string
  name: string
  openedAt: string
}

// ── Recents ───────────────────────────────────────────────────────────────────

function recentsPath(): string {
  return path.join(app.getPath('userData'), 'recents.json')
}

function loadRecents(): RecentEntry[] {
  try {
    return JSON.parse(fs.readFileSync(recentsPath(), 'utf-8')) as RecentEntry[]
  } catch {
    return []
  }
}

function addToRecents(filePath: string, name: string): void {
  let recents = loadRecents().filter(r => r.filePath !== filePath)
  recents.unshift({ filePath, name, openedAt: new Date().toISOString() })
  recents = recents.slice(0, 10)
  fs.writeFileSync(recentsPath(), JSON.stringify(recents, null, 2), 'utf-8')
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// Current open file path (needed by getMeta / update)
let _currentFilePath: string | null = null

// ── Registration ──────────────────────────────────────────────────────────────

export function registerProjectHandlers(): void {
  /**
   * Create a new .flux project. Opens a save dialog, creates the DB, inserts the
   * project row, and returns a ProjectMeta object.
   */
  ipcMain.handle(
    'project:create',
    async (_event, name: string, description?: string, client?: string) => {
      const result = await dialog.showSaveDialog({
        title: 'Save New Project',
        defaultPath: `${name.replace(/\s+/g, '_')}.flux`,
        filters: [{ name: 'Flux Project', extensions: ['flux'] }],
      })
      if (result.canceled || !result.filePath) return null

      const filePath = result.filePath
      openDatabase(filePath)
      _currentFilePath = filePath

      const db = getDb()
      const id = crypto.randomUUID()
      const now = new Date().toISOString()

      db.prepare(
        'INSERT INTO projects (id, name, description, client, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, name, description ?? null, client ?? null, now, now)

      addToRecents(filePath, name)
      return rowToMeta(
        { id, name, description: description ?? null, client: client ?? null, created_at: now, updated_at: now },
        filePath
      )
    }
  )

  /**
   * Open an existing .flux file. Returns the ProjectMeta stored inside it.
   */
  ipcMain.handle('project:open', async (_event, filePath: string) => {
    openDatabase(filePath)
    _currentFilePath = filePath

    const db = getDb()
    const row = db.prepare('SELECT * FROM projects LIMIT 1').get() as ProjectRow | undefined
    if (!row) throw new Error('Invalid .flux file: no project record found.')

    addToRecents(filePath, row.name)
    return rowToMeta(row, filePath)
  })

  /** Close the current project. */
  ipcMain.handle('project:close', async () => {
    closeDatabase()
    _currentFilePath = null
  })

  /** Update editable project metadata fields. */
  ipcMain.handle(
    'project:update',
    async (_event, fields: Partial<{ name: string; description: string; client: string }>) => {
      const db = getDb()
      const now = new Date().toISOString()
      const row = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string }

      if (fields.name !== undefined) {
        db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(
          fields.name, now, row.id
        )
      }
      if (fields.description !== undefined) {
        db.prepare('UPDATE projects SET description = ?, updated_at = ? WHERE id = ?').run(
          fields.description, now, row.id
        )
      }
      if (fields.client !== undefined) {
        db.prepare('UPDATE projects SET client = ?, updated_at = ? WHERE id = ?').run(
          fields.client, now, row.id
        )
      }
      const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(row.id) as ProjectRow
      return rowToMeta(updated, _currentFilePath ?? '')
    }
  )

  /** Return the current project's metadata, or null if no project is open. */
  ipcMain.handle('project:getMeta', async () => {
    if (!isDatabaseOpen() || !_currentFilePath) return null
    const db = getDb()
    const row = db.prepare('SELECT * FROM projects LIMIT 1').get() as ProjectRow | undefined
    return row ? rowToMeta(row, _currentFilePath) : null
  })

  /** Return the list of recently opened projects. */
  ipcMain.handle('project:listRecents', async () => {
    return loadRecents()
  })

  /**
   * Close the current project, remove it from recents, and delete the .flux file.
   * The renderer is responsible for navigating back to HomeScreen after this resolves.
   */
  ipcMain.handle('project:delete', async () => {
    if (!_currentFilePath) throw new Error('No project is open.')
    const filePath = _currentFilePath

    closeDatabase()
    _currentFilePath = null

    // Remove from recents so it doesn't reappear
    const recents = loadRecents().filter(r => r.filePath !== filePath)
    fs.writeFileSync(recentsPath(), JSON.stringify(recents, null, 2), 'utf-8')

    fs.unlinkSync(filePath)
  })
}
