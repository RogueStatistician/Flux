import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createTransformation,
  listTransformations,
  getTransformation,
  updateTransformation,
  saveCanvas,
  deleteTransformation,
  duplicateTransformation,
  createFieldMapping,
  updateFieldMapping,
  deleteFieldMapping,
  deleteFieldMappingsByTarget,
  getFieldMappings,
  getFieldMappingsByNode,
  deleteFieldMappingsByNode,
} from '../../core/services/transformations.js'
import { createObject, upsertFields } from '../../core/services/objects.js'
import { createProjectRecord } from '../../core/services/project.js'
import { openMemoryDb } from '../helpers/db.js'

describe('transformations service', () => {
  let closeDb: () => void
  let sourceId: string
  let targetId: string
  let targetFieldId: string

  beforeEach(() => {
    closeDb = openMemoryDb()
    createProjectRecord('Test')

    const src = createObject('source', 'Source')
    sourceId = src.id

    const tgt = createObject('target', 'Target')
    targetId = tgt.id
    const [field] = upsertFields(targetId, [
      { name: 'output_name', dataType: 'string', isRequired: false, isNullable: true },
    ])
    targetFieldId = field.id
  })
  afterEach(() => closeDb())

  // ── createTransformation ──────────────────────────────────────────────────

  describe('createTransformation', () => {
    it('creates a transformation', () => {
      const t = createTransformation('My Transform', 'Desc')
      expect(t.name).toBe('My Transform')
      expect(t.description).toBe('Desc')
      expect(t.id).toBeTruthy()
    })

    it('throws on duplicate name', () => {
      createTransformation('T')
      expect(() => createTransformation('T')).toThrow()
    })
  })

  // ── listTransformations ───────────────────────────────────────────────────

  describe('listTransformations', () => {
    it('returns all transformations ordered by created_at', () => {
      createTransformation('T1')
      createTransformation('T2')
      const list = listTransformations()
      expect(list).toHaveLength(2)
      expect(list.map(t => t.name)).toEqual(['T1', 'T2'])
    })
  })

  // ── getTransformation ─────────────────────────────────────────────────────

  describe('getTransformation', () => {
    it('returns the transformation by id', () => {
      const t = createTransformation('T')
      expect(getTransformation(t.id).name).toBe('T')
    })

    it('throws for unknown id', () => {
      expect(() => getTransformation('no-such-id')).toThrow()
    })
  })

  // ── updateTransformation ──────────────────────────────────────────────────

  describe('updateTransformation', () => {
    it('updates name and description', () => {
      const t = createTransformation('Old')
      const updated = updateTransformation(t.id, { name: 'New', description: 'Updated desc' })
      expect(updated.name).toBe('New')
      expect(updated.description).toBe('Updated desc')
    })

    it('throws when renaming to an existing name', () => {
      createTransformation('Existing')
      const t = createTransformation('Other')
      expect(() => updateTransformation(t.id, { name: 'Existing' })).toThrow()
    })
  })

  // ── saveCanvas ────────────────────────────────────────────────────────────

  describe('saveCanvas', () => {
    it('saves and retrieves canvas state', () => {
      const t = createTransformation('T')
      const canvasState = JSON.stringify({ nodes: [], edges: [] })
      saveCanvas(t.id, canvasState)
      const retrieved = getTransformation(t.id)
      expect(retrieved.canvasState).toBe(canvasState)
    })
  })

  // ── deleteTransformation ──────────────────────────────────────────────────

  describe('deleteTransformation', () => {
    it('removes the transformation', () => {
      const t = createTransformation('T')
      deleteTransformation(t.id)
      expect(listTransformations()).toHaveLength(0)
    })
  })

  // ── duplicateTransformation ───────────────────────────────────────────────

  describe('duplicateTransformation', () => {
    it('creates a copy with a " (copy)" suffix', () => {
      const t = createTransformation('My Transform')
      const copy = duplicateTransformation(t.id)
      expect(copy.name).toBe('My Transform (copy)')
    })

    it('increments copy number to avoid name collision', () => {
      const t = createTransformation('T')
      duplicateTransformation(t.id) // T (copy)
      const copy2 = duplicateTransformation(t.id) // T (copy 2)
      expect(copy2.name).toBe('T (copy 2)')
    })

    it('copies canvas state', () => {
      const t = createTransformation('T')
      const canvas = '{"nodes":[],"edges":[]}'
      saveCanvas(t.id, canvas)
      const copy = duplicateTransformation(t.id)
      expect(getTransformation(copy.id).canvasState).toBe(canvas)
    })

    it('copies field mappings with new IDs', () => {
      const t = createTransformation('T')
      createFieldMapping(t.id, targetId, targetFieldId, 'constant', '{"value":"x"}')
      const copy = duplicateTransformation(t.id)
      const copyMappings = getFieldMappings(copy.id)
      expect(copyMappings).toHaveLength(1)
      // Different IDs
      const origMappings = getFieldMappings(t.id)
      expect(copyMappings[0].id).not.toBe(origMappings[0].id)
    })

    it('throws when source transformation does not exist', () => {
      expect(() => duplicateTransformation('no-such-id')).toThrow()
    })
  })

  // ── field mappings ────────────────────────────────────────────────────────

  describe('createFieldMapping', () => {
    it('creates a field mapping', () => {
      const t = createTransformation('T')
      const fm = createFieldMapping(t.id, targetId, targetFieldId, 'constant', '{"value":"hello"}')
      expect(fm.ruleType).toBe('constant')
      expect(fm.ruleConfig).toBe('{"value":"hello"}')
      expect(fm.targetObjectId).toBe(targetId)
    })

    it('replaces existing mapping for same field + mapNodeId', () => {
      const t = createTransformation('T')
      createFieldMapping(t.id, targetId, targetFieldId, 'constant', '{"value":"first"}', undefined, 'node-1')
      createFieldMapping(t.id, targetId, targetFieldId, 'constant', '{"value":"second"}', undefined, 'node-1')
      const mappings = getFieldMappings(t.id)
      expect(mappings).toHaveLength(1)
      expect(JSON.parse(mappings[0].ruleConfig).value).toBe('second')
    })
  })

  describe('updateFieldMapping', () => {
    it('updates rule type and config', () => {
      const t = createTransformation('T')
      const fm = createFieldMapping(t.id, targetId, targetFieldId, 'constant', '{"value":"x"}')
      const updated = updateFieldMapping(fm.id, { ruleType: 'uuid', ruleConfig: '{}' })
      expect(updated.ruleType).toBe('uuid')
    })
  })

  describe('deleteFieldMapping', () => {
    it('removes the specified mapping', () => {
      const t = createTransformation('T')
      const fm = createFieldMapping(t.id, targetId, targetFieldId, 'constant', '{}')
      deleteFieldMapping(fm.id)
      expect(getFieldMappings(t.id)).toHaveLength(0)
    })
  })

  describe('deleteFieldMappingsByTarget', () => {
    it('removes all mappings for a given target', () => {
      const t = createTransformation('T')
      createFieldMapping(t.id, targetId, targetFieldId, 'constant', '{}')
      deleteFieldMappingsByTarget(t.id, targetId)
      expect(getFieldMappings(t.id)).toHaveLength(0)
    })
  })

  describe('getFieldMappingsByNode / deleteFieldMappingsByNode', () => {
    it('retrieves mappings by mapNodeId', () => {
      const t = createTransformation('T')
      createFieldMapping(t.id, targetId, targetFieldId, 'constant', '{}', undefined, 'node-abc')
      const byNode = getFieldMappingsByNode('node-abc')
      expect(byNode).toHaveLength(1)
      expect(byNode[0].mapNodeId).toBe('node-abc')
    })

    it('deletes all mappings for a mapNodeId', () => {
      const t = createTransformation('T')
      createFieldMapping(t.id, targetId, targetFieldId, 'constant', '{}', undefined, 'node-abc')
      deleteFieldMappingsByNode('node-abc')
      expect(getFieldMappingsByNode('node-abc')).toHaveLength(0)
    })
  })
})
