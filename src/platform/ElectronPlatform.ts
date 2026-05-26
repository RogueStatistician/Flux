/**
 * ElectronPlatform — delegates every IPlatform call to window.electronAPI.
 * Used when running inside Electron (contextBridge is available).
 */
import type { IPlatform, RunProgressEvent, OpenFileOptions, SaveFileOptions } from './IPlatform.js'

export class ElectronPlatform implements IPlatform {
  // ── Project ──────────────────────────────────────────────────────────────
  createProject(name: string, description?: string, client?: string) { return window.electronAPI.createProject(name, description, client) }
  openProject(filePath: string) { return window.electronAPI.openProject(filePath) }
  closeProject() { return window.electronAPI.closeProject() }
  updateProject(fields: Parameters<typeof window.electronAPI.updateProject>[0]) { return window.electronAPI.updateProject(fields) }
  getProjectMeta() { return window.electronAPI.getProjectMeta() }
  listRecentProjects() { return window.electronAPI.listRecentProjects() }
  removeRecentProject(filePath: string) { return window.electronAPI.removeRecentProject(filePath) }
  deleteProject() { return window.electronAPI.deleteProject() }

  // ── Objects & Fields ─────────────────────────────────────────────────────
  inferSchema(filePath: string, options?: Parameters<typeof window.electronAPI.inferSchema>[1]) { return window.electronAPI.inferSchema(filePath, options) }
  inferSchemaFromHeaders(filePath: string, options?: Parameters<typeof window.electronAPI.inferSchemaFromHeaders>[1]) { return window.electronAPI.inferSchemaFromHeaders(filePath, options) }
  createObject(...args: Parameters<typeof window.electronAPI.createObject>) { return window.electronAPI.createObject(...args) }
  listObjects(role?: Parameters<typeof window.electronAPI.listObjects>[0]) { return window.electronAPI.listObjects(role) }
  getObject(id: string) { return window.electronAPI.getObject(id) }
  updateObject(id: string, updates: Parameters<typeof window.electronAPI.updateObject>[1]) { return window.electronAPI.updateObject(id, updates) }
  deleteObject(id: string) { return window.electronAPI.deleteObject(id) }
  importRows(id: string, filePath: string, options?: Parameters<typeof window.electronAPI.importRows>[2]) { return window.electronAPI.importRows(id, filePath, options) }
  relinkSourceFile(id: string, newFilePath: string) { return window.electronAPI.relinkSourceFile(id, newFilePath) }
  getSourceFileStatus(id: string) { return window.electronAPI.getSourceFileStatus(id) }
  getRows(id: string, offset: number, limit: number) { return window.electronAPI.getRows(id, offset, limit) }
  upsertFields(objectId: string, fields: Parameters<typeof window.electronAPI.upsertFields>[1]) { return window.electronAPI.upsertFields(objectId, fields) }

  // ── Picklists ────────────────────────────────────────────────────────────
  createPicklist(side: Parameters<typeof window.electronAPI.createPicklist>[0], name: string, description?: string) { return window.electronAPI.createPicklist(side, name, description) }
  listPicklists(side?: Parameters<typeof window.electronAPI.listPicklists>[0]) { return window.electronAPI.listPicklists(side) }
  getPicklist(id: string) { return window.electronAPI.getPicklist(id) }
  updatePicklist(id: string, updates: Parameters<typeof window.electronAPI.updatePicklist>[1]) { return window.electronAPI.updatePicklist(id, updates) }
  deletePicklist(id: string) { return window.electronAPI.deletePicklist(id) }
  setPicklistValues(id: string, values: Parameters<typeof window.electronAPI.setPicklistValues>[1]) { return window.electronAPI.setPicklistValues(id, values) }
  importPicklistFromFile(id: string, filePath: string, keyCol: string, labelCol?: string) { return window.electronAPI.importPicklistFromFile(id, filePath, keyCol, labelCol) }
  bulkImportPicklistsFromFile(filePath: string, side: 'source' | 'target') { return window.electronAPI.bulkImportPicklistsFromFile(filePath, side) }
  exportPicklistsToFile(destPath: string, side?: 'source' | 'target') { return window.electronAPI.exportPicklistsToFile(destPath, side) }

  // ── Picklist Mappings ────────────────────────────────────────────────────
  createPlMapping(name: string, sourcePicklistId?: string, targetPicklistId?: string) { return window.electronAPI.createPlMapping(name, sourcePicklistId, targetPicklistId) }
  listPlMappings() { return window.electronAPI.listPlMappings() }
  getPlMapping(id: string) { return window.electronAPI.getPlMapping(id) }
  updatePlMapping(id: string, updates: Parameters<typeof window.electronAPI.updatePlMapping>[1]) { return window.electronAPI.updatePlMapping(id, updates) }
  deletePlMapping(id: string) { return window.electronAPI.deletePlMapping(id) }
  setPlMappingEntries(id: string, entries: Parameters<typeof window.electronAPI.setPlMappingEntries>[1]) { return window.electronAPI.setPlMappingEntries(id, entries) }
  importPlMappingEntriesFromFile(id: string, filePath: string, sourceKeyCol: string, targetKeyCol: string) { return window.electronAPI.importPlMappingEntriesFromFile(id, filePath, sourceKeyCol, targetKeyCol) }
  bulkImportPlMappingsFromFile(filePath: string) { return window.electronAPI.bulkImportPlMappingsFromFile(filePath) }
  exportPlMappingsToFile(destPath: string) { return window.electronAPI.exportPlMappingsToFile(destPath) }

  // ── Transformations ──────────────────────────────────────────────────────
  createTransformation(name: string, description?: string) { return window.electronAPI.createTransformation(name, description) }
  listTransformations() { return window.electronAPI.listTransformations() }
  getTransformation(id: string) { return window.electronAPI.getTransformation(id) }
  updateTransformation(id: string, updates: Parameters<typeof window.electronAPI.updateTransformation>[1]) { return window.electronAPI.updateTransformation(id, updates) }
  saveCanvas(id: string, canvasState: string) { return window.electronAPI.saveCanvas(id, canvasState) }
  deleteTransformation(id: string) { return window.electronAPI.deleteTransformation(id) }
  duplicateTransformation(id: string) { return window.electronAPI.duplicateTransformation(id) }
  createFieldMapping(transformationId: string, targetObjectId: string, targetFieldId: string, ruleType: string, ruleConfig: string, notes?: string, mapNodeId?: string) { return window.electronAPI.createFieldMapping(transformationId, targetObjectId, targetFieldId, ruleType, ruleConfig, notes, mapNodeId) }
  updateFieldMapping(id: string, updates: Parameters<typeof window.electronAPI.updateFieldMapping>[1]) { return window.electronAPI.updateFieldMapping(id, updates) }
  deleteFieldMapping(id: string) { return window.electronAPI.deleteFieldMapping(id) }
  deleteFieldMappingsByTarget(transformationId: string, targetObjectId: string) { return window.electronAPI.deleteFieldMappingsByTarget(transformationId, targetObjectId) }
  getFieldMappings(transformationId: string) { return window.electronAPI.getFieldMappings(transformationId) }
  getFieldMappingsByNode(mapNodeId: string) { return window.electronAPI.getFieldMappingsByNode(mapNodeId) }
  deleteFieldMappingsByNode(mapNodeId: string) { return window.electronAPI.deleteFieldMappingsByNode(mapNodeId) }

  // ── Runs & export ────────────────────────────────────────────────────────
  startRun(transformationId: string) { return window.electronAPI.startRun(transformationId) }
  cancelRun(runId: string) { return window.electronAPI.cancelRun(runId) }
  getRun(runId: string) { return window.electronAPI.getRun(runId) }
  listRuns(transformationId?: string) { return window.electronAPI.listRuns(transformationId) }
  getRunIssues(runId: string, severity?: Parameters<typeof window.electronAPI.getRunIssues>[1]) { return window.electronAPI.getRunIssues(runId, severity) }
  saveOutput(runId: string, targetObjectId: string, destPath: string) { return window.electronAPI.saveOutput(runId, targetObjectId, destPath) }
  previewOutput(runId: string, targetObjectId: string, limit?: number) { return window.electronAPI.previewOutput(runId, targetObjectId, limit) }
  onRunProgress(callback: (data: RunProgressEvent) => void) { return window.electronAPI.onRunProgress(callback) }

  // ── Dialogs & shell ──────────────────────────────────────────────────────
  openFile(options: OpenFileOptions) { return window.electronAPI.openFile(options) }
  saveFile(options: SaveFileOptions) { return window.electronAPI.saveFile(options) }
  openPath(path: string) { return window.electronAPI.openPath(path) }

  // ── Dev tools ────────────────────────────────────────────────────────────
  dbListTables() { return window.electronAPI.dbListTables() }
  dbQueryTable(tableName: string, page: number, pageSize: number) { return window.electronAPI.dbQueryTable(tableName, page, pageSize) }
  dbRawQuery(sql: string) { return window.electronAPI.dbRawQuery(sql) }
  renderTransformationQuery(transformationId: string) { return window.electronAPI.renderTransformationQuery(transformationId) }
}
