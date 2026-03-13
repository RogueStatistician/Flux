/**
 * Project IPC handlers — thin Electron wrapper around core/services/project.ts.
 */
import { ipcMain, app, dialog } from 'electron'
import path from 'path'
import { openDatabase, closeDatabase, isDatabaseOpen } from '../../core/db.js'
import {
  createProjectRecord, openProjectRecord, updateProjectRecord,
  getProjectMetaRecord, loadRecents, addToRecents, removeFromRecents, deleteProjectFile,
} from '../../core/services/project.js'

let _currentFilePath: string | null = null

function recentsPath(): string {
  return path.join(app.getPath('userData'), 'recents.json')
}

export function registerProjectHandlers(): void {
  ipcMain.handle('project:create', async (_e, name: string, description?: string, client?: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Save New Project',
      defaultPath: `${name.replace(/\s+/g, '_')}.flux`,
      filters: [{ name: 'Flux Project', extensions: ['flux'] }],
    })
    if (result.canceled || !result.filePath) return null
    const filePath = result.filePath
    openDatabase(filePath)
    _currentFilePath = filePath
    const record = createProjectRecord(name, description, client)
    addToRecents(recentsPath(), filePath, name)
    return { id: record.id, name: record.name, description: record.description ?? undefined, client: record.client ?? undefined, createdAt: record.created_at, updatedAt: record.updated_at, filePath }
  })

  ipcMain.handle('project:open', async (_e, filePath: string) => {
    const meta = openProjectRecord(filePath)
    _currentFilePath = filePath
    addToRecents(recentsPath(), filePath, meta.name)
    return meta
  })

  ipcMain.handle('project:close', async () => {
    closeDatabase()
    _currentFilePath = null
  })

  ipcMain.handle('project:update', async (_e, fields: Partial<{ name: string; description: string; client: string }>) => {
    return updateProjectRecord(_currentFilePath ?? '', fields)
  })

  ipcMain.handle('project:getMeta', async () => {
    if (!isDatabaseOpen() || !_currentFilePath) return null
    return getProjectMetaRecord(_currentFilePath)
  })

  ipcMain.handle('project:listRecents', async () => {
    return loadRecents(recentsPath())
  })

  ipcMain.handle('project:removeRecent', async (_e, filePath: string) => {
    removeFromRecents(recentsPath(), filePath)
  })

  ipcMain.handle('project:delete', async () => {
    if (!_currentFilePath) throw new Error('No project is open.')
    const filePath = _currentFilePath
    _currentFilePath = null
    deleteProjectFile(recentsPath(), filePath)
  })
}
