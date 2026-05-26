/**
 * WebPlatform — implements IPlatform by calling the Express web server via fetch.
 * Used when running in a browser (no window.electronAPI).
 *
 * File I/O is handled transparently:
 * - openFile() presents a browser file picker, uploads the file to the server,
 *   and returns the resulting server-side temp path as if it were a local path.
 * - saveOutput() triggers a browser download instead of a native save dialog.
 * - openPath() is a no-op (can't open a file explorer from the browser).
 */
import { DataObject, FieldMapping, InferredField, ObjectField, Picklist, PicklistMapping, PicklistMappingEntry, PicklistValue, ProjectMeta, RecentProject, Run, RunIssue, Transformation } from '@/types/index.js'
import type { IPlatform, RunProgressEvent, OpenFileOptions, SaveFileOptions } from './IPlatform.js'
import { useAuthStore } from '../store/auth.js'

const BASE = '/api'

// Promise-queue pattern: collapses concurrent refresh calls into a single round-trip
let _refreshPromise: Promise<void> | null = null

function ensureFreshToken(): Promise<void> {
  if (!_refreshPromise) {
    _refreshPromise = fetch('/auth/refresh', { method: 'POST', credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error('refresh_failed') })
      .finally(() => { _refreshPromise = null })
  }
  return _refreshPromise
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401) {
    const data = await res.json().catch(() => ({})) as { code?: string }
    if (data.code === 'TOKEN_EXPIRED') {
      try {
        await ensureFreshToken()
        // Retry the original request once with fresh token
        const retry = await fetch(`${BASE}${path}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        })
        if (retry.ok) return retry.json() as Promise<T>
        const retryText = await retry.text()
        throw new Error(retryText || `HTTP ${retry.status}`)
      } catch {
        useAuthStore.getState().clearUser()
        throw new Error('Session expired. Please log in again.')
      }
    }
    useAuthStore.getState().clearUser()
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

/** Upload a File object to the server; returns the server-side temp path. */
async function uploadFile(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${BASE}/files/upload`, { method: 'POST', credentials: 'include', body: formData })
  if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`)
  const { path } = await res.json() as { path: string }
  return path
}

/** Show a browser file picker, upload the selected file, return the server temp path. */
function pickAndUpload(options: OpenFileOptions): Promise<{ canceled: boolean; filePaths: string[] }> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (options.filters) {
      const exts = options.filters.flatMap(f => f.extensions.map(e => `.${e}`))
      input.accept = exts.join(',')
    }
    if (options.properties?.includes('multiSelections')) input.multiple = true

    let settled = false
    const settle = (result: { canceled: boolean; filePaths: string[] }) => {
      if (!settled) { settled = true; resolve(result) }
    }

    input.addEventListener('change', async () => {
      const files = Array.from(input.files ?? [])
      if (files.length === 0) { settle({ canceled: true, filePaths: [] }); return }
      try {
        const paths = await Promise.all(files.map(uploadFile))
        settle({ canceled: false, filePaths: paths })
      } catch {
        settle({ canceled: true, filePaths: [] })
      }
    })

    input.addEventListener('cancel', () => settle({ canceled: true, filePaths: [] }))
    // Fallback: if focus returns to window without a change event
    window.addEventListener('focus', () => setTimeout(() => settle({ canceled: true, filePaths: [] }), 500), { once: true })

    input.click()
  })
}

export class WebPlatform implements IPlatform {
  // ── Project ──────────────────────────────────────────────────────────────
  createProject(name: string, description?: string, client?: string):Promise<ProjectMeta|null> {
    return api('/project/create', { name, description, client })
  }
  openProject(filePath: string):Promise<ProjectMeta> {
    return api('/project/open', { filePath })
  }
  closeProject():Promise<void> { return api('/project/close') }
  updateProject(fields: Partial<{ name: string; description: string; client: string }>):Promise<ProjectMeta> {
    return api('/project/update', { fields })
  }
  getProjectMeta():Promise<ProjectMeta|null> { return api('/project/getMeta') }
  listRecentProjects():Promise<RecentProject[]> { return api('/project/listRecents') }
  removeRecentProject(filePath: string): Promise<void> { return api('/project/removeRecent', { filePath }) }
  deleteProject(): Promise<void> { return api('/project/delete') }

  // ── Objects & Fields ─────────────────────────────────────────────────────
  inferSchema(filePath: string, options?: object):Promise<{ headers: string[]; fields: InferredField[]; rows: Record<string, string>[] }> { return api('/objects/inferSchema', { filePath, options }) }
  inferSchemaFromHeaders(filePath: string, options?: object):Promise<{ headers: string[]; fields: InferredField[]; }> { return api('/objects/inferSchemaFromHeaders', { filePath, options }) }
  createObject(role: string, name: string, description?: string, systemName?: string, outputFormat?: string, templateConfig?: object): Promise<DataObject> {
    return api('/objects/create', { role, name, description, systemName, outputFormat, templateConfig })
  }
  listObjects(role?: string):Promise<DataObject[]> { return api('/objects/list', { role }) }
  getObject(id: string):Promise<{ object: DataObject; fields: ObjectField[]; }> { return api('/objects/get', { id }) }
  updateObject(id: string, updates: object): Promise<DataObject> { return api('/objects/update', { id, updates }) }
  deleteObject(id: string):Promise<void> { return api('/objects/delete', { id }) }
  importRows(id: string, filePath: string, options?: object):Promise<{ rowCount: number }> { return api('/objects/importRows', { id, filePath, options }) }
  getRows(id: string, offset: number, limit: number):Promise<{ rows: Record<string, string>[]; total: number }> { return api('/objects/getRows', { id, offset, limit }) }
  upsertFields(objectId: string, fields: unknown[]):Promise<ObjectField[]> { return api('/fields/upsert', { objectId, fields }) }

  createPicklist(side: string, name: string, description?: string):Promise<Picklist> { return api('/picklists/create', { side, name, description }) }
  listPicklists(side?: string):Promise<Picklist[]> { return api('/picklists/list', { side }) }
  getPicklist(id: string):Promise<{ picklist: Picklist; values: PicklistValue[] }> { return api('/picklists/get', { id }) }
  updatePicklist(id: string, updates: object):Promise<Picklist> { return api('/picklists/update', { id, updates }) }
  deletePicklist(id: string):Promise<void> { return api('/picklists/delete', { id }) }
  setPicklistValues(id: string, values: unknown[]):Promise<PicklistValue[]> { return api('/picklists/setValues', { id, values }) }
  importPicklistFromFile(id: string, filePath: string, keyCol: string, labelCol?: string):Promise<{ valueCount: number }> { return api('/picklists/importFromFile', { id, filePath, keyCol, labelCol }) }
  bulkImportPicklistsFromFile(filePath: string, side: string):Promise<{ results: Array<{ name: string; created: boolean; valueCount: number }>;errors: Array<{ name: string; error: string }>}> { return api('/picklists/bulkImportFromFile', { filePath, side }) }

  createPlMapping(name: string, sourcePicklistId?: string, targetPicklistId?: string):Promise<PicklistMapping> { return api('/plmappings/create', { name, sourcePicklistId, targetPicklistId }) }
  listPlMappings():Promise<PicklistMapping[]> { return api('/plmappings/list') }
  getPlMapping(id: string):Promise<{ mapping: PicklistMapping; entries: PicklistMappingEntry[] }> { return api('/plmappings/get', { id }) }
  updatePlMapping(id: string, updates: object):Promise<PicklistMapping> { return api('/plmappings/update', { id, updates }) }
  deletePlMapping(id: string):Promise<void> { return api('/plmappings/delete', { id }) }
  setPlMappingEntries(id: string, entries: unknown[]):Promise<PicklistMappingEntry[]> { return api('/plmappings/setEntries', { id, entries }) }
  importPlMappingEntriesFromFile(id: string, filePath: string, sourceKeyCol: string, targetKeyCol: string):Promise<{ entryCount: number }> { return api('/plmappings/importEntriesFromFile', { id, filePath, sourceKeyCol, targetKeyCol }) }
  bulkImportPlMappingsFromFile(filePath: string):Promise<{ results: Array<{ name: string; created: boolean; entryCount: number }>; errors: Array<{ name: string; error: string }>}> { return api('/plmappings/bulkImportFromFile', { filePath }) }

  createTransformation(name: string, description?: string):Promise<Transformation> { return api('/transformations/create', { name, description }) }
  listTransformations():Promise<Transformation[]> { return api('/transformations/list') }
  getTransformation(id: string):Promise<Transformation> { return api('/transformations/get', { id }) }
  updateTransformation(id: string, updates: object):Promise<Transformation> { return api('/transformations/update', { id, updates }) }
  saveCanvas(id: string, canvasState: string):Promise<void> { return api('/transformations/saveCanvas', { id, canvasState }) }
  deleteTransformation(id: string):Promise<void> { return api('/transformations/delete', { id }) }
  duplicateTransformation(id: string):Promise<Transformation> { return api('/transformations/duplicate', { id }) }
  createFieldMapping(transformationId: string, targetObjectId: string, targetFieldId: string, ruleType: string, ruleConfig: string, notes?: string, mapNodeId?: string):Promise<FieldMapping> {
    return api('/transformations/createFieldMapping', { transformationId, targetObjectId, targetFieldId, ruleType, ruleConfig, notes, mapNodeId })
  }
  updateFieldMapping(id: string, updates: object):Promise<FieldMapping> { return api('/transformations/updateFieldMapping', { id, updates }) }
  deleteFieldMapping(id: string):Promise<void> { return api('/transformations/deleteFieldMapping', { id }) }
  deleteFieldMappingsByTarget(transformationId: string, targetObjectId: string):Promise<void> { return api('/transformations/deleteFieldMappingsByTarget', { transformationId, targetObjectId }) }
  getFieldMappings(transformationId: string):Promise<FieldMapping[]> { return api('/transformations/getFieldMappings', { transformationId }) }
  getFieldMappingsByNode(mapNodeId: string):Promise<FieldMapping[]> { return api('/transformations/getFieldMappingsByNode', { mapNodeId }) }
  deleteFieldMappingsByNode(mapNodeId: string):Promise<void> { return api('/transformations/deleteFieldMappingsByNode', { mapNodeId }) }
  startRun(transformationId: string):Promise<string> { return api<string>('/run/start', { transformationId }) }
  cancelRun(runId: string):Promise<void> { return api('/run/cancel', { runId }) }
  getRun(runId: string):Promise<Run> { return api('/run/get', { runId }) }
  listRuns(transformationId?: string):Promise<Run[]> { return api('/run/list', { transformationId }) }
  getRunIssues(runId: string, severity?: string):Promise<RunIssue[]> { return api('/run/getIssues', { runId, severity }) }


  async saveOutput(runId: string, targetObjectId: string, _destPath: string): Promise<void> {
    // In web mode, trigger a browser download instead of a native save dialog
    const a = document.createElement('a')
    a.href = `${BASE}/run/download/${encodeURIComponent(runId)}/${encodeURIComponent(targetObjectId)}`
    a.click()
  }

  previewOutput(runId: string, targetObjectId: string, limit?: number):Promise<{ headers: string[]; rows: Record<string, string>[]; totalRows: number; }> {
    return api('/run/previewOutput', { runId, targetObjectId, limit })
  }

  onRunProgress(callback: (data: RunProgressEvent) => void): () => void {
    const es = new EventSource(`${BASE}/run/progress`, { withCredentials: true })
    es.onmessage = (e) => {
      try { callback(JSON.parse(e.data as string) as RunProgressEvent) } catch { /* ignore */ }
    }
    return () => es.close()
  }

  // ── Dialogs & shell ──────────────────────────────────────────────────────
  openFile(options: OpenFileOptions): Promise<{ canceled: boolean; filePaths: string[] }> {
    return pickAndUpload(options)
  }

  async saveFile(_options: SaveFileOptions): Promise<{ canceled: boolean; filePath?: string }> {
    // Web mode: download is handled by saveOutput() — no save dialog needed
    return { canceled: false, filePath: '' }
  }

  async openPath(_path: string): Promise<void> {
    // No-op in web mode — can't open file explorer from the browser
  }

  // ── Dev tools ────────────────────────────────────────────────────────────
  dbListTables() { return api<import('./IPlatform.js').TableInfo[]>('/devtools/tables') }
  dbQueryTable(tableName: string, page: number, pageSize: number) {
    return api<import('./IPlatform.js').TableQueryResult>('/devtools/query-table', { tableName, page, pageSize })
  }
  dbRawQuery(sql: string) {
    return api<import('./IPlatform.js').TableQueryResult>('/devtools/raw-query', { sql })
  }
  renderTransformationQuery(transformationId: string) {
    return api<import('./IPlatform.js').TransformationQuery[]>('/devtools/render-query', { transformationId })
  }
}
