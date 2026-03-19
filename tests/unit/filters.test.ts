import { describe, it, expect } from 'vitest'
import { evalCondOp, evaluateFilterCondition } from '../../core/engine.js'

// ── evalCondOp ─────────────────────────────────────────────────────────────

describe('evalCondOp', () => {
  describe('= and !=', () => {
    it('= returns true for equal strings', () => expect(evalCondOp('=', 'A', 'A')).toBe(true))
    it('= returns false for unequal strings', () => expect(evalCondOp('=', 'A', 'B')).toBe(false))
    it('!= returns true for unequal strings', () => expect(evalCondOp('!=', 'A', 'B')).toBe(true))
    it('!= returns false for equal strings', () => expect(evalCondOp('!=', 'A', 'A')).toBe(false))
  })

  describe('numeric comparisons', () => {
    it('> returns true when cell is numerically greater', () => expect(evalCondOp('>', '10', '5')).toBe(true))
    it('> returns false when cell is numerically less', () => expect(evalCondOp('>', '5', '10')).toBe(false))
    it('< returns true when cell is numerically less', () => expect(evalCondOp('<', '3', '7')).toBe(true))
    it('>= returns true for equal numbers', () => expect(evalCondOp('>=', '5', '5')).toBe(true))
    it('<= returns true for equal numbers', () => expect(evalCondOp('<=', '5', '5')).toBe(true))
    it('falls back to string comparison when values are not numeric', () => {
      // 'b' > 'a' alphabetically
      expect(evalCondOp('>', 'b', 'a')).toBe(true)
      expect(evalCondOp('<', 'a', 'b')).toBe(true)
    })
  })

  describe('string operators', () => {
    it('contains returns true when cell includes value', () => expect(evalCondOp('contains', 'hello world', 'world')).toBe(true))
    it('contains returns false when not included', () => expect(evalCondOp('contains', 'hello', 'xyz')).toBe(false))
    it('not_contains returns true when value absent', () => expect(evalCondOp('not_contains', 'hello', 'xyz')).toBe(true))
    it('starts_with returns true for prefix match', () => expect(evalCondOp('starts_with', 'hello world', 'hello')).toBe(true))
    it('starts_with returns false for non-prefix', () => expect(evalCondOp('starts_with', 'hello', 'world')).toBe(false))
    it('ends_with returns true for suffix match', () => expect(evalCondOp('ends_with', 'hello world', 'world')).toBe(true))
  })

  describe('empty/non-empty checks', () => {
    it('is_empty returns true for empty string', () => expect(evalCondOp('is_empty', '', '')).toBe(true))
    it('is_empty returns false for non-empty string', () => expect(evalCondOp('is_empty', 'hello', '')).toBe(false))
    it('is_not_empty returns true for non-empty string', () => expect(evalCondOp('is_not_empty', 'x', '')).toBe(true))
    it('is_not_empty returns false for empty string', () => expect(evalCondOp('is_not_empty', '', '')).toBe(false))
  })

  describe('unknown operator', () => {
    it('returns false for unknown op', () => expect(evalCondOp('unknown_op', 'x', 'y')).toBe(false))
  })
})

// ── evaluateFilterCondition ────────────────────────────────────────────────

describe('evaluateFilterCondition', () => {
  const row = { status: 'A', score: '85', city: 'London' }

  it('evaluates a simple field equality condition', () => {
    expect(evaluateFilterCondition({ field: 'status', op: '=', value: 'A' }, row)).toBe(true)
    expect(evaluateFilterCondition({ field: 'status', op: '=', value: 'B' }, row)).toBe(false)
  })

  it('strips objectId prefix from encoded field name', () => {
    // field = "someObj::status" — should extract "status"
    expect(evaluateFilterCondition({ field: 'obj123::status', op: '=', value: 'A' }, row)).toBe(true)
  })

  it('returns false when field is missing from row (empty string vs value)', () => {
    expect(evaluateFilterCondition({ field: 'missing', op: '=', value: 'X' }, row)).toBe(false)
  })

  it('treats missing field as empty for is_empty check', () => {
    expect(evaluateFilterCondition({ field: 'missing', op: 'is_empty', value: '' }, row)).toBe(true)
  })

  it('evaluates numeric comparison', () => {
    expect(evaluateFilterCondition({ field: 'score', op: '>', value: '80' }, row)).toBe(true)
    expect(evaluateFilterCondition({ field: 'score', op: '<', value: '80' }, row)).toBe(false)
  })

  it('evaluates contains', () => {
    expect(evaluateFilterCondition({ field: 'city', op: 'contains', value: 'ond' }, row)).toBe(true)
    expect(evaluateFilterCondition({ field: 'city', op: 'contains', value: 'Paris' }, row)).toBe(false)
  })
})
