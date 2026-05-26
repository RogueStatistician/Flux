/**
 * Picklists IPC handlers — thin Electron wrapper around core/services/picklists.ts.
 */
import fs from 'fs'
import { ipcMain } from 'electron'
import {
  createPicklist, listPicklists, getPicklist, updatePicklist, deletePicklist,
  setPicklistValues, importPicklistFromFile, bulkImportPicklistsFromFile,
  exportPicklistsToBuffer,
} from '../../core/services/picklists.js'

export function registerPicklistHandlers(): void {
  ipcMain.handle('picklists:create', async (_e, side: 'source' | 'target', name: string, description?: string) => createPicklist(side, name, description))
  ipcMain.handle('picklists:list', async (_e, side?: 'source' | 'target') => listPicklists(side))
  ipcMain.handle('picklists:get', async (_e, id: string) => getPicklist(id))
  ipcMain.handle('picklists:update', async (_e, id: string, updates: Partial<{ name: string; description: string }>) => updatePicklist(id, updates))
  ipcMain.handle('picklists:delete', async (_e, id: string) => deletePicklist(id))
  ipcMain.handle('picklists:setValues', async (_e, id: string, values: Array<{ key: string; label?: string }>) => setPicklistValues(id, values))
  ipcMain.handle('picklists:importFromFile', async (_e, id: string, filePath: string, keyCol: string, labelCol?: string) => importPicklistFromFile(id, filePath, keyCol, labelCol))
  ipcMain.handle('picklists:bulkImportFromFile', async (_e, filePath: string, side: 'source' | 'target') => bulkImportPicklistsFromFile(filePath, side))
  ipcMain.handle('picklists:exportToFile', async (_e, destPath: string, side?: 'source' | 'target') => {
    const buf = await exportPicklistsToBuffer(side)
    fs.writeFileSync(destPath, buf)
  })
}
