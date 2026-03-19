import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createPicklist,
  listPicklists,
  getPicklist,
  updatePicklist,
  deletePicklist,
  setPicklistValues,
  importPicklistFromFile,
  bulkImportPicklistsFromFile,
} from '../../core/services/picklists.js'
import {
  createPlMapping,
  listPlMappings,
  getPlMapping,
  updatePlMapping,
  deletePlMapping,
  setPlMappingEntries,
  importPlMappingEntriesFromFile,
  bulkImportPlMappingsFromFile,
} from '../../core/services/plmappings.js'
import { createProjectRecord } from '../../core/services/project.js'
import { openMemoryDb } from '../helpers/db.js'
import { createCsv, createMultiSheetXlsx, cleanupFile } from '../helpers/files.js'

describe('picklists service', () => {
  let closeDb: () => void

  beforeEach(() => {
    closeDb = openMemoryDb()
    createProjectRecord('Test')
  })
  afterEach(() => closeDb())

  describe('createPicklist / listPicklists', () => {
    it('creates a picklist and lists it', () => {
      const pl = createPicklist('source', 'Status', 'HR statuses')
      expect(pl.name).toBe('Status')
      expect(pl.side).toBe('source')
      expect(listPicklists()).toHaveLength(1)
    })

    it('filters by side', () => {
      createPicklist('source', 'A')
      createPicklist('target', 'B')
      expect(listPicklists('source')).toHaveLength(1)
      expect(listPicklists('target')).toHaveLength(1)
      expect(listPicklists()).toHaveLength(2)
    })
  })

  describe('getPicklist', () => {
    it('returns picklist with its values', () => {
      const pl = createPicklist('source', 'S')
      setPicklistValues(pl.id, [{ key: 'A', label: 'Active' }, { key: 'I', label: 'Inactive' }])
      const { picklist, values } = getPicklist(pl.id)
      expect(picklist.name).toBe('S')
      expect(values).toHaveLength(2)
      expect(values[0].key).toBe('A')
      expect(values[0].label).toBe('Active')
    })

    it('throws for unknown picklist id', () => {
      expect(() => getPicklist('no-such-id')).toThrow()
    })
  })

  describe('updatePicklist', () => {
    it('updates name and description', () => {
      const pl = createPicklist('source', 'Old')
      const updated = updatePicklist(pl.id, { name: 'New', description: 'Desc' })
      expect(updated.name).toBe('New')
      expect(updated.description).toBe('Desc')
    })
  })

  describe('deletePicklist', () => {
    it('removes the picklist and its values', () => {
      const pl = createPicklist('source', 'S')
      setPicklistValues(pl.id, [{ key: 'A' }])
      deletePicklist(pl.id)
      expect(listPicklists()).toHaveLength(0)
    })
  })

  describe('setPicklistValues', () => {
    it('replaces all values', () => {
      const pl = createPicklist('source', 'S')
      setPicklistValues(pl.id, [{ key: 'A', label: 'Alpha' }, { key: 'B', label: 'Beta' }])
      setPicklistValues(pl.id, [{ key: 'X', label: 'Xray' }])
      const { values } = getPicklist(pl.id)
      expect(values).toHaveLength(1)
      expect(values[0].key).toBe('X')
    })

    it('assigns sequential positions', () => {
      const pl = createPicklist('source', 'S')
      setPicklistValues(pl.id, [{ key: 'A' }, { key: 'B' }, { key: 'C' }])
      const { values } = getPicklist(pl.id)
      expect(values.map(v => v.position)).toEqual([0, 1, 2])
    })

    it('accepts values without labels (undefined label)', () => {
      const pl = createPicklist('source', 'S')
      setPicklistValues(pl.id, [{ key: 'A' }])
      const { values } = getPicklist(pl.id)
      // The service maps null DB values to undefined
      expect(values[0].label).toBeUndefined()
    })
  })

  describe('importPicklistFromFile', () => {
    let tempFile: string | null = null
    afterEach(() => { if (tempFile) { cleanupFile(tempFile); tempFile = null } })

    it('imports values from a CSV', async () => {
      const pl = createPicklist('source', 'S')
      tempFile = createCsv('code,name\nA,Active\nI,Inactive')
      const { valueCount } = await importPicklistFromFile(pl.id, tempFile, 'code', 'name')
      expect(valueCount).toBe(2)
      const { values } = getPicklist(pl.id)
      expect(values[0].key).toBe('A')
      expect(values[0].label).toBe('Active')
    })

    it('skips rows with empty keys', async () => {
      const pl = createPicklist('source', 'S')
      tempFile = createCsv('key,label\nA,Alpha\n,Empty key\nB,Beta')
      const { valueCount } = await importPicklistFromFile(pl.id, tempFile, 'key', 'label')
      expect(valueCount).toBe(2)
    })

    it('imports without label column (undefined label)', async () => {
      const pl = createPicklist('source', 'S')
      tempFile = createCsv('code\nA\nB')
      const { valueCount } = await importPicklistFromFile(pl.id, tempFile, 'code')
      expect(valueCount).toBe(2)
      const { values } = getPicklist(pl.id)
      // The service maps null DB values to undefined
      expect(values[0].label).toBeUndefined()
    })
  })

  describe('bulkImportPicklistsFromFile', () => {
    let tempFile: string | null = null
    afterEach(() => { if (tempFile) { cleanupFile(tempFile); tempFile = null } })

    it('creates one picklist per sheet', async () => {
      tempFile = await createMultiSheetXlsx({
        Status: [['key', 'label'], ['A', 'Active'], ['I', 'Inactive']],
        Region: [['key', 'label'], ['EU', 'Europe'], ['NA', 'North America']],
      })
      const result = await bulkImportPicklistsFromFile(tempFile, 'source')
      expect(result.errors).toHaveLength(0)
      expect(result.results).toHaveLength(2)
      expect(result.results[0].name).toBe('Status')
      expect(result.results[0].valueCount).toBe(2)
      expect(listPicklists('source')).toHaveLength(2)
    })

    it('reports error for sheet with no "key" column', async () => {
      tempFile = await createMultiSheetXlsx({
        Bad: [['code', 'label'], ['A', 'Alpha']],
      })
      const result = await bulkImportPicklistsFromFile(tempFile, 'source')
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].name).toBe('Bad')
    })
  })
})

// ── plmappings service ────────────────────────────────────────────────────

describe('plmappings service', () => {
  let closeDb: () => void

  beforeEach(() => {
    closeDb = openMemoryDb()
    createProjectRecord('Test')
  })
  afterEach(() => closeDb())

  describe('createPlMapping / listPlMappings', () => {
    it('creates a mapping and lists it', () => {
      const m = createPlMapping('Status Map')
      expect(m.name).toBe('Status Map')
      expect(listPlMappings()).toHaveLength(1)
    })
  })

  describe('getPlMapping', () => {
    it('returns the mapping with entries', () => {
      const m = createPlMapping('M')
      setPlMappingEntries(m.id, [{ sourceKey: 'A', targetKey: 'Active' }])
      const { mapping, entries } = getPlMapping(m.id)
      expect(mapping.name).toBe('M')
      expect(entries).toHaveLength(1)
      expect(entries[0].sourceKey).toBe('A')
      expect(entries[0].targetKey).toBe('Active')
    })

    it('throws for unknown id', () => {
      expect(() => getPlMapping('no-such-id')).toThrow()
    })
  })

  describe('updatePlMapping', () => {
    it('updates name', () => {
      const m = createPlMapping('Old')
      const updated = updatePlMapping(m.id, { name: 'New' })
      expect(updated.name).toBe('New')
    })
  })

  describe('deletePlMapping', () => {
    it('removes mapping and cascades entries', () => {
      const m = createPlMapping('M')
      setPlMappingEntries(m.id, [{ sourceKey: 'A', targetKey: 'B' }])
      deletePlMapping(m.id)
      expect(listPlMappings()).toHaveLength(0)
    })
  })

  describe('setPlMappingEntries', () => {
    it('replaces all entries', () => {
      const m = createPlMapping('M')
      setPlMappingEntries(m.id, [{ sourceKey: 'A', targetKey: 'Z' }])
      setPlMappingEntries(m.id, [{ sourceKey: 'B', targetKey: 'Y' }, { sourceKey: 'C', targetKey: 'X' }])
      const { entries } = getPlMapping(m.id)
      expect(entries).toHaveLength(2)
      expect(entries[0].sourceKey).toBe('B')
    })
  })

  describe('importPlMappingEntriesFromFile', () => {
    let tempFile: string | null = null
    afterEach(() => { if (tempFile) { cleanupFile(tempFile); tempFile = null } })

    it('imports entries from a CSV', async () => {
      const m = createPlMapping('M')
      tempFile = createCsv('source_key,target_key\nA,Active\nI,Inactive')
      const { entryCount } = await importPlMappingEntriesFromFile(m.id, tempFile, 'source_key', 'target_key')
      expect(entryCount).toBe(2)
    })

    it('skips rows with empty source or target keys', async () => {
      const m = createPlMapping('M')
      tempFile = createCsv('source_key,target_key\nA,Active\n,Missing\nI,')
      const { entryCount } = await importPlMappingEntriesFromFile(m.id, tempFile, 'source_key', 'target_key')
      expect(entryCount).toBe(1)
    })
  })

  describe('bulkImportPlMappingsFromFile', () => {
    let tempFile: string | null = null
    afterEach(() => { if (tempFile) { cleanupFile(tempFile); tempFile = null } })

    it('creates one mapping per sheet', async () => {
      tempFile = await createMultiSheetXlsx({
        'Status Map': [['source_key', 'target_key'], ['A', 'Active'], ['I', 'Inactive']],
        'Region Map': [['source_key', 'target_key'], ['EU', 'Europe']],
      })
      const result = await bulkImportPlMappingsFromFile(tempFile)
      expect(result.errors).toHaveLength(0)
      expect(result.results).toHaveLength(2)
      expect(result.results[0].entryCount).toBe(2)
      expect(listPlMappings()).toHaveLength(2)
    })

    it('reports error for sheet missing required columns', async () => {
      tempFile = await createMultiSheetXlsx({
        Bad: [['wrong_col', 'another_col'], ['x', 'y']],
      })
      const result = await bulkImportPlMappingsFromFile(tempFile)
      expect(result.errors).toHaveLength(1)
    })
  })
})
