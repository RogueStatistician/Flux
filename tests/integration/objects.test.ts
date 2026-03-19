import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createObject,
  listObjects,
  getObject,
  updateObject,
  deleteObject,
  importRows,
  getRows,
  upsertFields,
} from '../../core/services/objects.js'
import { createProjectRecord } from '../../core/services/project.js'
import { openMemoryDb } from '../helpers/db.js'
import { createCsv, createXlsx, cleanupFile } from '../helpers/files.js'

describe('objects service', () => {
  let closeDb: () => void

  beforeEach(() => {
    closeDb = openMemoryDb()
    // Every test needs a project record (FK constraint)
    createProjectRecord('Test Project')
  })
  afterEach(() => closeDb())

  // ── createObject ──────────────────────────────────────────────────────────

  describe('createObject', () => {
    it('creates a source object', () => {
      const obj = createObject('source', 'Employees', 'HR export')
      expect(obj.name).toBe('Employees')
      expect(obj.role).toBe('source')
      expect(obj.id).toBeTruthy()
    })

    it('creates a target object with outputFormat', () => {
      const obj = createObject('target', 'Output', undefined, 'EMP', 'csv')
      expect(obj.outputFormat).toBe('csv')
      expect(obj.systemName).toBe('EMP')
    })

    it('defaults outputFormat to xlsx', () => {
      const obj = createObject('target', 'T')
      expect(obj.outputFormat).toBe('xlsx')
    })

    it('throws on duplicate name within same role', () => {
      createObject('source', 'HR')
      expect(() => createObject('source', 'HR')).toThrow()
    })

    it('allows same name for different roles', () => {
      createObject('source', 'Data')
      expect(() => createObject('target', 'Data')).not.toThrow()
    })
  })

  // ── listObjects ───────────────────────────────────────────────────────────

  describe('listObjects', () => {
    it('returns all objects when no role filter', () => {
      createObject('source', 'S1')
      createObject('target', 'T1')
      expect(listObjects()).toHaveLength(2)
    })

    it('filters by role', () => {
      createObject('source', 'S1')
      createObject('source', 'S2')
      createObject('target', 'T1')
      expect(listObjects('source')).toHaveLength(2)
      expect(listObjects('target')).toHaveLength(1)
    })

    it('returns empty array when no objects exist', () => {
      expect(listObjects()).toHaveLength(0)
    })
  })

  // ── getObject ─────────────────────────────────────────────────────────────

  describe('getObject', () => {
    it('returns the object with its fields', () => {
      const obj = createObject('source', 'Employees')
      const result = getObject(obj.id)
      expect(result.object.name).toBe('Employees')
      expect(result.fields).toEqual([])
    })

    it('throws when object does not exist', () => {
      expect(() => getObject('nonexistent-id')).toThrow()
    })
  })

  // ── updateObject ──────────────────────────────────────────────────────────

  describe('updateObject', () => {
    it('updates the name of an object', () => {
      const obj = createObject('source', 'Old Name')
      const updated = updateObject(obj.id, { name: 'New Name' })
      expect(updated.name).toBe('New Name')
    })

    it('updates description and systemName', () => {
      const obj = createObject('source', 'S')
      const updated = updateObject(obj.id, { description: 'Desc', systemName: 'SYS' })
      expect(updated.description).toBe('Desc')
      expect(updated.systemName).toBe('SYS')
    })

    it('throws when renaming to a name that already exists in same role', () => {
      createObject('source', 'Existing')
      const obj = createObject('source', 'Other')
      expect(() => updateObject(obj.id, { name: 'Existing' })).toThrow()
    })
  })

  // ── deleteObject ──────────────────────────────────────────────────────────

  describe('deleteObject', () => {
    it('removes the object', () => {
      const obj = createObject('source', 'ToDelete')
      deleteObject(obj.id)
      expect(listObjects()).toHaveLength(0)
    })

    it('throws when getting a deleted object', () => {
      const obj = createObject('source', 'ToDelete')
      deleteObject(obj.id)
      expect(() => getObject(obj.id)).toThrow()
    })
  })

  // ── upsertFields ──────────────────────────────────────────────────────────

  describe('upsertFields', () => {
    it('inserts fields for an object', () => {
      const obj = createObject('source', 'S')
      const fields = upsertFields(obj.id, [
        { name: 'id', dataType: 'integer', isRequired: true, isNullable: false },
        { name: 'name', dataType: 'string', isRequired: false, isNullable: true },
      ])
      expect(fields).toHaveLength(2)
      expect(fields[0].name).toBe('id')
      expect(fields[0].position).toBe(0)
      expect(fields[1].position).toBe(1)
    })

    it('preserves field IDs when upserting with same names (FK safety)', () => {
      const obj = createObject('source', 'S')
      const [f1] = upsertFields(obj.id, [{ name: 'x', dataType: 'string', isRequired: false, isNullable: true }])
      const [f2] = upsertFields(obj.id, [{ name: 'x', dataType: 'integer', isRequired: true, isNullable: false }])
      expect(f2.id).toBe(f1.id)
      expect(f2.dataType).toBe('integer')
    })

    it('removes fields not in the new list', () => {
      const obj = createObject('source', 'S')
      upsertFields(obj.id, [
        { name: 'a', dataType: 'string', isRequired: false, isNullable: true },
        { name: 'b', dataType: 'string', isRequired: false, isNullable: true },
      ])
      const remaining = upsertFields(obj.id, [{ name: 'a', dataType: 'string', isRequired: false, isNullable: true }])
      expect(remaining).toHaveLength(1)
      expect(remaining[0].name).toBe('a')
    })

    it('returns empty array when called with no fields', () => {
      const obj = createObject('source', 'S')
      expect(upsertFields(obj.id, [])).toEqual([])
    })
  })

  // ── importRows / getRows ──────────────────────────────────────────────────

  describe('importRows and getRows', () => {
    it('imports rows from a CSV and retrieves them', async () => {
      const obj = createObject('source', 'People')
      upsertFields(obj.id, [
        { name: 'name', dataType: 'string', isRequired: false, isNullable: true },
        { name: 'age', dataType: 'integer', isRequired: false, isNullable: true },
      ])

      const csvFile = createCsv('name,age\nAlice,30\nBob,25\nCarol,35')
      try {
        const { rowCount } = await importRows(obj.id, csvFile)
        expect(rowCount).toBe(3)

        const { rows, total } = getRows(obj.id, 0, 10)
        expect(total).toBe(3)
        expect(rows[0].name).toBe('Alice')
        expect(rows[1].name).toBe('Bob')
      } finally {
        cleanupFile(csvFile)
      }
    })

    it('replaces existing rows on re-import', async () => {
      const obj = createObject('source', 'Data')
      upsertFields(obj.id, [{ name: 'x', dataType: 'string', isRequired: false, isNullable: true }])

      const csv1 = createCsv('x\n1\n2\n3')
      const csv2 = createCsv('x\n10\n20')
      try {
        await importRows(obj.id, csv1)
        await importRows(obj.id, csv2)
        const { total } = getRows(obj.id, 0, 100)
        expect(total).toBe(2)
      } finally {
        cleanupFile(csv1)
        cleanupFile(csv2)
      }
    })

    it('paginates rows correctly', async () => {
      const obj = createObject('source', 'D')
      upsertFields(obj.id, [{ name: 'n', dataType: 'string', isRequired: false, isNullable: true }])
      const csv = createCsv('n\n' + Array.from({ length: 10 }, (_, i) => i).join('\n'))
      try {
        await importRows(obj.id, csv)
        const page1 = getRows(obj.id, 0, 4)
        const page2 = getRows(obj.id, 4, 4)
        expect(page1.rows).toHaveLength(4)
        expect(page2.rows).toHaveLength(4)
        expect(page1.total).toBe(10)
      } finally {
        cleanupFile(csv)
      }
    })

    it('imports rows from an XLSX file', async () => {
      const obj = createObject('source', 'XL')
      upsertFields(obj.id, [
        { name: 'name', dataType: 'string', isRequired: false, isNullable: true },
      ])
      const xlFile = await createXlsx([['name'], ['Alice'], ['Bob']])
      try {
        const { rowCount } = await importRows(obj.id, xlFile)
        expect(rowCount).toBe(2)
      } finally {
        cleanupFile(xlFile)
      }
    })
  })
})
