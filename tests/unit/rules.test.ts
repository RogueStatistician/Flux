import { describe, it, expect } from 'vitest'
import {
  applyDirect,
  applyConstant,
  applyUUID,
  applyConcat,
  applySplit,
  applySubstring,
  applyDateFormat,
  applyPicklistTranslate,
  applyExpression,
  applyIncremental,
  applyConditional,
} from '../../core/engine.js'

// ── applyDirect ────────────────────────────────────────────────────────────

describe('applyDirect', () => {
  it('returns the value of the named field', () => {
    expect(applyDirect({ sourceFieldName: 'name' }, { name: 'Alice' })).toBe('Alice')
  })
  it('returns empty string when field is missing', () => {
    expect(applyDirect({ sourceFieldName: 'missing' }, { name: 'Alice' })).toBe('')
  })
  it('returns empty string on empty row', () => {
    expect(applyDirect({ sourceFieldName: 'x' }, {})).toBe('')
  })
})

// ── applyConstant ──────────────────────────────────────────────────────────

describe('applyConstant', () => {
  it('returns the configured constant value', () => {
    expect(applyConstant({ value: 'ACTIVE' })).toBe('ACTIVE')
  })
  it('returns empty string when value is empty', () => {
    expect(applyConstant({ value: '' })).toBe('')
  })
})

// ── applyUUID ──────────────────────────────────────────────────────────────

describe('applyUUID', () => {
  it('returns a valid UUID v4 string', () => {
    const uuid = applyUUID()
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
  it('returns a different UUID each call', () => {
    expect(applyUUID()).not.toBe(applyUUID())
  })
})

// ── applyConcat ────────────────────────────────────────────────────────────

describe('applyConcat', () => {
  const row = { first: 'John', last: 'Doe' }

  it('concatenates field and literal parts', () => {
    expect(applyConcat({
      parts: [
        { type: 'field', sourceFieldName: 'first' },
        { type: 'literal', value: ' ' },
        { type: 'field', sourceFieldName: 'last' },
      ]
    }, row)).toBe('John Doe')
  })
  it('handles missing field gracefully', () => {
    expect(applyConcat({
      parts: [{ type: 'field', sourceFieldName: 'missing' }, { type: 'literal', value: '!' }]
    }, row)).toBe('!')
  })
  it('returns empty string when parts is empty', () => {
    expect(applyConcat({ parts: [] }, row)).toBe('')
  })
  it('returns empty string when parts is undefined', () => {
    expect(applyConcat({}, row)).toBe('')
  })
  it('handles literal-only concat', () => {
    expect(applyConcat({ parts: [{ type: 'literal', value: 'hello' }] }, row)).toBe('hello')
  })
})

// ── applySplit ─────────────────────────────────────────────────────────────

describe('applySplit', () => {
  it('splits on space by default and returns first part', () => {
    expect(applySplit({ sourceFieldName: 'name' }, { name: 'John Doe Smith' })).toBe('John')
  })
  it('returns the part at the specified index', () => {
    expect(applySplit({ sourceFieldName: 'name', index: 1 }, { name: 'John Doe Smith' })).toBe('Doe')
  })
  it('uses the specified delimiter', () => {
    expect(applySplit({ sourceFieldName: 'val', delimiter: ',', index: 2 }, { val: 'a,b,c' })).toBe('c')
  })
  it('splits on + and returns second part', () => {
    expect(applySplit({ sourceFieldName: 'val', delimiter: '+', index: 1 }, { val: '+39123456789' })).toBe('39123456789')
  })
  it('treats empty string delimiter as default space', () => {
    expect(applySplit({ sourceFieldName: 'val', delimiter: '', index: 0 }, { val: 'hello world' })).toBe('hello')
  })
  it('returns empty string when index is out of range', () => {
    expect(applySplit({ sourceFieldName: 'val', index: 5 }, { val: 'a b' })).toBe('')
  })
  it('returns empty string when source field is missing', () => {
    expect(applySplit({ sourceFieldName: 'missing' }, {})).toBe('')
  })
})

// ── applySubstring ─────────────────────────────────────────────────────────

describe('applySubstring', () => {
  it('extracts from start to end of string', () => {
    expect(applySubstring({ sourceFieldName: 'val', start: 2 }, { val: 'abcdef' })).toBe('cdef')
  })
  it('extracts a fixed length', () => {
    expect(applySubstring({ sourceFieldName: 'val', start: 1, length: 3 }, { val: 'abcdef' })).toBe('bcd')
  })
  it('defaults start to 0', () => {
    expect(applySubstring({ sourceFieldName: 'val', length: 3 }, { val: 'abcdef' })).toBe('abc')
  })
  it('returns full string when no start/length', () => {
    expect(applySubstring({ sourceFieldName: 'val' }, { val: 'hello' })).toBe('hello')
  })
  it('returns empty string when field is missing', () => {
    expect(applySubstring({ sourceFieldName: 'missing', start: 0, length: 3 }, {})).toBe('')
  })
  it('handles length beyond string end', () => {
    expect(applySubstring({ sourceFieldName: 'val', start: 3, length: 100 }, { val: 'hello' })).toBe('lo')
  })
})

// ── applyDateFormat ────────────────────────────────────────────────────────

describe('applyDateFormat', () => {
  it('formats an ISO date to YYYY-MM-DD (default)', () => {
    const result = applyDateFormat({ sourceFieldName: 'dt' }, { dt: '2024-03-15' })
    expect(result).toBe('2024-03-15')
  })
  it('reformats to DD/MM/YYYY', () => {
    const result = applyDateFormat({ sourceFieldName: 'dt', outputFormat: 'DD/MM/YYYY' }, { dt: '2024-03-15' })
    expect(result).toBe('15/03/2024')
  })
  it('reformats to MM/DD/YYYY', () => {
    const result = applyDateFormat({ sourceFieldName: 'dt', outputFormat: 'MM/DD/YYYY' }, { dt: '2024-03-15' })
    expect(result).toBe('03/15/2024')
  })
  it('returns empty string when field is empty', () => {
    expect(applyDateFormat({ sourceFieldName: 'dt' }, { dt: '' })).toBe('')
  })
  it('returns the original value when date is unparseable', () => {
    expect(applyDateFormat({ sourceFieldName: 'dt' }, { dt: 'not-a-date' })).toBe('not-a-date')
  })
  it('returns empty string when field is missing', () => {
    expect(applyDateFormat({ sourceFieldName: 'missing' }, {})).toBe('')
  })
})

// ── applyPicklistTranslate ─────────────────────────────────────────────────

describe('applyPicklistTranslate', () => {
  const maps = new Map([
    ['map1', new Map([['A', 'Active'], ['I', 'Inactive']])],
  ])

  it('translates a known key', () => {
    expect(applyPicklistTranslate({ sourceFieldName: 'status', mappingId: 'map1' }, { status: 'A' }, maps)).toBe('Active')
  })
  it('falls back to original value when key is not found and no fallback', () => {
    expect(applyPicklistTranslate({ sourceFieldName: 'status', mappingId: 'map1' }, { status: 'X' }, maps)).toBe('X')
  })
  it('uses configured fallback when key is not found', () => {
    expect(applyPicklistTranslate(
      { sourceFieldName: 'status', mappingId: 'map1', fallback: 'UNKNOWN' },
      { status: 'X' }, maps
    )).toBe('UNKNOWN')
  })
  it('returns original value when no mappingId', () => {
    expect(applyPicklistTranslate({ sourceFieldName: 'status' }, { status: 'A' }, maps)).toBe('A')
  })
  it('returns empty string when field is missing', () => {
    expect(applyPicklistTranslate({ sourceFieldName: 'missing', mappingId: 'map1' }, {}, maps)).toBe('')
  })
})

// ── applyExpression ────────────────────────────────────────────────────────

describe('applyExpression', () => {
  it('evaluates a simple expression using row data', () => {
    expect(applyExpression({ expression: 'row.price * 2' }, { price: '10' }, 0)).toBe('20')
  })
  it('uses rowIndex in expression', () => {
    expect(applyExpression({ expression: 'rowIndex + 1' }, {}, 4)).toBe('5')
  })
  it('returns empty string on expression error', () => {
    expect(applyExpression({ expression: 'throw new Error("oops")' }, {}, 0)).toBe('')
  })
  it('returns empty string on syntax error', () => {
    expect(applyExpression({ expression: '((( broken' }, {}, 0)).toBe('')
  })
  it('converts result to string', () => {
    expect(applyExpression({ expression: '42' }, {}, 0)).toBe('42')
  })
  it('returns empty string for null result', () => {
    expect(applyExpression({ expression: 'null' }, {}, 0)).toBe('')
  })
  it('supports string manipulation', () => {
    expect(applyExpression({ expression: 'row.name.toUpperCase()' }, { name: 'alice' }, 0)).toBe('ALICE')
  })
})

// ── applyIncremental ───────────────────────────────────────────────────────

describe('applyIncremental', () => {
  it('starts at 1 and increments by 1 by default', () => {
    expect(applyIncremental({}, 0)).toBe('1')
    expect(applyIncremental({}, 1)).toBe('2')
    expect(applyIncremental({}, 9)).toBe('10')
  })
  it('uses configured start value', () => {
    expect(applyIncremental({ start: 100 }, 0)).toBe('100')
    expect(applyIncremental({ start: 100 }, 1)).toBe('101')
  })
  it('uses configured step', () => {
    expect(applyIncremental({ start: 0, step: 10 }, 3)).toBe('30')
  })
  it('supports negative step', () => {
    expect(applyIncremental({ start: 100, step: -5 }, 2)).toBe('90')
  })
})

// ── applyConditional ───────────────────────────────────────────────────────

describe('applyConditional', () => {
  const row = { status: 'A', score: '90', name: 'Alice' }

  it('returns the output of the first matching branch', () => {
    const result = applyConditional({
      branches: [
        { field: 'obj::status', op: '=', value: 'A', outputType: 'literal', outputValue: 'Active' },
        { field: 'obj::status', op: '=', value: 'I', outputType: 'literal', outputValue: 'Inactive' },
      ]
    }, row)
    expect(result).toBe('Active')
  })
  it('returns the else value when no branch matches', () => {
    expect(applyConditional({
      branches: [{ field: 'status', op: '=', value: 'X', outputType: 'literal', outputValue: 'X-value' }],
      elseOutputType: 'literal',
      elseOutputValue: 'Other',
    }, row)).toBe('Other')
  })
  it('returns empty string when no branches and no else', () => {
    expect(applyConditional({ branches: [] }, row)).toBe('')
  })
  it('returns field value when outputType is field', () => {
    expect(applyConditional({
      branches: [{ field: 'status', op: '=', value: 'A', outputType: 'field', outputValue: 'obj::name' }]
    }, row)).toBe('Alice')
  })
  it('supports numeric comparison (>)', () => {
    expect(applyConditional({
      branches: [{ field: 'score', op: '>', value: '80', outputType: 'literal', outputValue: 'Pass' }]
    }, row)).toBe('Pass')
  })
  it('returns else field value when no branch matches', () => {
    expect(applyConditional({
      branches: [],
      elseOutputType: 'field',
      elseOutputValue: 'name',
    }, row)).toBe('Alice')
  })
  it('strips objectId prefix from field encoding', () => {
    // field = "someObjectId::fieldName" — should look up "fieldName" in the row
    expect(applyConditional({
      branches: [{ field: 'someObj::status', op: '=', value: 'A', outputType: 'literal', outputValue: 'ok' }]
    }, row)).toBe('ok')
  })
})
