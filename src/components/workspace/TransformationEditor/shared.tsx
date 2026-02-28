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

/** Finds all upstream sourceObject IDs reachable from nodeId, ignoring handle. */
export function findUpstreamSourceIds(nodeId: string, nodes: Node[], edges: Edge[]): string[] {
  const inEdges = edges.filter(e => e.target === nodeId)
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

// ── SourceFieldPicker ─────────────────────────────────────────────────────────

export function SourceFieldPicker({
  value,
  sourceObjects,
  fieldsMap,
  upstreamSourceIds,
  onChange,
  placeholder = '— pick source field —',
  className = '',
}: {
  value: string
  sourceObjects: DataObject[]
  fieldsMap: Record<string, ObjectField[]>
  upstreamSourceIds: string[]
  onChange: (val: string) => void
  placeholder?: string
  className?: string
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
        return (
          <optgroup key={objId} label={obj?.name ?? objId}>
            {fields.map(f => (
              <option key={f.id} value={encodeField(objId, f.name)}>{f.name}</option>
            ))}
          </optgroup>
        )
      })}
    </select>
  )
}
