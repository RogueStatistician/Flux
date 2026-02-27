/**
 * SF2WD Transformation Engine
 *
 * Pure function: (sourceRows[], profile) → TransformResult
 *
 * Design principles:
 *  - No side effects: same inputs always produce the same output.
 *  - No dependency on the UI, file system, or Electron APIs.
 *  - Every rule evaluation is traceable to a specific field mapping.
 *  - Fully testable in isolation with Vitest.
 *  - Safe: no arbitrary code execution (expr rule requires explicit opt-in).
 */
import type { Profile } from './schema.js'
import type {
  SourceRow,
  OutputRow,
  Diagnostic,
  RowResult,
  TransformResult,
  ProgressCallback,
} from './types.js'

import { evaluateDirect } from './rules/direct.js'
import { evaluateConstant } from './rules/constant.js'
import { evaluateLookup } from './rules/lookup.js'
import { evaluateConcat } from './rules/concat.js'
import { evaluateDateFormat } from './rules/dateFormat.js'
import { evaluateSplit } from './rules/split.js'
import { evaluateConditional } from './rules/conditional.js'
import { evaluateRegex } from './rules/regex.js'
import { evaluateExpr } from './rules/expr.js'

// Progress reporting interval (emit every N rows).
const PROGRESS_INTERVAL = 1000

/**
 * Apply one field mapping rule to a source row and return the target value
 * plus any diagnostics produced during evaluation.
 */
function applyRule(
  fieldMapping: Profile['fieldMappings'][number],
  row: SourceRow,
  profile: Profile,
): { value: string; diagnostics: Diagnostic[] } {
  const { rule, targetField } = fieldMapping
  const emptySourceValues = profile.settings.emptySourceValue as Array<string | null>

  switch (rule.type) {
    case 'direct':
      return evaluateDirect(rule, row, targetField)

    case 'constant':
      return evaluateConstant(rule, targetField)

    case 'lookup':
      return evaluateLookup(rule, row, targetField, profile.lookupTables, emptySourceValues)

    case 'concat':
      return evaluateConcat(rule, row, targetField)

    case 'dateFormat':
      return evaluateDateFormat(rule, row, targetField)

    case 'split':
      return evaluateSplit(rule, row, targetField)

    case 'conditional':
      return evaluateConditional(rule, row, targetField, emptySourceValues)

    case 'regex':
      return evaluateRegex(rule, row, targetField)

    case 'expr':
      return evaluateExpr(rule, row, targetField, profile.settings.enableExprRules)

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = rule
      return {
        value: '',
        diagnostics: [{
          severity: 'error',
          targetField,
          message: `Unknown rule type: ${(_exhaustive as { type: string }).type}`,
        }],
      }
    }
  }
}

/**
 * Transform a single source row using the given profile.
 */
function transformRow(row: SourceRow, sourceIndex: number, profile: Profile): RowResult {
  const outputRow: OutputRow = {}
  const allDiagnostics: Diagnostic[] = []

  for (const fieldMapping of profile.fieldMappings) {
    const { value, diagnostics } = applyRule(fieldMapping, row, profile)
    outputRow[fieldMapping.targetField] = value
    allDiagnostics.push(...diagnostics)
  }

  const hasErrors = allDiagnostics.some(d => d.severity === 'error')
  const hasWarnings = allDiagnostics.some(d => d.severity === 'warn')

  return {
    sourceIndex,
    outputRow,
    diagnostics: allDiagnostics,
    hasErrors,
    hasWarnings,
  }
}

/**
 * Main transformation entry point.
 *
 * Transforms all source rows using the given profile. Emits progress events
 * every PROGRESS_INTERVAL rows if a callback is provided.
 *
 * @param sourceRows - Parsed source data rows.
 * @param profile    - Validated mapping profile.
 * @param onProgress - Optional progress callback.
 * @returns TransformResult with all row results and aggregate statistics.
 */
export function transform(
  sourceRows: SourceRow[],
  profile: Profile,
  onProgress?: ProgressCallback,
): TransformResult {
  const rows: RowResult[] = []
  const total = sourceRows.length

  for (let i = 0; i < total; i++) {
    const rowResult = transformRow(sourceRows[i], i, profile)
    rows.push(rowResult)

    if (onProgress && (i + 1) % PROGRESS_INTERVAL === 0) {
      onProgress({
        processed: i + 1,
        total,
        percentage: Math.round(((i + 1) / total) * 100),
      })
    }
  }

  // Final progress event
  if (onProgress && total > 0) {
    onProgress({ processed: total, total, percentage: 100 })
  }

  const errorRows = rows.filter(r => r.hasErrors).length
  const warningRows = rows.filter(r => !r.hasErrors && r.hasWarnings).length
  const cleanRows = total - errorRows - warningRows

  return {
    rows,
    totalRows: total,
    cleanRows,
    errorRows,
    warningRows,
  }
}

/**
 * Apply the onValidationError policy to a TransformResult.
 * Returns only the rows that should appear in the export file.
 *
 * - "skip"    → exclude rows with errors
 * - "halt"    → returns null if any row has errors (caller should abort export)
 * - "include" → include all rows, adding an __SF2WD_Errors column
 */
export function applyExportPolicy(
  result: TransformResult,
  policy: Profile['settings']['onValidationError'],
): RowResult[] | null {
  switch (policy) {
    case 'skip':
      return result.rows.filter(r => !r.hasErrors)

    case 'halt':
      if (result.errorRows > 0) return null
      return result.rows

    case 'include':
      return result.rows.map(r => {
        if (!r.hasErrors) return r
        const errorMessages = r.diagnostics
          .filter(d => d.severity === 'error')
          .map(d => `[${d.targetField}] ${d.message}`)
          .join('; ')
        return {
          ...r,
          outputRow: { ...r.outputRow, __SF2WD_Errors: errorMessages },
        }
      })
  }
}
