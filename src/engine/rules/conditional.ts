import type { ConditionalRule } from '../schema.js'
import type { SourceRow, Diagnostic } from '../types.js'

function testCondition(
  condition: ConditionalRule['conditions'][number]['if'],
  row: SourceRow,
  emptySourceValues: Array<string | null>,
): boolean {
  const value = row[condition.field] ?? ''

  if (condition.equals !== undefined) {
    return value === condition.equals
  }

  if (condition.contains !== undefined) {
    return value.includes(condition.contains)
  }

  if (condition.regex !== undefined) {
    try {
      return new RegExp(condition.regex).test(value)
    } catch {
      return false
    }
  }

  if (condition.isEmpty !== undefined) {
    const isEmpty =
      emptySourceValues.includes(value) ||
      (emptySourceValues.includes(null) && value === '')
    return condition.isEmpty ? isEmpty : !isEmpty
  }

  return false
}

export function evaluateConditional(
  rule: ConditionalRule,
  row: SourceRow,
  targetField: string,
  emptySourceValues: Array<string | null>,
): { value: string; diagnostics: Diagnostic[] } {
  for (const branch of rule.conditions) {
    if (testCondition(branch.if, row, emptySourceValues)) {
      return { value: branch.then, diagnostics: [] }
    }
  }
  return { value: rule.else, diagnostics: [] }
}
