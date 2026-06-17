/**
 * Shared utilities for TransformationEditor panels (Map, Join, Filter).
 */
import { useState, useRef, useEffect } from 'react'
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

    // Process the current node itself if it is a join operator — this handles the case
    // where the caller passes a joinOperator node ID directly (e.g. when the A-side of
    // an outer join connects straight to an inner join with aliasB set, and there is no
    // intermediate filter/dedup node in between).
    const selfNode = nodes.find(n => n.id === id)
    if (selfNode?.type === 'joinOperator' && !seenJoins.has(id)) {
      seenJoins.add(id)
      const aliasB = ((selfNode.data as Record<string, unknown>).aliasB as string | undefined)?.trim()
      if (aliasB) {
        const bSourceIds = findUpstreamByHandle(id, 'input-b', nodes, edges)
        if (bSourceIds.length > 0) {
          groups.push({ virtualId: `_join_alias_${aliasB}`, aliasPrefix: aliasB, bSourceIds })
        }
      }
    }

    for (const edge of edges) {
      if (edge.target !== id) continue
      const srcNode = nodes.find(n => n.id === edge.source)
      if (!srcNode) continue

      if (srcNode.type === 'joinOperator') {
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
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  // Build groups from upstream sources
  const groups = upstreamSourceIds.flatMap(objId => {
    const fields = fieldsMap[objId] ?? []
    if (fields.length === 0) return []
    const label = sourceGroupLabels[objId] ?? sourceObjects.find(o => o.id === objId)?.name ?? objId
    return [{ objId, label, fields }]
  })

  const q = search.toLowerCase()
  const filteredGroups = groups
    .map(g => ({ ...g, fields: q ? g.fields.filter(f => f.name.toLowerCase().includes(q)) : g.fields }))
    .filter(g => g.fields.length > 0)

  // Display label for current value
  let displayLabel = ''
  if (value) {
    for (const g of groups) {
      const f = g.fields.find(f => encodeField(g.objId, f.name) === value)
      if (f) { displayLabel = groups.length > 1 ? `${g.label} › ${f.name}` : f.name; break }
    }
  }

  const openDropdown = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 220) })
    setSearch('')
    setOpen(true)
  }

  const closeDropdown = () => setOpen(false)

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!triggerRef.current?.contains(e.target as globalThis.Node) && !dropdownRef.current?.contains(e.target as globalThis.Node))
        setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (upstreamSourceIds.length === 0) {
    return <span className="text-amber-500 text-xs italic">no source connected</span>
  }

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => open ? closeDropdown() : openDropdown()}
        className="w-full flex items-center justify-between gap-1.5 border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400 text-left"
      >
        <span className={`truncate min-w-0 ${displayLabel ? 'text-gray-800' : 'text-gray-400'}`}>
          {displayLabel || placeholder}
        </span>
        <span className="text-gray-300 shrink-0 text-xs">▾</span>
      </button>

      {open && pos && (
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
          className="bg-white border border-gray-200 rounded-lg shadow-xl flex flex-col max-h-64"
        >
          <div className="p-1.5 border-b border-gray-100 shrink-0">
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search fields…"
              className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>
          <div className="overflow-y-auto flex-1">
            <button
              type="button"
              onClick={() => { onChange(''); closeDropdown() }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-50 italic border-b border-gray-50"
            >
              {placeholder}
            </button>
            {filteredGroups.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-300 italic">No fields match</div>
            )}
            {filteredGroups.map(g => (
              <div key={g.objId}>
                {groups.length > 1 && (
                  <div className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 sticky top-0">
                    {g.label}
                  </div>
                )}
                {g.fields.map(f => {
                  const encoded = encodeField(g.objId, f.name)
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => { onChange(encoded); closeDropdown() }}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-violet-50 hover:text-violet-700 transition-colors ${encoded === value ? 'bg-violet-50 text-violet-700 font-medium' : 'text-gray-700'}`}
                    >
                      {f.name}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
