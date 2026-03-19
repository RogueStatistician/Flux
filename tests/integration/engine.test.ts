/**
 * Engine integration tests — set up a real in-memory DB, create objects +
 * field mappings, execute a transformation, and verify the output file.
 *
 * Note on the legacy source-discovery path: the engine infers the primary
 * source object from field mappings whose rule type is in
 * ['direct','concat','split','substring','dateformat','picklisttranslate','expression']
 * by reading `cfg.sourceObjectId`. For rules outside that set (constant, uuid,
 * incremental) a direct mapping with sourceObjectId must also be present so
 * the engine can iterate the source rows.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { configureEngine, executeTransformation } from '../../core/engine.js'
import { createObject, upsertFields, importRows } from '../../core/services/objects.js'
import { createTransformation, createFieldMapping } from '../../core/services/transformations.js'
import { createProjectRecord } from '../../core/services/project.js'
import { createPlMapping, setPlMappingEntries } from '../../core/services/plmappings.js'
import { getRun, getRunIssues } from '../../core/services/runs.js'
import { openMemoryDb } from '../helpers/db.js'
import { createCsv, cleanupFile, cleanupDir } from '../helpers/files.js'
import os from 'os'
import path from 'path'
import fs from 'fs'

// Typed views of the opaque run fields (stored as JSON blobs in DB)
interface RunStats { totalRowsProcessed: number; totalIssues: number; targetCount: number }
interface RunManifest { targets: Array<{ objectId: string; filePath: string; format: string; rowCount: number }> }

type TypedRun = Omit<ReturnType<typeof getRun>, 'stats' | 'outputManifest'> & {
  stats?: RunStats
  outputManifest?: RunManifest
}

// Helper: poll until the run is no longer 'running' (max 10s)
async function waitForRun(runId: string): Promise<TypedRun> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const run = getRun(runId)
    if (run.status !== 'running') return run as unknown as TypedRun
    await new Promise(r => setTimeout(r, 30))
  }
  throw new Error(`Run ${runId} did not complete within 10 seconds`)
}

describe('engine', () => {
  let closeDb: () => void
  let tempDir: string

  beforeEach(() => {
    closeDb = openMemoryDb()
    createProjectRecord('Test')
    tempDir = path.join(os.tmpdir(), `flux-engine-test-${Date.now()}`)
    fs.mkdirSync(tempDir, { recursive: true })
    configureEngine({ tempDir, sendProgress: () => {} })
  })

  afterEach(() => {
    closeDb()
    cleanupDir(tempDir)
  })

  // ── constant rule ──────────────────────────────────────────────────────────

  it('produces output with constant rule', async () => {
    const src = createObject('source', 'Source')
    upsertFields(src.id, [{ name: 'name', dataType: 'string', isRequired: false, isNullable: true }])

    const csv = createCsv('name\nAlice\nBob')
    try { await importRows(src.id, csv) } finally { cleanupFile(csv) }

    const tgt = createObject('target', 'Target', undefined, undefined, 'csv')
    const [fldName, fldType] = upsertFields(tgt.id, [
      { name: 'name', dataType: 'string', isRequired: false, isNullable: true },
      { name: 'type', dataType: 'string', isRequired: false, isNullable: true },
    ])

    const t = createTransformation('T')
    // Direct rule establishes the source for the engine
    createFieldMapping(t.id, tgt.id, fldName.id, 'direct',
      JSON.stringify({ sourceObjectId: src.id, sourceFieldName: 'name' }))
    createFieldMapping(t.id, tgt.id, fldType.id, 'constant',
      JSON.stringify({ value: 'EMPLOYEE' }))

    const runId = await executeTransformation(t.id)
    const run = await waitForRun(runId)

    expect(run.status).toBe('completed')
    expect(run.stats?.totalRowsProcessed).toBe(2)

    const outPath = run.outputManifest!.targets[0].filePath
    const content = fs.readFileSync(outPath, 'utf-8')
    expect(content).toContain('Alice')
    expect(content).toContain('EMPLOYEE')
  })

  // ── direct rule ────────────────────────────────────────────────────────────

  it('copies fields with direct rule', async () => {
    const src = createObject('source', 'Source')
    upsertFields(src.id, [
      { name: 'employee_id', dataType: 'string', isRequired: false, isNullable: true },
      { name: 'full_name', dataType: 'string', isRequired: false, isNullable: true },
    ])

    const csv = createCsv('employee_id,full_name\nE001,Alice Smith\nE002,Bob Jones')
    try { await importRows(src.id, csv) } finally { cleanupFile(csv) }

    const tgt = createObject('target', 'Target', undefined, undefined, 'csv')
    const [fldId, fldName] = upsertFields(tgt.id, [
      { name: 'id', dataType: 'string', isRequired: false, isNullable: true },
      { name: 'name', dataType: 'string', isRequired: false, isNullable: true },
    ])

    const t = createTransformation('T')
    createFieldMapping(t.id, tgt.id, fldId.id, 'direct',
      JSON.stringify({ sourceObjectId: src.id, sourceFieldName: 'employee_id' }))
    createFieldMapping(t.id, tgt.id, fldName.id, 'direct',
      JSON.stringify({ sourceObjectId: src.id, sourceFieldName: 'full_name' }))

    const runId = await executeTransformation(t.id)
    const run = await waitForRun(runId)

    expect(run.status).toBe('completed')
    expect(run.stats?.totalRowsProcessed).toBe(2)

    const outPath = run.outputManifest!.targets[0].filePath
    const content = fs.readFileSync(outPath, 'utf-8')
    expect(content).toContain('E001')
    expect(content).toContain('Alice Smith')
  })

  // ── UUID rule ──────────────────────────────────────────────────────────────

  it('assigns unique UUIDs with uuid rule', async () => {
    const src = createObject('source', 'S')
    upsertFields(src.id, [{ name: 'name', dataType: 'string', isRequired: false, isNullable: true }])
    const csv = createCsv('name\na\nb\nc')
    try { await importRows(src.id, csv) } finally { cleanupFile(csv) }

    const tgt = createObject('target', 'T', undefined, undefined, 'csv')
    const [fldName, fldUuid] = upsertFields(tgt.id, [
      { name: 'name', dataType: 'string', isRequired: false, isNullable: true },
      { name: 'uuid', dataType: 'string', isRequired: false, isNullable: true },
    ])

    const t = createTransformation('T')
    createFieldMapping(t.id, tgt.id, fldName.id, 'direct',
      JSON.stringify({ sourceObjectId: src.id, sourceFieldName: 'name' }))
    createFieldMapping(t.id, tgt.id, fldUuid.id, 'uuid', '{}')

    const runId = await executeTransformation(t.id)
    const run = await waitForRun(runId)
    expect(run.status).toBe('completed')
    expect(run.stats?.totalRowsProcessed).toBe(3)

    const outPath = run.outputManifest!.targets[0].filePath
    const lines = fs.readFileSync(outPath, 'utf-8').trim().split('\n')
    // Each UUID column value should be unique (header + 3 data rows)
    const uuids = lines.slice(1).map(l => l.split(',')[1])
    expect(new Set(uuids).size).toBe(3)
  })

  // ── incremental rule ───────────────────────────────────────────────────────

  it('generates sequential numbers with incremental rule', async () => {
    const src = createObject('source', 'S')
    upsertFields(src.id, [{ name: 'name', dataType: 'string', isRequired: false, isNullable: true }])
    const csv = createCsv('name\na\nb\nc')
    try { await importRows(src.id, csv) } finally { cleanupFile(csv) }

    const tgt = createObject('target', 'T', undefined, undefined, 'csv')
    const [fldName, fldSeq] = upsertFields(tgt.id, [
      { name: 'name', dataType: 'string', isRequired: false, isNullable: true },
      { name: 'seq', dataType: 'integer', isRequired: false, isNullable: true },
    ])

    const t = createTransformation('T')
    createFieldMapping(t.id, tgt.id, fldName.id, 'direct',
      JSON.stringify({ sourceObjectId: src.id, sourceFieldName: 'name' }))
    createFieldMapping(t.id, tgt.id, fldSeq.id, 'incremental',
      JSON.stringify({ start: 10, step: 10 }))

    const runId = await executeTransformation(t.id)
    const run = await waitForRun(runId)
    expect(run.status).toBe('completed')

    const outPath = run.outputManifest!.targets[0].filePath
    const lines = fs.readFileSync(outPath, 'utf-8').trim().split('\n')
    // seq column is second; lines[1..3] are data rows
    expect(lines[1].split(',')[1]).toBe('10')
    expect(lines[2].split(',')[1]).toBe('20')
    expect(lines[3].split(',')[1]).toBe('30')
  })

  // ── concat rule ────────────────────────────────────────────────────────────

  it('concatenates fields with concat rule', async () => {
    const src = createObject('source', 'S')
    upsertFields(src.id, [
      { name: 'first', dataType: 'string', isRequired: false, isNullable: true },
      { name: 'last', dataType: 'string', isRequired: false, isNullable: true },
    ])
    const csv = createCsv('first,last\nJohn,Doe')
    try { await importRows(src.id, csv) } finally { cleanupFile(csv) }

    const tgt = createObject('target', 'T', undefined, undefined, 'csv')
    const [fld] = upsertFields(tgt.id, [
      { name: 'full_name', dataType: 'string', isRequired: false, isNullable: true },
    ])

    const t = createTransformation('T')
    createFieldMapping(t.id, tgt.id, fld.id, 'concat', JSON.stringify({
      sourceObjectId: src.id,
      parts: [
        { type: 'field', sourceFieldName: 'first' },
        { type: 'literal', value: ' ' },
        { type: 'field', sourceFieldName: 'last' },
      ]
    }))

    const runId = await executeTransformation(t.id)
    const run = await waitForRun(runId)
    expect(run.status).toBe('completed')

    const outPath = run.outputManifest!.targets[0].filePath
    expect(fs.readFileSync(outPath, 'utf-8')).toContain('John Doe')
  })

  // ── required field warning ─────────────────────────────────────────────────

  it('emits a warning when a required field is empty after mapping', async () => {
    const src = createObject('source', 'S')
    upsertFields(src.id, [{ name: 'opt', dataType: 'string', isRequired: false, isNullable: true }])
    const csv = createCsv('opt\n')  // one row with empty value
    try { await importRows(src.id, csv) } finally { cleanupFile(csv) }

    const tgt = createObject('target', 'T', undefined, undefined, 'csv')
    const [fld] = upsertFields(tgt.id, [
      { name: 'required_field', dataType: 'string', isRequired: true, isNullable: false },
    ])

    const t = createTransformation('T')
    createFieldMapping(t.id, tgt.id, fld.id, 'direct',
      JSON.stringify({ sourceObjectId: src.id, sourceFieldName: 'opt' }))

    const runId = await executeTransformation(t.id)
    const run = await waitForRun(runId)
    expect(run.status).toBe('completed')

    const warnings = getRunIssues(runId).filter(i => i.severity === 'warning')
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0].fieldName).toBe('required_field')
  })

  // ── no field mappings — fails ──────────────────────────────────────────────

  it('fails when there are no field mappings', async () => {
    const t = createTransformation('Empty')
    const runId = await executeTransformation(t.id)
    const run = await waitForRun(runId)
    expect(run.status).toBe('failed')
  })

  // ── picklisttranslate rule ─────────────────────────────────────────────────

  it('translates values via picklisttranslate rule', async () => {
    const src = createObject('source', 'S')
    upsertFields(src.id, [{ name: 'status', dataType: 'string', isRequired: false, isNullable: true }])
    const csv = createCsv('status\nA\nI\nX')
    try { await importRows(src.id, csv) } finally { cleanupFile(csv) }

    const mapping = createPlMapping('Status Map')
    setPlMappingEntries(mapping.id, [
      { sourceKey: 'A', targetKey: 'Active' },
      { sourceKey: 'I', targetKey: 'Inactive' },
    ])

    const tgt = createObject('target', 'T', undefined, undefined, 'csv')
    const [fld] = upsertFields(tgt.id, [
      { name: 'status_label', dataType: 'string', isRequired: false, isNullable: true },
    ])

    const t = createTransformation('T')
    createFieldMapping(t.id, tgt.id, fld.id, 'picklisttranslate',
      JSON.stringify({ sourceObjectId: src.id, sourceFieldName: 'status', mappingId: mapping.id }))

    const runId = await executeTransformation(t.id)
    const run = await waitForRun(runId)
    expect(run.status).toBe('completed')

    const content = fs.readFileSync(run.outputManifest!.targets[0].filePath, 'utf-8')
    expect(content).toContain('Active')
    expect(content).toContain('Inactive')
    // Unknown key 'X' falls back to original value
    expect(content).toContain('X')
  })

  // ── multiple targets ───────────────────────────────────────────────────────

  it('processes multiple targets in one transformation', async () => {
    const src = createObject('source', 'S')
    upsertFields(src.id, [{ name: 'n', dataType: 'string', isRequired: false, isNullable: true }])
    const csv = createCsv('n\nhello')
    try { await importRows(src.id, csv) } finally { cleanupFile(csv) }

    const tgt1 = createObject('target', 'T1', undefined, undefined, 'csv')
    const [f1] = upsertFields(tgt1.id, [{ name: 'a', dataType: 'string', isRequired: false, isNullable: true }])
    const tgt2 = createObject('target', 'T2', undefined, undefined, 'csv')
    const [f2] = upsertFields(tgt2.id, [{ name: 'b', dataType: 'string', isRequired: false, isNullable: true }])

    const t = createTransformation('T')
    createFieldMapping(t.id, tgt1.id, f1.id, 'direct',
      JSON.stringify({ sourceObjectId: src.id, sourceFieldName: 'n' }))
    createFieldMapping(t.id, tgt2.id, f2.id, 'direct',
      JSON.stringify({ sourceObjectId: src.id, sourceFieldName: 'n' }))

    const runId = await executeTransformation(t.id)
    const run = await waitForRun(runId)
    expect(run.status).toBe('completed')
    expect(run.outputManifest!.targets).toHaveLength(2)
    expect(run.stats?.targetCount).toBe(2)
  })
})
