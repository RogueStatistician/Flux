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

export type AppView = 'home' | 'workspace'

export type WorkspaceSection =
  | 'sources'
  | 'targets'
  | 'picklists'
  | 'plmappings'
  | 'transformations'
  | 'runs'

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
