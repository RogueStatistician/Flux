import type { ConcatRule } from '../schema.js'
import type { SourceRow, Diagnostic } from '../types.js'

/**
 * Concat rule: joins an ordered list of source fields and/or string literals.
 *
 * Convention: if a part is surrounded by double-quotes in the JSON, it is a
 * string literal (e.g. `"\" \""` → a single space). If it matches a column
 * header in the source row, it is treated as a field reference. Otherwise it
 * is treated as a literal string as-is (allows un-quoted literals too, for
 * convenience).
 */
export function evaluateConcat(
  rule: ConcatRule,
  row: SourceRow,
  targetField: string,
): { value: string; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const segments: string[] = []

  for (const part of rule.parts) {
    // If the part is a quoted string literal (e.g. `" "` → space), strip quotes.
    if (part.startsWith('"') && part.endsWith('"') && part.length >= 2) {
      segments.push(part.slice(1, -1))
    } else {
      // Treat as a field reference. If the field is absent in this row,
      // resolve to empty string (graceful handling of optional fields).
      segments.push(row[part] ?? '')
    }
  }

  return { value: segments.join(''), diagnostics }
}
