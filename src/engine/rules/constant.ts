import type { ConstantRule } from '../schema.js'
import type { Diagnostic } from '../types.js'

export function evaluateConstant(
  rule: ConstantRule,
  _targetField: string,
): { value: string; diagnostics: Diagnostic[] } {
  return { value: rule.value, diagnostics: [] }
}
