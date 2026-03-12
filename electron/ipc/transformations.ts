/**
 * Transformations IPC handlers — thin Electron wrapper around core/services/transformations.ts.
 */
import { ipcMain } from 'electron'
import {
  createTransformation, listTransformations, getTransformation, updateTransformation,
  saveCanvas, deleteTransformation, duplicateTransformation,
  createFieldMapping, updateFieldMapping, deleteFieldMapping,
  deleteFieldMappingsByTarget, getFieldMappings, getFieldMappingsByNode, deleteFieldMappingsByNode,
} from '../../core/services/transformations.js'

export function registerTransformationHandlers(): void {
  ipcMain.handle('transformations:create', async (_e, name: string, description?: string) => createTransformation(name, description))
  ipcMain.handle('transformations:list', async () => listTransformations())
  ipcMain.handle('transformations:get', async (_e, id: string) => getTransformation(id))
  ipcMain.handle('transformations:update', async (_e, id: string, updates: Partial<{ name: string; description: string }>) => updateTransformation(id, updates))
  ipcMain.handle('transformations:saveCanvas', async (_e, id: string, canvasState: string) => saveCanvas(id, canvasState))
  ipcMain.handle('transformations:delete', async (_e, id: string) => deleteTransformation(id))
  ipcMain.handle('transformations:duplicate', async (_e, id: string) => duplicateTransformation(id))
  ipcMain.handle('transformations:createFieldMapping', async (_e, transformationId: string, targetObjectId: string, targetFieldId: string, ruleType: string, ruleConfig: string, notes?: string, mapNodeId?: string) => createFieldMapping(transformationId, targetObjectId, targetFieldId, ruleType, ruleConfig, notes, mapNodeId))
  ipcMain.handle('transformations:updateFieldMapping', async (_e, id: string, updates: Partial<{ ruleType: string; ruleConfig: string; notes: string }>) => updateFieldMapping(id, updates))
  ipcMain.handle('transformations:deleteFieldMapping', async (_e, id: string) => deleteFieldMapping(id))
  ipcMain.handle('transformations:deleteFieldMappingsByTarget', async (_e, transformationId: string, targetObjectId: string) => deleteFieldMappingsByTarget(transformationId, targetObjectId))
  ipcMain.handle('transformations:getFieldMappings', async (_e, transformationId: string) => getFieldMappings(transformationId))
  ipcMain.handle('transformations:getFieldMappingsByNode', async (_e, mapNodeId: string) => getFieldMappingsByNode(mapNodeId))
  ipcMain.handle('transformations:deleteFieldMappingsByNode', async (_e, mapNodeId: string) => deleteFieldMappingsByNode(mapNodeId))
}
