import type { LookupRule } from '../schema.js'
import type { SourceRow, Diagnostic } from '../types.js'

export function evaluateLookup(
  rule: LookupRule,
  row: SourceRow,
  targetField: string,
  lookupTables: Record<string, Record<string, string>>,
  emptySourceValues: Array<string | null>,
): { value: string; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const table = lookupTables[rule.table]

  if (!table) {
    diagnostics.push({
      severity: 'error',
      targetField,
      sourceField: rule.sourceField,
      message: `Lookup table "${rule.table}" not found in profile.`,
    })
    return { value: '', diagnostics }
  }

  const sourceValue = row[rule.sourceField] ?? ''
  const isEmpty = emptySourceValues.includes(sourceValue) || emptySourceValues.includes(null) && sourceValue === ''

  if (isEmpty) {
    if (rule.default !== undefined) {
      return { value: rule.default, diagnostics }
    }
    diagnostics.push({
      severity: rule.onMissing,
      targetField,
      sourceField: rule.sourceField,
      sourceValue,
      message: `Source field "${rule.sourceField}" is empty and no default is defined for table "${rule.table}".`,
    })
    return { value: '', diagnostics }
  }

  if (Object.prototype.hasOwnProperty.call(table, sourceValue)) {
    return { value: table[sourceValue], diagnostics }
  }

  // Key not found in table
  if (rule.default !== undefined) {
    diagnostics.push({
      severity: 'warn',
      targetField,
      sourceField: rule.sourceField,
      sourceValue,
      message: `Value "${sourceValue}" not found in lookup table "${rule.table}". Using default "${rule.default}".`,
    })
    return { value: rule.default, diagnostics }
  }

  diagnostics.push({
    severity: rule.onMissing,
    targetField,
    sourceField: rule.sourceField,
    sourceValue,
    message: `Value "${sourceValue}" not found in lookup table "${rule.table}" and no default is defined.`,
  })
  return { value: '', diagnostics }
}
