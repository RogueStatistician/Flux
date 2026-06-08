import type { TransformationQuery, MappingLine, JoinStep } from '../platform/IPlatform.js'

// ── Rule → SQL expression ─────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s).replace(/'/g, "''")
}

function stripPrefix(encoded: string): string {
  const sep = encoded.indexOf('::')
  return sep >= 0 ? encoded.slice(sep + 2) : encoded
}

function conditionToSql(fieldName: string, op: string, value: string): string {
  switch (op) {
    case '=':           return `${fieldName} = '${esc(value)}'`
    case '!=':          return `${fieldName} <> '${esc(value)}'`
    case '>':           return `${fieldName} > '${esc(value)}'`
    case '<':           return `${fieldName} < '${esc(value)}'`
    case '>=':          return `${fieldName} >= '${esc(value)}'`
    case '<=':          return `${fieldName} <= '${esc(value)}'`
    case 'contains':    return `${fieldName} LIKE '%${esc(value)}%'`
    case 'not_contains':return `${fieldName} NOT LIKE '%${esc(value)}%'`
    case 'starts_with': return `${fieldName} LIKE '${esc(value)}%'`
    case 'ends_with':   return `${fieldName} LIKE '%${esc(value)}'`
    case 'is_empty':    return `(${fieldName} IS NULL OR ${fieldName} = '')`
    case 'is_not_empty':return `(${fieldName} IS NOT NULL AND ${fieldName} <> '')`
    default:            return `${fieldName} ${op} '${esc(value)}'`
  }
}

function ruleToSqlExpr(line: MappingLine): string {
  const { ruleType, rawConfig } = line
  if (ruleType === 'unmapped') return 'NULL'
  try {
    const cfg = JSON.parse(rawConfig) as Record<string, unknown>
    switch (ruleType) {
      case 'direct': {
        const field = (cfg.sourceFieldName as string) ?? '?'
        if (cfg.picklistMappingId) return `TRANSLATE(${field})`
        return field
      }
      case 'constant':
        return `'${esc(String(cfg.value ?? ''))}'`
      case 'uuid':
        return 'UUID()'
      case 'incremental':
        return `INCREMENTAL(${cfg.start ?? 1}, ${cfg.step ?? 1})`
      case 'concat': {
        const parts = ((cfg.parts as Array<{ type: string; value?: string; sourceFieldName?: string }>) ?? [])
          .map(p => p.type === 'literal' ? `'${esc(p.value ?? '')}'` : (p.sourceFieldName ?? '?'))
          .join(', ')
        return `CONCAT(${parts})`
      }
      case 'split':
        return `SPLIT(${cfg.sourceFieldName ?? '?'}, '${esc(String(cfg.delimiter ?? ','))}')[${cfg.index ?? 0}]`
      case 'substring': {
        const len = cfg.length !== undefined ? `, ${cfg.length}` : ''
        return `SUBSTR(${cfg.sourceFieldName ?? '?'}, ${cfg.start ?? 0}${len})`
      }
      case 'dateformat':
        return `FORMAT_DATE(${cfg.sourceFieldName ?? '?'}, '${cfg.outputFormat ?? '?'}')`
      case 'picklisttranslate': {
        const expr = `TRANSLATE(${cfg.sourceFieldName ?? '?'})`
        return cfg.fallback ? `COALESCE(${expr}, '${esc(String(cfg.fallback))}')` : expr
      }
      case 'expression': {
        const expr = ((cfg.expression as string) ?? '').trim()
        const short = expr.length > 72 ? expr.slice(0, 69) + '…' : expr
        return `/* JS */ ${short}`
      }
      case 'conditional': {
        const branches = (cfg.branches as Array<{
          field?: string; op?: string; value?: string
          outputType?: string; outputValue?: string
        }>) ?? []
        if (branches.length === 0) return 'NULL'
        const whens = branches.map(b => {
          const fieldName = stripPrefix(b.field ?? '?')
          const cond = conditionToSql(fieldName, b.op ?? '=', b.value ?? '')
          const val = b.outputType === 'field'
            ? stripPrefix(b.outputValue ?? 'NULL')
            : `'${esc(b.outputValue ?? '')}'`
          return `WHEN ${cond} THEN ${val}`
        }).join(' ')
        const elsePart = cfg.elseOutputType === 'field'
          ? stripPrefix((cfg.elseOutputValue as string) ?? 'NULL')
          : `'${esc(String(cfg.elseOutputValue ?? ''))}'`
        return `CASE ${whens} ELSE ${elsePart} END`
      }
      default:
        return ruleType
    }
  } catch {
    return line.description
  }
}

// ── Block builders ────────────────────────────────────────────────────────────

function pad(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length)
}

function buildSelectBlock(mappings: MappingLine[]): string {
  const exprs = mappings.map(m => ruleToSqlExpr(m))
  const maxLen = Math.min(52, Math.max(4, ...exprs.map(e => e.length)))

  return mappings.map((m, i) => {
    const expr = exprs[i]
    const comma = i < mappings.length - 1 ? ',' : ''
    const noteComment = m.notes ? `  -- ${m.notes}` : ''
    return `    ${pad(expr, maxLen + 2)}AS ${m.targetField}${comma}${noteComment}`
  }).join('\n')
}

function joinKeyword(step: JoinStep): string {
  return step.joinType === 'inner' ? 'INNER JOIN'
    : step.joinType === 'right' ? 'RIGHT JOIN'
    : 'LEFT JOIN'
}

function buildPathBlock(path: TransformationQuery['paths'][number], pathLabel?: string): string {
  const lines: string[] = []

  if (pathLabel) lines.push(pathLabel)

  lines.push('SELECT')
  lines.push(buildSelectBlock(path.mappings))

  if (path.joinChain) {
    const jc = path.joinChain
    const rootNote = jc.rootRowCount !== null ? `  -- ${jc.rootRowCount.toLocaleString()} rows` : ''
    lines.push(`FROM ${jc.rootSource}${rootNote}`)
    for (const step of jc.steps) {
      const alias = step.rightAlias ? ` AS ${step.rightAlias}` : ''
      const ref = step.rightAlias ?? step.rightSource
      const rowNote = step.rightRowCount !== null ? `  -- ${step.rightRowCount.toLocaleString()} rows` : ''
      lines.push(`${joinKeyword(step)} ${step.rightSource}${alias}${rowNote}`)
      lines.push(`    ON ${step.leftKey} = ${ref}.${step.rightKey}`)
    }
  } else {
    const rowNote = path.sourceRowCount !== null
      ? `  -- ${path.sourceRowCount.toLocaleString()} rows`
      : ''
    lines.push(`FROM ${path.sourceObject ?? '(source not resolved)'}${rowNote}`)
  }

  if (path.filters.length > 0) {
    lines.push(`WHERE`)
    path.filters.forEach((f, i) => {
      const prefix = i === 0 ? '    ' : '    AND '
      lines.push(`${prefix}${f}`)
    })
  }

  return lines.join('\n')
}

// ── Main export ───────────────────────────────────────────────────────────────

const HR = '═'.repeat(58)

/** Convert a TransformationQuery array into a formatted pseudo-SQL string. */
export function generateSqlPreview(queries: TransformationQuery[]): string {
  const name = queries[0]?.transformationName ?? 'Transformation'
  const date = new Date().toISOString().slice(0, 10)

  const preamble = [
    `-- ${HR}`,
    `-- Transformation: "${name}"`,
    `-- Generated by Flux · ${date}`,
    `-- ${HR}`,
  ].join('\n')

  const sections = queries.map(query => {
    const header = [
      ``,
      `-- ${'─'.repeat(58)}`,
      `-- INTO: ${query.targetObject}`,
      `-- ${'─'.repeat(58)}`,
    ].join('\n')

    const { paths } = query

    if (paths.length === 0) {
      return `${header}\n\n-- (no mappings defined)`
    }

    if (paths.length === 1) {
      return `${header}\n\n${buildPathBlock(paths[0])}\n;`
    }

    // Multiple paths → UNION ALL
    const unionNote = `-- ${paths.length} source paths → combined with UNION ALL`
    const blocks = paths.map((path, i) =>
      buildPathBlock(path, `-- Path ${i + 1}${path.mapNodeId ? ` [${path.mapNodeId}]` : ''}`)
    )
    return `${header}\n${unionNote}\n\n${blocks.join('\n\nUNION ALL\n\n')}\n;`
  })

  return [preamble, ...sections].join('\n')
}
