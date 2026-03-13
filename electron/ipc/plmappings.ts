/**
 * Picklist Mappings IPC handlers — thin Electron wrapper around core/services/plmappings.ts.
 */
import { ipcMain } from 'electron'
import {
  createPlMapping, listPlMappings, getPlMapping, updatePlMapping, deletePlMapping,
  setPlMappingEntries, importPlMappingEntriesFromFile, bulkImportPlMappingsFromFile,
} from '../../core/services/plmappings.js'

export function registerPlMappingHandlers(): void {
  ipcMain.handle('plmappings:create', async (_e, name: string, sourcePicklistId?: string, targetPicklistId?: string) => createPlMapping(name, sourcePicklistId, targetPicklistId))
  ipcMain.handle('plmappings:list', async () => listPlMappings())
  ipcMain.handle('plmappings:get', async (_e, id: string) => getPlMapping(id))
  ipcMain.handle('plmappings:update', async (_e, id: string, updates: Partial<{ name: string; sourcePicklistId: string | null; targetPicklistId: string | null }>) => updatePlMapping(id, updates))
  ipcMain.handle('plmappings:delete', async (_e, id: string) => deletePlMapping(id))
  ipcMain.handle('plmappings:setEntries', async (_e, id: string, entries: Array<{ sourceKey: string; targetKey: string }>) => setPlMappingEntries(id, entries))
  ipcMain.handle('plmappings:importEntriesFromFile', async (_e, id: string, filePath: string, sourceKeyCol: string, targetKeyCol: string) => importPlMappingEntriesFromFile(id, filePath, sourceKeyCol, targetKeyCol))
  ipcMain.handle('plmappings:bulkImportFromFile', async (_e, filePath: string) => bulkImportPlMappingsFromFile(filePath))
}
