import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import type { DateFormatRule } from '../schema.js'
import type { SourceRow, Diagnostic } from '../types.js'

dayjs.extend(customParseFormat)

export function evaluateDateFormat(
  rule: DateFormatRule,
  row: SourceRow,
  targetField: string,
): { value: string; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const sourceValue = row[rule.sourceField] ?? ''

  if (!sourceValue) {
    return { value: '', diagnostics }
  }

  const parsed = dayjs(sourceValue, rule.inputFormat, true)

  if (!parsed.isValid()) {
    diagnostics.push({
      severity: 'error',
      targetField,
      sourceField: rule.sourceField,
      sourceValue,
      message: `Cannot parse "${sourceValue}" as date with format "${rule.inputFormat}".`,
    })
    return { value: sourceValue, diagnostics }
  }

  return { value: parsed.format(rule.outputFormat), diagnostics }
}
