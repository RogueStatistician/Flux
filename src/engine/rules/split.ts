import type { SplitRule } from '../schema.js'
import type { SourceRow, Diagnostic } from '../types.js'

export function evaluateSplit(
  rule: SplitRule,
  row: SourceRow,
  targetField: string,
): { value: string; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const sourceValue = row[rule.sourceField] ?? ''

  if (!sourceValue) {
    return { value: '', diagnostics }
  }

  const parts = sourceValue.split(rule.delimiter)

  if (rule.index >= parts.length) {
    diagnostics.push({
      severity: 'warn',
      targetField,
      sourceField: rule.sourceField,
      sourceValue,
      message: `Split index ${rule.index} is out of bounds (split produced ${parts.length} segment(s)) for value "${sourceValue}".`,
    })
    return { value: '', diagnostics }
  }

  return { value: parts[rule.index], diagnostics }
}
