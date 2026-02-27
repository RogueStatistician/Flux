/**
 * Export Layer — EIB (Enterprise Interface Builder) flat-sheet writer.
 *
 * Produces a Workday-ready Excel workbook with:
 *  - A single flat sheet with Workday-mandated headers in row 1
 *  - Data starting from row 2
 *
 * Also produces a minimal mapping documentation sheet when requested.
 *
 * The output is returned as a base64-encoded string. The caller (Electron
 * main process or UI IPC handler) is responsible for writing it to disk.
 */
import * as XLSX from 'xlsx'
import type { RowResult, TransformResult } from '../engine/types.js'
import type { Profile } from '../engine/schema.js'

export interface EibExportOptions {
  /** Rows to write (after applying the onValidationError policy). */
  rows: RowResult[]
  /** The profile used for this transformation (for metadata). */
  profile: Profile
  /** Target field names in the order they should appear as columns. */
  targetFields: string[]
  /** Include mapping documentation sheet in the same workbook. */
  includeMappingDoc?: boolean
}

export interface ExportResult {
  /** Base64-encoded .xlsx workbook. */
  base64: string
  /** Total rows written to the output sheet. */
  rowsWritten: number
  /** Filename suggestion for the saved file. */
  suggestedFilename: string
}

/**
 * Build the main EIB data sheet.
 */
function buildEibSheet(rows: RowResult[], targetFields: string[]): XLSX.WorkSheet {
  // Build the 2D array: headers in row 0, data from row 1
  const data: (string | number | null)[][] = [
    targetFields, // Header row
    ...rows.map(r => targetFields.map(f => r.outputRow[f] ?? '')),
  ]

  const ws = XLSX.utils.aoa_to_sheet(data)

  // Style: bold headers (basic column width hints)
  const colWidths = targetFields.map(f => ({ wch: Math.max(f.length + 2, 15) }))
  ws['!cols'] = colWidths

  return ws
}

/**
 * Build a simple mapping documentation sheet.
 */
function buildMappingDocSheet(profile: Profile): XLSX.WorkSheet {
  const headers = ['Target Field', 'Rule Type', 'Source / Value', 'Notes', 'Required']
  const rows: string[][] = profile.fieldMappings.map(fm => {
    let sourceDesc = ''
    const rule = fm.rule
    switch (rule.type) {
      case 'direct':      sourceDesc = `Source: ${rule.sourceField}`; break
      case 'constant':    sourceDesc = `Fixed value: "${rule.value}"`; break
      case 'lookup':      sourceDesc = `Lookup table "${rule.table}" on ${rule.sourceField}`; break
      case 'concat':      sourceDesc = `Concat: ${rule.parts.join(' + ')}`; break
      case 'dateFormat':  sourceDesc = `${rule.sourceField} (${rule.inputFormat} → ${rule.outputFormat})`; break
      case 'split':       sourceDesc = `${rule.sourceField} split by "${rule.delimiter}" [${rule.index}]`; break
      case 'conditional': sourceDesc = `Conditional on ${rule.conditions[0]?.if.field ?? '?'} (${rule.conditions.length} conditions)`; break
      case 'regex':       sourceDesc = `${rule.sourceField} match /${rule.pattern}/`; break
      case 'expr':        sourceDesc = `expr: ${rule.expression}`; break
    }
    return [fm.targetField, rule.type, sourceDesc, fm.notes ?? '', '']
  })

  const data = [headers, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = [
    { wch: 25 }, // Target Field
    { wch: 14 }, // Rule Type
    { wch: 50 }, // Source / Value
    { wch: 50 }, // Notes
    { wch: 10 }, // Required
  ]
  return ws
}

/**
 * Export transformed rows to a Workday EIB flat-sheet Excel workbook.
 */
export function exportToEib(options: EibExportOptions): ExportResult {
  const { rows, profile, targetFields, includeMappingDoc = false } = options

  const workbook = XLSX.utils.book_new()

  // Main EIB data sheet
  const eibSheet = buildEibSheet(rows, targetFields)
  XLSX.utils.book_append_sheet(workbook, eibSheet, 'Workers')

  // Optional mapping documentation sheet
  if (includeMappingDoc) {
    const mappingSheet = buildMappingDocSheet(profile)
    XLSX.utils.book_append_sheet(workbook, mappingSheet, 'Field Mapping')
  }

  // Write workbook to base64
  const base64 = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'base64',
  })

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const suggestedFilename = `WD_EIB_Workers_${profile.profileId}_${dateStr}.xlsx`

  return {
    base64,
    rowsWritten: rows.length,
    suggestedFilename,
  }
}

/**
 * Build a data quality summary workbook from a TransformResult.
 */
export function exportQualitySummary(result: TransformResult, profile: Profile): ExportResult {
  const workbook = XLSX.utils.book_new()

  // Summary sheet
  const summaryData = [
    ['SF2WD — Data Quality Summary'],
    [''],
    ['Profile', profile.profileId],
    ['Description', profile.description],
    ['Generated', new Date().toISOString()],
    [''],
    ['Metric', 'Value'],
    ['Total Rows', result.totalRows],
    ['Clean Rows', result.cleanRows],
    ['Rows with Warnings', result.warningRows],
    ['Rows with Errors', result.errorRows],
    ['Data Readiness %', result.totalRows > 0
      ? `${Math.round((result.cleanRows / result.totalRows) * 100)}%`
      : 'N/A'],
  ]
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

  // Row-level error sample (first 100 error rows)
  const errorRows = result.rows.filter(r => r.hasErrors).slice(0, 100)
  const errorData: (string | number)[][] = [
    ['Source Row #', 'Target Field', 'Severity', 'Message', 'Source Field', 'Source Value'],
    ...errorRows.flatMap(r =>
      r.diagnostics
        .filter(d => d.severity === 'error')
        .map(d => [
          r.sourceIndex + 1,
          d.targetField,
          d.severity,
          d.message,
          d.sourceField ?? '',
          d.sourceValue ?? '',
        ])
    ),
  ]
  const errorSheet = XLSX.utils.aoa_to_sheet(errorData)
  errorSheet['!cols'] = [
    { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 80 }, { wch: 20 }, { wch: 30 },
  ]
  XLSX.utils.book_append_sheet(workbook, errorSheet, 'Error Sample')

  const base64 = XLSX.write(workbook, { bookType: 'xlsx', type: 'base64' })
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  return {
    base64,
    rowsWritten: result.totalRows,
    suggestedFilename: `SF2WD_Quality_Summary_${dateStr}.xlsx`,
  }
}

/**
 * Derive the ordered list of target field names from the profile.
 * (Used when a template schema is not available to supply a canonical order.)
 */
export function getTargetFieldsFromProfile(profile: Profile): string[] {
  return profile.fieldMappings.map(fm => fm.targetField)
}
