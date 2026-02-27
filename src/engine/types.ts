/**
 * Runtime types for the transformation engine pipeline.
 * These are separate from the schema types (which describe the JSON profile)
 * because they describe what flows through the engine at runtime.
 */

/** A flat key-value map representing one row of source data. */
export type SourceRow = Record<string, string>

/** A flat key-value map representing one row of transformed output data. */
export type OutputRow = Record<string, string>

/** Severity of a diagnostic message produced during transformation. */
export type DiagnosticSeverity = 'info' | 'warn' | 'error'

/** A single diagnostic emitted while processing a field mapping. */
export interface Diagnostic {
  severity: DiagnosticSeverity
  targetField: string
  message: string
  /** The source field involved, if applicable. */
  sourceField?: string
  /** The raw source value that triggered the diagnostic, if applicable. */
  sourceValue?: string
}

/** The result of processing a single source row through the transformation engine. */
export interface RowResult {
  /** 0-based index of this row in the source data array. */
  sourceIndex: number
  /** The transformed output row. May be partial if errors occurred. */
  outputRow: OutputRow
  /** All diagnostics produced while processing this row. */
  diagnostics: Diagnostic[]
  /** Whether this row has any error-severity diagnostics. */
  hasErrors: boolean
  /** Whether this row has any warn-severity diagnostics. */
  hasWarnings: boolean
}

/** The complete result of a transformation run over all source rows. */
export interface TransformResult {
  /** Results for every source row (in source order). */
  rows: RowResult[]
  /** Total number of source rows processed. */
  totalRows: number
  /** Number of rows with no errors. */
  cleanRows: number
  /** Number of rows with at least one error. */
  errorRows: number
  /** Number of rows with at least one warning (but no errors). */
  warningRows: number
}

/** Progress event emitted during chunked/streaming transformation. */
export interface TransformProgress {
  processed: number
  total: number
  percentage: number
}

/** Callback to receive progress events during transformation. */
export type ProgressCallback = (progress: TransformProgress) => void

/** Parsed source file statistics. */
export interface SourceStats {
  rowCount: number
  columnCount: number
  columns: string[]
  /** Columns where > 10% of rows have empty values. */
  sparseColumns: string[]
  /** Number of exact duplicate rows detected. */
  duplicateCount: number
}

/** The result of parsing a source file. */
export interface ParseResult {
  rows: SourceRow[]
  stats: SourceStats
  sheetName: string
}
