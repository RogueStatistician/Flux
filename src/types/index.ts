// ── Project ───────────────────────────────────────────────────────────────────

export interface ProjectMeta {
  id: string
  name: string
  description?: string
  client?: string
  createdAt: string
  updatedAt: string
  /** Absolute path to the .flux file on disk. */
  filePath: string
}

export interface RecentProject {
  filePath: string
  name: string
  openedAt: string
}

// ── UI state ──────────────────────────────────────────────────────────────────

export type AppView = 'home' | 'workspace' | 'admin'

export type WorkspaceSection =
  | 'sources'
  | 'targets'
  | 'picklists'
  | 'plmappings'
  | 'transformations'
  | 'runs'
  | 'devtools'

// ── Schema inference ──────────────────────────────────────────────────────────

/** Field descriptor returned by the schema inference engine before it is saved. */
export interface InferredField {
  name: string
  dataType: FieldType
  isRequired: boolean
  isNullable: boolean
  dateFormat?: string
}

// ── Data model (mirrors SQLite schema rows) ───────────────────────────────────

export type ObjectRole = 'source' | 'target'
export type FieldType = 'string' | 'integer' | 'float' | 'date' | 'datetime' | 'picklist'
export type PicklistSide = 'source' | 'target'
export type OutputFormat = 'xlsx' | 'csv'
export type RunStatus = 'running' | 'completed' | 'failed'
export type IssueSeverity = 'warning' | 'error'

export interface DataObject {
  id: string
  projectId: string
  role: ObjectRole
  name: string
  description?: string
  systemName?: string
  fileName?: string
  rowCount?: number
  outputFormat: OutputFormat
  /** 0-based row index that contains column headers (target templates). */
  templateHeaderRow?: number
  /**
   * 0-based row index where transformed data is written in the output file.
   * When absent the engine falls back to templateHeaderRow + 1.
   * Setting this independently allows the header row (for field-name inference)
   * to differ from the last preamble row (e.g. header on row 1, data from row 6).
   */
  templateDataStartRow?: number
  /** Number of leading columns to skip when reading/writing data (target templates). */
  templateSkipColumns?: number
  /** Absolute path to the uploaded template file; used to preserve layout on output. */
  templateFilePath?: string
  createdAt: string
  updatedAt: string
}

export interface ObjectField {
  id: string
  objectId: string
  name: string
  description?: string
  dataType: FieldType
  isRequired: boolean
  isNullable: boolean
  picklistId?: string
  dateFormat?: string
  maxLength?: number
  position: number
  notes?: string
}

export interface Picklist {
  id: string
  projectId: string
  name: string
  description?: string
  side: PicklistSide
  createdAt: string
}

export interface PicklistValue {
  id: string
  picklistId: string
  key: string
  label?: string
  position: number
}

export interface PicklistMapping {
  id: string
  projectId: string
  name: string
  sourcePicklistId?: string
  targetPicklistId?: string
  createdAt: string
}

export interface PicklistMappingEntry {
  id: string
  mappingId: string
  sourceKey: string
  targetKey: string
}

export interface Transformation {
  id: string
  projectId: string
  name: string
  description?: string
  canvasState?: string
  createdAt: string
  updatedAt: string
}

export interface FieldMapping {
  id: string
  transformationId: string
  targetObjectId: string
  targetFieldId: string
  ruleType: string
  ruleConfig: string
  notes?: string
  mapNodeId?: string
}

export interface Run {
  id: string
  transformationId: string
  startedAt: string
  completedAt?: string
  status: RunStatus
  stats?: string
  outputManifest?: string
}

export interface RunIssue {
  id: number
  runId: string
  rowIndex?: number
  fieldName?: string
  severity: IssueSeverity
  message: string
}
