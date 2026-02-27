/**
 * SF2WD Transformation Engine — Unit Tests
 *
 * Tests every rule type across normal, edge-case, and error-path scenarios.
 * All tests use the pure `transform` function — no Electron, no file system.
 */
import { describe, it, expect } from 'vitest'
import { transform, applyExportPolicy } from '../engine/engine.js'
import { ProfileSchema } from '../engine/schema.js'
import type { Profile } from '../engine/schema.js'
import type { SourceRow } from '../engine/types.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return ProfileSchema.parse({
    profileId: 'test-profile',
    description: 'Test profile',
    version: '1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    source: { system: 'sap-successfactors', template: 'ec-employee-export' },
    target: { system: 'workday', template: 'eib-worker' },
    settings: {},
    lookupTables: {},
    fieldMappings: [],
    ...overrides,
  })
}

function run(
  rows: SourceRow[],
  profile: Partial<Profile>,
) {
  return transform(rows, makeProfile(profile))
}

// ── direct rule ───────────────────────────────────────────────────────────────

describe('direct rule', () => {
  it('copies the source field verbatim', () => {
    const result = run(
      [{ PERNR: '00012345', NAME: 'Alice' }],
      {
        fieldMappings: [{ targetField: 'Employee_ID', rule: { type: 'direct', sourceField: 'PERNR' } }],
      },
    )
    expect(result.rows[0].outputRow.Employee_ID).toBe('00012345')
    expect(result.rows[0].hasErrors).toBe(false)
  })

  it('returns empty string for missing source field', () => {
    const result = run(
      [{ OTHER: 'value' }],
      {
        fieldMappings: [{ targetField: 'X', rule: { type: 'direct', sourceField: 'MISSING' } }],
      },
    )
    expect(result.rows[0].outputRow.X).toBe('')
    expect(result.rows[0].hasErrors).toBe(false)
  })
})

// ── constant rule ─────────────────────────────────────────────────────────────

describe('constant rule', () => {
  it('writes the fixed literal value to every row', () => {
    const result = run(
      [{ A: '1' }, { A: '2' }, { A: '3' }],
      {
        fieldMappings: [{ targetField: 'Source_System', rule: { type: 'constant', value: 'SuccessFactors' } }],
      },
    )
    for (const row of result.rows) {
      expect(row.outputRow.Source_System).toBe('SuccessFactors')
    }
  })

  it('supports empty string constant', () => {
    const result = run(
      [{ A: '1' }],
      {
        fieldMappings: [{ targetField: 'Blank', rule: { type: 'constant', value: '' } }],
      },
    )
    expect(result.rows[0].outputRow.Blank).toBe('')
  })
})

// ── lookup rule ───────────────────────────────────────────────────────────────

describe('lookup rule', () => {
  const lookupTables = {
    gender: { M: 'Male', F: 'Female', U: 'Not Declared' },
  }

  it('translates a known key', () => {
    const result = run(
      [{ GENDER: 'M' }],
      {
        lookupTables,
        fieldMappings: [{
          targetField: 'Gender',
          rule: { type: 'lookup', sourceField: 'GENDER', table: 'gender', onMissing: 'warn' },
        }],
      },
    )
    expect(result.rows[0].outputRow.Gender).toBe('Male')
    expect(result.rows[0].hasErrors).toBe(false)
  })

  it('uses the default value for unknown keys and emits a warning', () => {
    const result = run(
      [{ GENDER: 'X' }],
      {
        lookupTables,
        fieldMappings: [{
          targetField: 'Gender',
          rule: { type: 'lookup', sourceField: 'GENDER', table: 'gender', default: 'Not Declared', onMissing: 'warn' },
        }],
      },
    )
    expect(result.rows[0].outputRow.Gender).toBe('Not Declared')
    expect(result.rows[0].hasWarnings).toBe(true)
    expect(result.rows[0].hasErrors).toBe(false)
  })

  it('emits an error for unknown key when onMissing=error and no default', () => {
    const result = run(
      [{ GENDER: 'X' }],
      {
        lookupTables,
        fieldMappings: [{
          targetField: 'Gender',
          rule: { type: 'lookup', sourceField: 'GENDER', table: 'gender', onMissing: 'error' },
        }],
      },
    )
    expect(result.rows[0].hasErrors).toBe(true)
    expect(result.rows[0].outputRow.Gender).toBe('')
  })

  it('emits an error when the lookup table does not exist', () => {
    const result = run(
      [{ GENDER: 'M' }],
      {
        lookupTables: {},
        fieldMappings: [{
          targetField: 'Gender',
          rule: { type: 'lookup', sourceField: 'GENDER', table: 'nonexistent', onMissing: 'warn' },
        }],
      },
    )
    expect(result.rows[0].hasErrors).toBe(true)
  })
})

// ── concat rule ───────────────────────────────────────────────────────────────

describe('concat rule', () => {
  it('joins field values and literals in order', () => {
    const result = run(
      [{ FIRSTNAME: 'Alice', LASTNAME: 'Smith' }],
      {
        fieldMappings: [{
          targetField: 'Full_Name',
          rule: { type: 'concat', parts: ['FIRSTNAME', '" "', 'LASTNAME'] },
        }],
      },
    )
    expect(result.rows[0].outputRow.Full_Name).toBe('Alice Smith')
  })

  it('handles missing fields gracefully (uses empty string)', () => {
    const result = run(
      [{ FIRSTNAME: 'Bob' }],
      {
        fieldMappings: [{
          targetField: 'Full_Name',
          rule: { type: 'concat', parts: ['FIRSTNAME', '" "', 'LASTNAME'] },
        }],
      },
    )
    expect(result.rows[0].outputRow.Full_Name).toBe('Bob ')
  })

  it('treats double-quoted parts as string literals', () => {
    const result = run(
      [{ CODE: '42' }],
      {
        fieldMappings: [{
          targetField: 'Result',
          // '"-SUFFIX"' (embedded quotes) → literal "-SUFFIX"
          rule: { type: 'concat', parts: ['CODE', '"-SUFFIX"'] },
        }],
      },
    )
    expect(result.rows[0].outputRow.Result).toBe('42-SUFFIX')
  })
})

// ── dateFormat rule ───────────────────────────────────────────────────────────

describe('dateFormat rule', () => {
  it('reformats a date from YYYYMMDD to MM/DD/YYYY', () => {
    const result = run(
      [{ EINDT: '20230115' }],
      {
        fieldMappings: [{
          targetField: 'Hire_Date',
          rule: { type: 'dateFormat', sourceField: 'EINDT', inputFormat: 'YYYYMMDD', outputFormat: 'MM/DD/YYYY' },
        }],
      },
    )
    expect(result.rows[0].outputRow.Hire_Date).toBe('01/15/2023')
  })

  it('reformats a date from DD.MM.YYYY to YYYY-MM-DD', () => {
    const result = run(
      [{ BIRTHDT: '15.01.1990' }],
      {
        fieldMappings: [{
          targetField: 'Date_of_Birth',
          rule: { type: 'dateFormat', sourceField: 'BIRTHDT', inputFormat: 'DD.MM.YYYY', outputFormat: 'YYYY-MM-DD' },
        }],
      },
    )
    expect(result.rows[0].outputRow.Date_of_Birth).toBe('1990-01-15')
  })

  it('emits an error for an unparseable date', () => {
    const result = run(
      [{ EINDT: 'not-a-date' }],
      {
        fieldMappings: [{
          targetField: 'Hire_Date',
          rule: { type: 'dateFormat', sourceField: 'EINDT', inputFormat: 'YYYYMMDD', outputFormat: 'MM/DD/YYYY' },
        }],
      },
    )
    expect(result.rows[0].hasErrors).toBe(true)
  })

  it('returns empty string for empty source value (no error)', () => {
    const result = run(
      [{ AUSDT: '' }],
      {
        fieldMappings: [{
          targetField: 'Term_Date',
          rule: { type: 'dateFormat', sourceField: 'AUSDT', inputFormat: 'YYYYMMDD', outputFormat: 'MM/DD/YYYY' },
        }],
      },
    )
    expect(result.rows[0].outputRow.Term_Date).toBe('')
    expect(result.rows[0].hasErrors).toBe(false)
  })
})

// ── split rule ────────────────────────────────────────────────────────────────

describe('split rule', () => {
  it('splits on a delimiter and returns the segment at index', () => {
    const result = run(
      [{ CODE: 'DE-0042-FIN' }],
      {
        fieldMappings: [{
          targetField: 'Part',
          rule: { type: 'split', sourceField: 'CODE', delimiter: '-', index: 1 },
        }],
      },
    )
    expect(result.rows[0].outputRow.Part).toBe('0042')
  })

  it('emits a warning when the index is out of range', () => {
    const result = run(
      [{ CODE: 'A-B' }],
      {
        fieldMappings: [{
          targetField: 'Part',
          rule: { type: 'split', sourceField: 'CODE', delimiter: '-', index: 5 },
        }],
      },
    )
    expect(result.rows[0].hasWarnings).toBe(true)
    expect(result.rows[0].outputRow.Part).toBe('')
  })
})

// ── conditional rule ──────────────────────────────────────────────────────────

describe('conditional rule', () => {
  const mapping = {
    targetField: 'FTE_Type',
    rule: {
      type: 'conditional' as const,
      conditions: [
        { if: { field: 'VDSK1', equals: '1' }, then: 'Full-Time' },
        { if: { field: 'VDSK1', equals: '2' }, then: 'Part-Time' },
      ],
      else: 'Full-Time',
    },
  }

  it('returns the matching condition "then" value', () => {
    const result = run([{ VDSK1: '1' }], { fieldMappings: [mapping] })
    expect(result.rows[0].outputRow.FTE_Type).toBe('Full-Time')
  })

  it('returns the else value when no condition matches', () => {
    const result = run([{ VDSK1: 'X' }], { fieldMappings: [mapping] })
    expect(result.rows[0].outputRow.FTE_Type).toBe('Full-Time')
  })

  it('supports contains condition', () => {
    const result = run(
      [{ DESC: 'Senior Manager' }],
      {
        fieldMappings: [{
          targetField: 'IsManager',
          rule: {
            type: 'conditional',
            conditions: [{ if: { field: 'DESC', contains: 'Manager' }, then: 'Yes' }],
            else: 'No',
          },
        }],
      },
    )
    expect(result.rows[0].outputRow.IsManager).toBe('Yes')
  })

  it('supports isEmpty condition (true case)', () => {
    const result = run(
      [{ AUSDT: '' }],
      {
        fieldMappings: [{
          targetField: 'IsActive',
          rule: {
            type: 'conditional',
            conditions: [{ if: { field: 'AUSDT', isEmpty: true }, then: 'Active' }],
            else: 'Terminated',
          },
        }],
      },
    )
    expect(result.rows[0].outputRow.IsActive).toBe('Active')
  })

  it('supports regex condition', () => {
    const result = run(
      [{ PHONE: '+49 30 12345' }],
      {
        fieldMappings: [{
          targetField: 'IsDE',
          rule: {
            type: 'conditional',
            conditions: [{ if: { field: 'PHONE', regex: '^\\+49' }, then: 'Germany' }],
            else: 'Other',
          },
        }],
      },
    )
    expect(result.rows[0].outputRow.IsDE).toBe('Germany')
  })
})

// ── regex rule ────────────────────────────────────────────────────────────────

describe('regex rule', () => {
  it('extracts a capture group from the source value', () => {
    const result = run(
      [{ PHONE: '+49 123 456' }],
      {
        fieldMappings: [{
          targetField: 'CountryCode',
          rule: { type: 'regex', sourceField: 'PHONE', pattern: '^\\+(\\d+)\\s', captureGroup: 1 },
        }],
      },
    )
    expect(result.rows[0].outputRow.CountryCode).toBe('49')
  })

  it('emits a warning when the pattern does not match', () => {
    const result = run(
      [{ PHONE: 'no-match' }],
      {
        fieldMappings: [{
          targetField: 'CountryCode',
          rule: { type: 'regex', sourceField: 'PHONE', pattern: '^\\+(\\d+)', captureGroup: 1 },
        }],
      },
    )
    expect(result.rows[0].hasWarnings).toBe(true)
    expect(result.rows[0].outputRow.CountryCode).toBe('')
  })

  it('emits an error for an invalid regex pattern', () => {
    const result = run(
      [{ F: 'val' }],
      {
        fieldMappings: [{
          targetField: 'X',
          rule: { type: 'regex', sourceField: 'F', pattern: '[invalid', captureGroup: 1 },
        }],
      },
    )
    expect(result.rows[0].hasErrors).toBe(true)
  })
})

// ── expr rule ─────────────────────────────────────────────────────────────────

describe('expr rule', () => {
  it('evaluates a numeric expression when enableExprRules is true', () => {
    const result = run(
      [{ MONTHLY_SALARY: '5000' }],
      {
        settings: {
          onValidationError: 'skip',
          dateLocale: 'en-US',
          emptySourceValue: ['', null],
          enableExprRules: true,
        },
        fieldMappings: [{
          targetField: 'Annual_Salary',
          rule: { type: 'expr', expression: 'MONTHLY_SALARY * 12' },
        }],
      },
    )
    expect(result.rows[0].outputRow.Annual_Salary).toBe('60000')
    expect(result.rows[0].hasErrors).toBe(false)
  })

  it('emits an error when enableExprRules is false (default)', () => {
    const result = run(
      [{ MONTHLY_SALARY: '5000' }],
      {
        fieldMappings: [{
          targetField: 'Annual_Salary',
          rule: { type: 'expr', expression: 'MONTHLY_SALARY * 12' },
        }],
      },
    )
    expect(result.rows[0].hasErrors).toBe(true)
  })
})

// ── Engine statistics ─────────────────────────────────────────────────────────

describe('transform result statistics', () => {
  it('correctly counts clean, warning, and error rows', () => {
    const result = run(
      [
        { GENDER: 'M', DATE: '20230101' },   // clean
        { GENDER: 'X', DATE: '20230101' },   // warning (lookup miss with default)
        { GENDER: 'M', DATE: 'bad-date' },   // error (bad date)
      ],
      {
        lookupTables: { gender: { M: 'Male', F: 'Female' } },
        fieldMappings: [
          {
            targetField: 'Gender',
            rule: { type: 'lookup', sourceField: 'GENDER', table: 'gender', default: 'Not Declared', onMissing: 'warn' },
          },
          {
            targetField: 'Hire_Date',
            rule: { type: 'dateFormat', sourceField: 'DATE', inputFormat: 'YYYYMMDD', outputFormat: 'MM/DD/YYYY' },
          },
        ],
      },
    )

    expect(result.totalRows).toBe(3)
    expect(result.cleanRows).toBe(1)
    expect(result.warningRows).toBe(1)
    expect(result.errorRows).toBe(1)
  })
})

// ── applyExportPolicy ─────────────────────────────────────────────────────────

describe('applyExportPolicy', () => {
  const makeResult = () => run(
    [
      { GENDER: 'M', DATE: '20230101' },
      { GENDER: 'X', DATE: '20230101' },
      { GENDER: 'M', DATE: 'bad' },
    ],
    {
      lookupTables: { gender: { M: 'Male' } },
      fieldMappings: [
        { targetField: 'G', rule: { type: 'lookup', sourceField: 'GENDER', table: 'gender', default: 'ND', onMissing: 'warn' } },
        { targetField: 'D', rule: { type: 'dateFormat', sourceField: 'DATE', inputFormat: 'YYYYMMDD', outputFormat: 'MM/DD/YYYY' } },
      ],
    },
  )

  it('skip: excludes rows with errors', () => {
    const rows = applyExportPolicy(makeResult(), 'skip')
    expect(rows).not.toBeNull()
    expect(rows!.length).toBe(2) // clean + warning row kept
    expect(rows!.every(r => !r.hasErrors)).toBe(true)
  })

  it('halt: returns null when any row has errors', () => {
    const rows = applyExportPolicy(makeResult(), 'halt')
    expect(rows).toBeNull()
  })

  it('include: returns all rows with __SF2WD_Errors column on error rows', () => {
    const rows = applyExportPolicy(makeResult(), 'include')
    expect(rows).not.toBeNull()
    expect(rows!.length).toBe(3)
    const errorRow = rows!.find(r => r.hasErrors)
    expect(errorRow?.outputRow.__SF2WD_Errors).toBeTruthy()
  })
})

// ── Profile schema validation ─────────────────────────────────────────────────

describe('ProfileSchema', () => {
  it('parses a valid minimal profile', () => {
    const parsed = ProfileSchema.safeParse({
      profileId: 'test',
      description: 'Test',
      version: '1',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      source: { system: 'sap-successfactors', template: 'ec-employee-export' },
      target: { system: 'workday', template: 'eib-worker' },
      lookupTables: {},
      fieldMappings: [],
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a profile with unknown rule type', () => {
    const parsed = ProfileSchema.safeParse({
      profileId: 'test',
      description: 'Test',
      version: '1',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      source: { system: 'sap', template: 'ec' },
      target: { system: 'wd', template: 'eib' },
      lookupTables: {},
      fieldMappings: [{ targetField: 'X', rule: { type: 'unknown-rule-type', value: 'x' } }],
    })
    expect(parsed.success).toBe(false)
  })

  it('applies default settings when settings is omitted', () => {
    const parsed = ProfileSchema.parse({
      profileId: 'test',
      description: 'Test',
      version: '1',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      source: { system: 'sap', template: 'ec' },
      target: { system: 'wd', template: 'eib' },
      lookupTables: {},
      fieldMappings: [],
    })
    expect(parsed.settings.onValidationError).toBe('skip')
    expect(parsed.settings.enableExprRules).toBe(false)
    expect(parsed.settings.dateLocale).toBe('en-US')
  })
})
