import { describe, it, expect, afterEach } from 'vitest'
import { inferSchema, parseFile, parseHeaders, parseAllSheets } from '../../core/importer.js'
import { createXlsx, createCsv, createMultiSheetXlsx, cleanupFile } from '../helpers/files.js'

// ── inferSchema ────────────────────────────────────────────────────────────

describe('inferSchema', () => {
  it('infers string type for text values', () => {
    const fields = inferSchema(['name'], [{ name: 'Alice' }, { name: 'Bob' }])
    expect(fields[0].dataType).toBe('string')
    expect(fields[0].name).toBe('name')
    expect(fields[0].isRequired).toBe(false)
    expect(fields[0].isNullable).toBe(true)
  })

  it('infers integer type when all non-empty values are integers', () => {
    const rows = [{ n: '1' }, { n: '2' }, { n: '300' }, { n: '-5' }]
    expect(inferSchema(['n'], rows)[0].dataType).toBe('integer')
  })

  it('infers float type for decimal numbers', () => {
    const rows = [{ n: '1.5' }, { n: '2.0' }, { n: '-3.14' }]
    expect(inferSchema(['n'], rows)[0].dataType).toBe('float')
  })

  it('infers date type for YYYY-MM-DD format', () => {
    const rows = [{ d: '2024-01-01' }, { d: '2023-12-31' }]
    const field = inferSchema(['d'], rows)[0]
    expect(field.dataType).toBe('date')
    expect(field.dateFormat).toBe('YYYY-MM-DD')
  })

  it('infers date type for DD/MM/YYYY format', () => {
    const rows = [{ d: '01/03/2024' }, { d: '15/07/2023' }]
    const field = inferSchema(['d'], rows)[0]
    expect(field.dataType).toBe('date')
    expect(field.dateFormat).toBe('DD/MM/YYYY')
  })

  it('infers datetime type for ISO8601 format', () => {
    const rows = [{ d: '2024-01-01T10:00:00Z' }, { d: '2024-06-15T08:30:00Z' }]
    const field = inferSchema(['d'], rows)[0]
    expect(field.dataType).toBe('datetime')
    expect(field.dateFormat).toBe('ISO8601')
  })

  it('infers picklist when distinct count ≤ 50 and cardinality < 5%', () => {
    // 3 distinct non-numeric values out of 100 rows = 3% cardinality → picklist
    const labels = ['Active', 'Inactive', 'Pending']
    const rows = Array.from({ length: 100 }, (_, i) => ({ s: labels[i % 3] }))
    expect(inferSchema(['s'], rows)[0].dataType).toBe('picklist')
  })

  it('does not infer picklist when cardinality ≥ 5%', () => {
    // 5 distinct non-numeric values out of 60 rows = 8.3% cardinality → string
    const labels = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']
    const rows = Array.from({ length: 60 }, (_, i) => ({ s: labels[i % 5] }))
    expect(inferSchema(['s'], rows)[0].dataType).toBe('string')
  })

  it('defaults to string when all values are empty', () => {
    const rows = [{ n: '' }, { n: '' }]
    expect(inferSchema(['n'], rows)[0].dataType).toBe('string')
  })

  it('defaults to string on empty rows array', () => {
    expect(inferSchema(['name'], [])[0].dataType).toBe('string')
  })

  it('handles multiple headers', () => {
    const rows = [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }]
    const fields = inferSchema(['id', 'name'], rows)
    expect(fields).toHaveLength(2)
    expect(fields[0].dataType).toBe('integer')
    expect(fields[1].dataType).toBe('string')
  })

  it('ignores empty values when inferring type', () => {
    // Mix of integers and empty cells — should still be integer
    const rows = [{ n: '1' }, { n: '' }, { n: '3' }]
    expect(inferSchema(['n'], rows)[0].dataType).toBe('integer')
  })

  it('returns empty array for empty headers', () => {
    expect(inferSchema([], [{ x: '1' }])).toEqual([])
  })
})

// ── parseFile ──────────────────────────────────────────────────────────────

describe('parseFile', () => {
  let tempFile: string | null = null
  afterEach(() => { if (tempFile) { cleanupFile(tempFile); tempFile = null } })

  it('reads headers and rows from a CSV file', async () => {
    tempFile = createCsv('name,age\nAlice,30\nBob,25')
    const { headers, rows } = await parseFile(tempFile)
    expect(headers).toEqual(['name', 'age'])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ name: 'Alice', age: '30' })
  })

  it('reads headers and rows from an XLSX file', async () => {
    tempFile = await createXlsx([['name', 'age'], ['Alice', 30], ['Bob', 25]])
    const { headers, rows } = await parseFile(tempFile)
    expect(headers).toEqual(['name', 'age'])
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe('Alice')
    expect(rows[1].name).toBe('Bob')
  })

  it('respects maxRows limit', async () => {
    tempFile = createCsv('x\n1\n2\n3\n4\n5')
    const { rows } = await parseFile(tempFile, 3)
    expect(rows).toHaveLength(3)
  })

  it('returns empty headers and rows when file has only a header row', async () => {
    tempFile = createCsv('col1,col2')
    const { headers, rows } = await parseFile(tempFile)
    expect(headers).toEqual(['col1', 'col2'])
    expect(rows).toHaveLength(0)
  })

  it('respects skipRows option to offset the header row', async () => {
    // Row 0 is a preamble, row 1 is the header, row 2+ is data
    tempFile = createCsv('PREAMBLE\nname,city\nAlice,London')
    const { headers, rows } = await parseFile(tempFile, undefined, { skipRows: 1 })
    expect(headers).toEqual(['name', 'city'])
    expect(rows[0]).toEqual({ name: 'Alice', city: 'London' })
  })

  it('respects skipColumns option', async () => {
    tempFile = createCsv('ignore,name,age\n,Alice,30')
    const { headers, rows } = await parseFile(tempFile, undefined, { skipColumns: 1 })
    expect(headers).toEqual(['name', 'age'])
    expect(rows[0]).toEqual({ name: 'Alice', age: '30' })
  })

  it('respects dataStartRow to skip rows between header and data', async () => {
    // Header at row 0, example row at row 1, data at row 2
    tempFile = createCsv('name,age\nExample,0\nAlice,30\nBob,25')
    const { headers, rows } = await parseFile(tempFile, undefined, { dataStartRow: 2 })
    expect(headers).toEqual(['name', 'age'])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ name: 'Alice', age: '30' })
  })

  it('returns empty result when headerRowIndex is beyond file length', async () => {
    tempFile = createCsv('only one line')
    const { headers, rows } = await parseFile(tempFile, undefined, { skipRows: 5 })
    expect(headers).toEqual([])
    expect(rows).toHaveLength(0)
  })
})

// ── parseHeaders ───────────────────────────────────────────────────────────

describe('parseHeaders', () => {
  let tempFile: string | null = null
  afterEach(() => { if (tempFile) { cleanupFile(tempFile); tempFile = null } })

  it('returns only the header row, no data rows', async () => {
    tempFile = createCsv('col_a,col_b,col_c\n1,2,3\n4,5,6')
    const headers = await parseHeaders(tempFile)
    expect(headers).toEqual(['col_a', 'col_b', 'col_c'])
  })
})

// ── parseAllSheets ─────────────────────────────────────────────────────────

describe('parseAllSheets', () => {
  let tempFile: string | null = null
  afterEach(() => { if (tempFile) { cleanupFile(tempFile); tempFile = null } })

  it('returns one entry per sheet', async () => {
    tempFile = await createMultiSheetXlsx({
      Sources: [['id', 'name'], ['1', 'Alice']],
      Targets: [['code', 'label'], ['A', 'Active']],
    })
    const sheets = await parseAllSheets(tempFile)
    expect(sheets).toHaveLength(2)
    expect(sheets[0].sheetName).toBe('Sources')
    expect(sheets[0].headers).toEqual(['id', 'name'])
    expect(sheets[0].rows[0]).toEqual({ id: '1', name: 'Alice' })
    expect(sheets[1].sheetName).toBe('Targets')
  })

  it('treats a CSV as a single-sheet result', async () => {
    tempFile = createCsv('a,b\n1,2')
    const sheets = await parseAllSheets(tempFile)
    expect(sheets).toHaveLength(1)
    expect(sheets[0].headers).toEqual(['a', 'b'])
  })
})
