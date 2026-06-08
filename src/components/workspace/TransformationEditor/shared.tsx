/**
 * Shared utilities for TransformationEditor panels (Map, Join, Filter).
 */
import type { DataObject, ObjectField } from '../../../types/index.js'
import type { Node, Edge } from '@xyflow/react'

// ── Field encoding helpers ─────────────────────────────────────────────────────

export function encodeField(sourceObjectId: string, sourceFieldName: string): string {
  return `${sourceObjectId}::${sourceFieldName}`
}

export function decodeField(val: string): { sourceObjectId: string; sourceFieldName: string } {
  const sep = val.indexOf('::')
  return { sourceObjectId: val.slice(0, sep), sourceFieldName: val.slice(sep + 2) }
}

// ── Upstream source discovery ─────────────────────────────────────────────────

/** Finds all upstream sourceObject IDs reachable from nodeId, ignoring handle.
 *  An appendOperator is treated as a single source boundary: only its first
 *  upstream source is returned (all appended sources share the same schema). */
export function findUpstreamSourceIds(nodeId: string, nodes: Node[], edges: Edge[]): string[] {
  const inEdges = edges.filter(e => e.target === nodeId)
  const result: string[] = []
  for (const edge of inEdges) {
    const srcNode = nodes.find(n => n.id === edge.source)
    if (!srcNode) continue
    if (srcNode.type === 'sourceObject') {
      const objId = (srcNode.data as Record<string, unknown>).objectId as string
      if (objId) result.push(objId)
    } else if (srcNode.type === 'appendOperator') {
      // Append unions have a shared schema — expose only the first source
      const firstSource = findUpstreamSourceIds(srcNode.id, nodes, edges)
      if (firstSource.length > 0) result.push(firstSource[0])
    } else {
      result.push(...findUpstreamSourceIds(srcNode.id, nodes, edges))
    }
  }
  return [...new Set(result)]
}

/**
 * Finds upstream sourceObject IDs that feed into a specific input handle on nodeId.
 * Used by JoinPanel to separate input-a vs input-b sides.
 */
export function findUpstreamByHandle(
  nodeId: string,
  handleId: string,
  nodes: Node[],
  edges: Edge[],
): string[] {
  const inEdges = edges.filter(e => e.target === nodeId && e.targetHandle === handleId)
  const result: string[] = []
  for (const edge of inEdges) {
    const srcNode = nodes.find(n => n.id === edge.source)
    if (!srcNode) continue
    if (srcNode.type === 'sourceObject') {
      const objId = (srcNode.data as Record<string, unknown>).objectId as string
      if (objId) result.push(objId)
    } else {
      result.push(...findUpstreamSourceIds(srcNode.id, nodes, edges))
    }
  }
  return [...new Set(result)]
}

// ── Join alias group discovery ────────────────────────────────────────────────

export interface JoinAliasGroup {
  /** Virtual source ID used as key in fieldsMap — never matches a real DB object. */
  virtualId: string
  /** The aliasB prefix (e.g. "j1"). */
  aliasPrefix: string
  /** Real source object IDs on the B-side of this join (for field lookup). */
  bSourceIds: string[]
}

/**
 * Walk upstream from nodeId and collect every join node that has aliasB set.
 * Returns one group per alias, containing the prefixed virtual ID and B-side sources.
 */
export function collectJoinAliasGroups(
  nodeId: string,
  nodes: Node[],
  edges: Edge[],
): JoinAliasGroup[] {
  const groups: JoinAliasGroup[] = []
  const seenJoins = new Set<string>()

  function walk(id: string, visited = new Set<string>()) {
    if (visited.has(id)) return
    visited.add(id)

    for (const edge of edges) {
      if (edge.target !== id) continue
      const srcNode = nodes.find(n => n.id === edge.source)
      if (!srcNode) continue

      if (srcNode.type === 'joinOperator') {
        if (!seenJoins.has(srcNode.id)) {
          seenJoins.add(srcNode.id)
          const aliasB = ((srcNode.data as Record<string, unknown>).aliasB as string | undefined)?.trim()
          if (aliasB) {
            const bEdge = edges.find(e => e.target === srcNode.id && e.targetHandle === 'input-b')
            const bSourceIds = bEdge ? findUpstreamSourceIds(bEdge.source, nodes, edges) : []
            if (bSourceIds.length > 0) {
              groups.push({ virtualId: `_join_alias_${aliasB}`, aliasPrefix: aliasB, bSourceIds })
            }
          }
        }
        walk(srcNode.id, new Set(visited))
      } else {
        walk(srcNode.id, visited)
      }
    }
  }

  walk(nodeId)
  return groups
}

// ── SourceFieldPicker ─────────────────────────────────────────────────────────

export function SourceFieldPicker({
  value,
  sourceObjects,
  fieldsMap,
  upstreamSourceIds,
  onChange,
  placeholder = '— pick source field —',
  className = '',
  sourceGroupLabels = {},
}: {
  value: string
  sourceObjects: DataObject[]
  fieldsMap: Record<string, ObjectField[]>
  upstreamSourceIds: string[]
  onChange: (val: string) => void
  placeholder?: string
  className?: string
  /** Override the optgroup label for a given source object ID (e.g. Append node name). */
  sourceGroupLabels?: Record<string, string>
}) {
  if (upstreamSourceIds.length === 0) {
    return <span className="text-amber-500 text-xs italic">no source connected</span>
  }
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400 min-w-0 ${className}`}
    >
      <option value="">{placeholder}</option>
      {upstreamSourceIds.map(objId => {
        const obj = sourceObjects.find(o => o.id === objId)
        const fields = fieldsMap[objId] ?? []
        if (fields.length === 0) return null
        const groupLabel = sourceGroupLabels[objId] ?? obj?.name ?? objId
        return (
          <optgroup key={objId} label={groupLabel}>
            {fields.map(f => (
              <option key={f.id} value={encodeField(objId, f.name)}>{f.name}</option>
            ))}
          </optgroup>
        )
      })}
    </select>
  )
}
