/**
 * Objects IPC handlers — thin Electron wrapper around core/services/objects.ts.
 */
import { ipcMain } from 'electron'
import type { ParseOptions } from '../../core/importer.js'
import {
  inferSchemaFromFile, inferSchemaFromHeadersOnly, createObject, listObjects,
  getObject, updateObject, deleteObject, importRows, getRows, upsertFields,
} from '../../core/services/objects.js'

export function registerObjectHandlers(): void {
  ipcMain.handle('objects:inferSchema', async (_e, filePath: string, options?: ParseOptions) => inferSchemaFromFile(filePath, options))
  ipcMain.handle('objects:inferSchemaFromHeaders', async (_e, filePath: string, options?: ParseOptions) => inferSchemaFromHeadersOnly(filePath, options))
  ipcMain.handle('objects:create', async (_e, role: 'source'|'target', name: string, description?: string, systemName?: string, outputFormat: 'xlsx'|'csv' = 'xlsx', templateConfig?: { headerRow?: number; dataStartRow?: number; skipColumns?: number; filePath?: string }) => createObject(role, name, description, systemName, outputFormat, templateConfig))
  ipcMain.handle('objects:list', async (_e, role?: 'source'|'target') => listObjects(role))
  ipcMain.handle('objects:get', async (_e, id: string) => getObject(id))
  ipcMain.handle('objects:update', async (_e, id: string, updates: Partial<{ name: string; description: string; systemName: string; outputFormat: 'xlsx'|'csv' }>) => updateObject(id, updates))
  ipcMain.handle('objects:delete', async (_e, id: string) => deleteObject(id))
  ipcMain.handle('objects:importRows', async (_e, id: string, filePath: string, options?: ParseOptions) => importRows(id, filePath, options))
  ipcMain.handle('objects:getRows', async (_e, id: string, offset: number, limit: number) => getRows(id, offset, limit))
  ipcMain.handle('fields:upsert', async (_e, objectId: string, fields: Array<{ name: string; description?: string; dataType: string; isRequired: boolean; isNullable: boolean; picklistId?: string; dateFormat?: string; maxLength?: number; notes?: string }>) => upsertFields(objectId, fields))
}
