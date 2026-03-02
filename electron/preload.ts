/**
 * Preload — narrow IPC bridge between Renderer (React) and Main (Node.js).
 * Only explicitly listed methods are exposed. All IPC is typed.
 *
 * Security: contextIsolation = true, nodeIntegration = false (enforced in main.ts).
 */
import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  // ── Project ────────────────────────────────────────────────────────────────
  createProject: (name: string, description?: string, client?: string) =>
    ipcRenderer.invoke('project:create', name, description, client),

  openProject: (filePath: string) =>
    ipcRenderer.invoke('project:open', filePath),

  closeProject: () =>
    ipcRenderer.invoke('project:close'),

  updateProject: (fields: Partial<{ name: string; description: string; client: string }>) =>
    ipcRenderer.invoke('project:update', fields),

  getProjectMeta: () =>
    ipcRenderer.invoke('project:getMeta'),

  listRecentProjects: () =>
    ipcRenderer.invoke('project:listRecents'),

  deleteProject: () =>
    ipcRenderer.invoke('project:delete'),

  // ── Objects & Fields ───────────────────────────────────────────────────────
  inferSchema: (filePath: string, options?: { separator?: string; skipRows?: number; skipColumns?: number }) =>
    ipcRenderer.invoke('objects:inferSchema', filePath, options),

  inferSchemaFromHeaders: (filePath: string, options?: { separator?: string; skipRows?: number; skipColumns?: number }) =>
    ipcRenderer.invoke('objects:inferSchemaFromHeaders', filePath, options),

  createObject: (
    role: 'source' | 'target',
    name: string,
    description?: string,
    systemName?: string,
    outputFormat?: 'xlsx' | 'csv',
    templateConfig?: { headerRow?: number; dataStartRow?: number; skipColumns?: number; filePath?: string }
  ) =>
    ipcRenderer.invoke('objects:create', role, name, description, systemName, outputFormat, templateConfig),

  listObjects: (role?: 'source' | 'target') =>
    ipcRenderer.invoke('objects:list', role),

  getObject: (id: string) =>
    ipcRenderer.invoke('objects:get', id),

  updateObject: (id: string, updates: Partial<{ name: string; description: string; systemName: string; outputFormat: 'xlsx' | 'csv' }>) =>
    ipcRenderer.invoke('objects:update', id, updates),

  deleteObject: (id: string) =>
    ipcRenderer.invoke('objects:delete', id),

  importRows: (id: string, filePath: string, options?: { separator?: string; skipRows?: number; skipColumns?: number }) =>
    ipcRenderer.invoke('objects:importRows', id, filePath, options),

  getRows: (id: string, offset: number, limit: number) =>
    ipcRenderer.invoke('objects:getRows', id, offset, limit),

  upsertFields: (objectId: string, fields: unknown[]) =>
    ipcRenderer.invoke('fields:upsert', objectId, fields),

  // ── Picklists ──────────────────────────────────────────────────────────────
  createPicklist: (side: 'source' | 'target', name: string, description?: string) =>
    ipcRenderer.invoke('picklists:create', side, name, description),

  listPicklists: (side?: 'source' | 'target') =>
    ipcRenderer.invoke('picklists:list', side),

  getPicklist: (id: string) =>
    ipcRenderer.invoke('picklists:get', id),

  updatePicklist: (id: string, updates: Partial<{ name: string; description: string }>) =>
    ipcRenderer.invoke('picklists:update', id, updates),

  deletePicklist: (id: string) =>
    ipcRenderer.invoke('picklists:delete', id),

  setPicklistValues: (id: string, values: Array<{ key: string; label?: string }>) =>
    ipcRenderer.invoke('picklists:setValues', id, values),

  importPicklistFromFile: (id: string, filePath: string, keyCol: string, labelCol?: string) =>
    ipcRenderer.invoke('picklists:importFromFile', id, filePath, keyCol, labelCol),

  // ── Picklist Mappings ──────────────────────────────────────────────────────
  createPlMapping: (name: string, sourcePicklistId?: string, targetPicklistId?: string) =>
    ipcRenderer.invoke('plmappings:create', name, sourcePicklistId, targetPicklistId),

  listPlMappings: () =>
    ipcRenderer.invoke('plmappings:list'),

  getPlMapping: (id: string) =>
    ipcRenderer.invoke('plmappings:get', id),

  updatePlMapping: (id: string, updates: Partial<{ name: string; sourcePicklistId: string | null; targetPicklistId: string | null }>) =>
    ipcRenderer.invoke('plmappings:update', id, updates),

  deletePlMapping: (id: string) =>
    ipcRenderer.invoke('plmappings:delete', id),

  setPlMappingEntries: (id: string, entries: Array<{ sourceKey: string; targetKey: string }>) =>
    ipcRenderer.invoke('plmappings:setEntries', id, entries),

  // ── Transformations ────────────────────────────────────────────────────────
  createTransformation: (name: string, description?: string) =>
    ipcRenderer.invoke('transformations:create', name, description),

  listTransformations: () =>
    ipcRenderer.invoke('transformations:list'),

  getTransformation: (id: string) =>
    ipcRenderer.invoke('transformations:get', id),

  updateTransformation: (id: string, updates: Partial<{ name: string; description: string }>) =>
    ipcRenderer.invoke('transformations:update', id, updates),

  saveCanvas: (id: string, canvasState: string) =>
    ipcRenderer.invoke('transformations:saveCanvas', id, canvasState),

  deleteTransformation: (id: string) =>
    ipcRenderer.invoke('transformations:delete', id),

  createFieldMapping: (transformationId: string, targetObjectId: string, targetFieldId: string, ruleType: string, ruleConfig: string, notes?: string) =>
    ipcRenderer.invoke('transformations:createFieldMapping', transformationId, targetObjectId, targetFieldId, ruleType, ruleConfig, notes),

  updateFieldMapping: (id: string, updates: Partial<{ ruleType: string; ruleConfig: string; notes: string }>) =>
    ipcRenderer.invoke('transformations:updateFieldMapping', id, updates),

  deleteFieldMapping: (id: string) =>
    ipcRenderer.invoke('transformations:deleteFieldMapping', id),

  getFieldMappings: (transformationId: string) =>
    ipcRenderer.invoke('transformations:getFieldMappings', transformationId),

  // ── Runs & export ──────────────────────────────────────────────────────────
  startRun: (transformationId: string) =>
    ipcRenderer.invoke('run:start', transformationId),

  cancelRun: (runId: string) =>
    ipcRenderer.invoke('run:cancel', runId),

  getRun: (runId: string) =>
    ipcRenderer.invoke('run:get', runId),

  listRuns: (transformationId?: string) =>
    ipcRenderer.invoke('run:list', transformationId),

  getRunIssues: (runId: string, severity?: string) =>
    ipcRenderer.invoke('run:getIssues', runId, severity),

  saveOutput: (runId: string, targetObjectId: string, destPath: string) =>
    ipcRenderer.invoke('export:saveOutput', runId, targetObjectId, destPath),

  onRunProgress: (callback: (data: Record<string, unknown>) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Record<string, unknown>) => callback(data)
    ipcRenderer.on('run:progress', handler)
    return () => ipcRenderer.removeListener('run:progress', handler)
  },

  // ── Dialogs ────────────────────────────────────────────────────────────────
  openFile: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke('dialog:openFile', options),

  saveFile: (options: Electron.SaveDialogOptions) =>
    ipcRenderer.invoke('dialog:saveFile', options),

  openPath: (folderPath: string) =>
    ipcRenderer.invoke('shell:openPath', folderPath),
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
