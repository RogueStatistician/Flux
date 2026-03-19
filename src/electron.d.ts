/**
 * TypeScript ambient declarations for the Electron IPC bridge
 * exposed via contextBridge in electron/preload.ts.
 */
import type {
  ProjectMeta, RecentProject,
  DataObject, ObjectField, InferredField,
  ObjectRole, OutputFormat,
  Picklist, PicklistValue, PicklistSide,
  PicklistMapping, PicklistMappingEntry,
  Transformation, FieldMapping,
  Run, RunIssue, IssueSeverity,
} from './types/index.js'

export interface RunProgressEvent {
  runId: string
  status: 'running' | 'completed' | 'failed'
  phase?: string
  currentTarget?: string
  rowsDone?: number
  rowsTotal?: number
  stats?: { totalRowsProcessed: number; totalIssues: number; targetCount: number }
  error?: string
}

export interface OutputManifestTarget {
  objectId: string
  objectName: string
  format: string
  filePath: string
  rowCount: number
}

interface ElectronAPI {
  // ── Project ────────────────────────────────────────────────────────────────
  createProject(name: string, description?: string, client?: string): Promise<ProjectMeta | null>
  openProject(filePath: string): Promise<ProjectMeta>
  closeProject(): Promise<void>
  updateProject(fields: Partial<{ name: string; description: string; client: string }>): Promise<ProjectMeta>
  getProjectMeta(): Promise<ProjectMeta | null>
  listRecentProjects(): Promise<RecentProject[]>
  removeRecentProject(filePath: string): Promise<void>
  deleteProject(): Promise<void>

  // ── Objects & Fields ───────────────────────────────────────────────────────
  inferSchema(filePath: string, options?: { separator?: string; skipRows?: number; skipColumns?: number }): Promise<{ headers: string[]; fields: InferredField[]; rows: Record<string, string>[] }>
  inferSchemaFromHeaders(filePath: string, options?: { separator?: string; skipRows?: number; skipColumns?: number }): Promise<{ headers: string[]; fields: InferredField[] }>
  createObject(
    role: ObjectRole,
    name: string,
    description?: string,
    systemName?: string,
    outputFormat?: OutputFormat,
    templateConfig?: {
      /** 0-based index of the row containing column headers. */
      headerRow?: number
      /**
       * 0-based index of the first data row in the output file.
       * Defaults to headerRow + 1 when omitted (Case A).
       * Set explicitly when the header row for field-name inference is different
       * from the last preserved preamble row (Case B, e.g. Workday templates
       * where column names are on row 1 but data starts on row 6).
       */
      dataStartRow?: number
      /** Number of leading columns to skip when reading/writing data (default 0). */
      skipColumns?: number
      /** Absolute path to the original template file for structure-preserving output. */
      filePath?: string
    }
  ): Promise<DataObject>
  listObjects(role?: ObjectRole): Promise<DataObject[]>
  getObject(id: string): Promise<{ object: DataObject; fields: ObjectField[] }>
  updateObject(id: string, updates: Partial<{ name: string; description: string; systemName: string; outputFormat: OutputFormat }>): Promise<DataObject>
  deleteObject(id: string): Promise<void>
  importRows(id: string, filePath: string, options?: { separator?: string; skipRows?: number; dataStartRow?: number; skipColumns?: number }): Promise<{ rowCount: number }>
  getRows(id: string, offset: number, limit: number): Promise<{ rows: Record<string, string>[]; total: number }>
  upsertFields(objectId: string, fields: Omit<ObjectField, 'id' | 'objectId' | 'position'>[]): Promise<ObjectField[]>

  // ── Picklists ──────────────────────────────────────────────────────────────
  createPicklist(side: PicklistSide, name: string, description?: string): Promise<Picklist>
  listPicklists(side?: PicklistSide): Promise<Picklist[]>
  getPicklist(id: string): Promise<{ picklist: Picklist; values: PicklistValue[] }>
  updatePicklist(id: string, updates: Partial<{ name: string; description: string }>): Promise<Picklist>
  deletePicklist(id: string): Promise<void>
  setPicklistValues(id: string, values: Array<{ key: string; label?: string }>): Promise<PicklistValue[]>
  importPicklistFromFile(id: string, filePath: string, keyCol: string, labelCol?: string): Promise<{ valueCount: number }>
  bulkImportPicklistsFromFile(filePath: string, side: 'source' | 'target'): Promise<{
    results: Array<{ name: string; created: boolean; valueCount: number }>
    errors: Array<{ name: string; error: string }>
  }>

  // ── Picklist Mappings ──────────────────────────────────────────────────────
  createPlMapping(name: string, sourcePicklistId?: string, targetPicklistId?: string): Promise<PicklistMapping>
  listPlMappings(): Promise<PicklistMapping[]>
  getPlMapping(id: string): Promise<{ mapping: PicklistMapping; entries: PicklistMappingEntry[] }>
  updatePlMapping(id: string, updates: Partial<{ name: string; sourcePicklistId: string | null; targetPicklistId: string | null }>): Promise<PicklistMapping>
  deletePlMapping(id: string): Promise<void>
  setPlMappingEntries(id: string, entries: Array<{ sourceKey: string; targetKey: string }>): Promise<PicklistMappingEntry[]>
  importPlMappingEntriesFromFile(id: string, filePath: string, sourceKeyCol: string, targetKeyCol: string): Promise<{ entryCount: number }>
  bulkImportPlMappingsFromFile(filePath: string): Promise<{
    results: Array<{ name: string; created: boolean; entryCount: number }>
    errors: Array<{ name: string; error: string }>
  }>

  // ── Transformations ────────────────────────────────────────────────────────
  createTransformation(name: string, description?: string): Promise<Transformation>
  listTransformations(): Promise<Transformation[]>
  getTransformation(id: string): Promise<Transformation>
  updateTransformation(id: string, updates: Partial<{ name: string; description: string }>): Promise<Transformation>
  saveCanvas(id: string, canvasState: string): Promise<void>
  deleteTransformation(id: string): Promise<void>
  duplicateTransformation(id: string): Promise<Transformation>
  createFieldMapping(transformationId: string, targetObjectId: string, targetFieldId: string, ruleType: string, ruleConfig: string, notes?: string, mapNodeId?: string): Promise<FieldMapping>
  updateFieldMapping(id: string, updates: Partial<{ ruleType: string; ruleConfig: string; notes: string }>): Promise<FieldMapping>
  deleteFieldMapping(id: string): Promise<void>
  deleteFieldMappingsByTarget(transformationId: string, targetObjectId: string): Promise<void>
  getFieldMappings(transformationId: string): Promise<FieldMapping[]>
  getFieldMappingsByNode(mapNodeId: string): Promise<FieldMapping[]>
  deleteFieldMappingsByNode(mapNodeId: string): Promise<void>

  // ── Runs & export ──────────────────────────────────────────────────────────
  startRun(transformationId: string): Promise<string>
  cancelRun(runId: string): Promise<void>
  getRun(runId: string): Promise<Run>
  listRuns(transformationId?: string): Promise<Run[]>
  getRunIssues(runId: string, severity?: IssueSeverity): Promise<RunIssue[]>
  saveOutput(runId: string, targetObjectId: string, destPath: string): Promise<void>
  previewOutput(runId: string, targetObjectId: string, limit?: number): Promise<{ headers: string[]; rows: Record<string, string>[]; totalRows: number }>
  onRunProgress(callback: (data: RunProgressEvent) => void): () => void

  // ── Dialogs ────────────────────────────────────────────────────────────────
  openFile(options: {
    title?: string
    filters?: Array<{ name: string; extensions: string[] }>
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>
  }): Promise<{ canceled: boolean; filePaths: string[] }>

  saveFile(options: {
    title?: string
    defaultPath?: string
    filters?: Array<{ name: string; extensions: string[] }>
  }): Promise<{ canceled: boolean; filePath?: string }>

  openPath(path: string): Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
