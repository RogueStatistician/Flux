import type { DirectRule } from '../schema.js'
import type { SourceRow, Diagnostic } from '../types.js'

export function evaluateDirect(
  rule: DirectRule,
  row: SourceRow,
  targetField: string,
): { value: string; diagnostics: Diagnostic[] } {
  const value = row[rule.sourceField] ?? ''
  return { value, diagnostics: [] }
}
