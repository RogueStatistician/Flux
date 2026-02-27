import { Parser } from 'expr-eval'
import type { ExprRule } from '../schema.js'
import type { SourceRow, Diagnostic } from '../types.js'

const parser = new Parser({
  operators: {
    logical: true,
    comparison: true,
    'in': true,
    assignment: false,
  },
})

export function evaluateExpr(
  rule: ExprRule,
  row: SourceRow,
  targetField: string,
  enableExprRules: boolean,
): { value: string; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []

  if (!enableExprRules) {
    diagnostics.push({
      severity: 'error',
      targetField,
      message:
        'Expression rules are disabled. Set `settings.enableExprRules: true` in the profile to use them.',
    })
    return { value: '', diagnostics }
  }

  let expr
  try {
    expr = parser.parse(rule.expression)
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      targetField,
      message: `Failed to parse expression "${rule.expression}": ${err instanceof Error ? err.message : String(err)}`,
    })
    return { value: '', diagnostics }
  }

  // Build evaluation context: convert all source field values to numbers if
  // possible, otherwise keep as strings.
  const context: Record<string, number | string> = {}
  for (const [key, val] of Object.entries(row)) {
    const num = Number(val)
    context[key] = isNaN(num) ? val : num
  }

  try {
    const result = expr.evaluate(context)
    return { value: String(result), diagnostics }
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      targetField,
      message: `Error evaluating expression "${rule.expression}": ${err instanceof Error ? err.message : String(err)}`,
    })
    return { value: '', diagnostics }
  }
}
