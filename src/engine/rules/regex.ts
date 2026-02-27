import type { RegexRule } from '../schema.js'
import type { SourceRow, Diagnostic } from '../types.js'

export function evaluateRegex(
  rule: RegexRule,
  row: SourceRow,
  targetField: string,
): { value: string; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const sourceValue = row[rule.sourceField] ?? ''

  if (!sourceValue) {
    return { value: '', diagnostics }
  }

  let regex: RegExp
  try {
    regex = new RegExp(rule.pattern)
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      targetField,
      sourceField: rule.sourceField,
      sourceValue,
      message: `Invalid regex pattern "${rule.pattern}": ${err instanceof Error ? err.message : String(err)}`,
    })
    return { value: '', diagnostics }
  }

  const match = regex.exec(sourceValue)

  if (!match) {
    diagnostics.push({
      severity: 'warn',
      targetField,
      sourceField: rule.sourceField,
      sourceValue,
      message: `Pattern "${rule.pattern}" did not match value "${sourceValue}".`,
    })
    return { value: '', diagnostics }
  }

  const captureGroup = rule.captureGroup
  if (captureGroup >= match.length) {
    diagnostics.push({
      severity: 'warn',
      targetField,
      sourceField: rule.sourceField,
      sourceValue,
      message: `Capture group ${captureGroup} does not exist in pattern "${rule.pattern}" match for "${sourceValue}".`,
    })
    return { value: match[0], diagnostics }
  }

  return { value: match[captureGroup] ?? '', diagnostics }
}
