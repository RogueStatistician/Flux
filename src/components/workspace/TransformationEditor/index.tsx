/**
 * TransformationEditor — pipeline-style React Flow canvas.
 *
 * Layout:
 *   Left dock  : Source objects + operator buttons (Join, Filter)
 *   Canvas     : React Flow with Source / Target / Map / Join / Filter nodes
 *   Right dock : Target objects
 *
 * Interactions:
 *   - Click source/target in dock → add compact node to canvas (click again removes)
 *   - Click target in right dock → also auto-creates a linked MapNode
 *   - Add Join / Filter from left dock operator section
 *   - Draw edges between nodes to wire up the pipeline
 *   - Click MapNode → opens MapPanel for per-field rule config
 *   - Delete key removes selected nodes/edges
 */
import { platform } from '@/platform/index'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react'
import type { DataObject, FieldMapping, ObjectField, Transformation } from '../../../types/index.js'
import { EditorContext, type EditorContextValue } from './context.js'
import { SourceObjectNode } from './nodes/SourceObjectNode.js'
import { TargetObjectNode } from './nodes/TargetObjectNode.js'
import { MapOperatorNode, type MapNodeData } from './nodes/MapOperatorNode.js'
import { JoinOperatorNode } from './nodes/JoinOperatorNode.js'
import { FilterOperatorNode } from './nodes/FilterOperatorNode.js'
import { AppendOperatorNode } from './nodes/AppendOperatorNode.js'
import type { AppendNodeData } from './nodes/AppendOperatorNode.js'
import { DeduplicateOperatorNode } from './nodes/DeduplicateOperatorNode.js'
import type { DeduplicateNodeData } from './nodes/DeduplicateOperatorNode.js'
import { MapPanel } from './MapPanel.js'
import { JoinPanel } from './JoinPanel.js'
import { FilterPanel } from './FilterPanel.js'
import { DeduplicatePanel } from './DeduplicatePanel.js'
import { PipelineEdge } from './PipelineEdge.js'
import type { JoinNodeData } from './nodes/JoinOperatorNode.js'
import type { FilterNodeData } from './nodes/FilterOperatorNode.js'
import { NodeContextMenu } from './nodes/NodeContextMenu.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const SAVE_DEBOUNCE_MS = 600

const NODE_TYPES = {
  sourceObject:    SourceObjectNode,
  targetObject:    TargetObjectNode,
  mapOperator:     MapOperatorNode,
  joinOperator:    JoinOperatorNode,
  filterOperator:      FilterOperatorNode,
  appendOperator:      AppendOperatorNode,
  dedupOperator:       DeduplicateOperatorNode,
}

const EDGE_TYPES = {
  pipeline: PipelineEdge,
}

const OPERATOR_TYPES = new Set(['joinOperator', 'filterOperator', 'appendOperator', 'dedupOperator'])

// ── Edge style helpers ────────────────────────────────────────────────────────

function pipelineEdge(overrides?: Partial<Edge>): Partial<Edge> {
  return {
    type: 'pipeline',
    style: { stroke: '#8b5cf6', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#8b5cf6' },
    ...overrides,
  }
}

// ── Canvas state helpers ──────────────────────────────────────────────────────

interface SavedNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

interface SavedCanvas {
  nodes: SavedNode[]
  edges: Array<{
    id: string
    source: string
    sourceHandle?: string
    target: string
    targetHandle?: string
  }>
}

/** Count field mapping rules that belong to a specific MapNode.
 *  Handles both node-scoped rules (mapNodeId set) and legacy null-scoped rules
 *  (only the primary MapNode `map-{targetObjectId}` inherits those). */
function countRulesForMapNode(mapNodeId: string, targetObjectId: string, fieldMappings: FieldMapping[]): number {
  return fieldMappings.filter(m =>
    m.mapNodeId === mapNodeId ||
    (!m.mapNodeId && m.targetObjectId === targetObjectId && mapNodeId === `map-${targetObjectId}`)
  ).length
}

function restoreCanvas(
  raw: string | undefined,
  allObjects: DataObject[],
  fieldMappings: FieldMapping[],
  fieldsMap: Record<string, ObjectField[]>,
): { nodes: Node[]; edges: Edge[] } {
  if (!raw) return { nodes: [], edges: [] }
  try {
    const saved = JSON.parse(raw) as Partial<SavedCanvas>
    const savedNodes = saved.nodes ?? []

    // Detect new multi-type format vs old per-field format
    const isNewFormat = savedNodes.some(n => typeof n.type === 'string')

    if (isNewFormat) {
      const nodes: Node[] = savedNodes.flatMap(sn => {
        if (sn.type === 'sourceObject' || sn.type === 'targetObject') {
          const objId = sn.data.objectId as string
          const obj = allObjects.find(o => o.id === objId)
          if (!obj) return []
          const columnCount = fieldsMap[obj.id]?.length ?? 0
          return [{ id: sn.id, type: sn.type, position: sn.position, data: { objectId: obj.id, name: obj.name, systemName: obj.systemName, columnCount } }]
        }
        if (sn.type === 'mapOperator') {
          const targetObjectId = sn.data.targetObjectId as string
          const ruleCount = countRulesForMapNode(sn.id, targetObjectId, fieldMappings)
          return [{ id: sn.id, type: sn.type, position: sn.position, data: { ...sn.data, ruleCount } }]
        }
        // joinOperator / filterOperator / appendOperator: restore as-is
        return [{ id: sn.id, type: sn.type, position: sn.position, data: sn.data }]
      })

      const edges: Edge[] = (saved.edges ?? []).map(se => ({
        ...pipelineEdge(),
        id: se.id,
        source: se.source,
        sourceHandle: se.sourceHandle,
        target: se.target,
        targetHandle: se.targetHandle,
      })) as Edge[]

      return { nodes, edges }
    } else {
      // Old format (pre-operator, per-field handles): restore object positions only, drop edges
      const nodes: Node[] = savedNodes.flatMap(sn => {
        if (!sn.id) return []
        const isSource = sn.id.startsWith('src-')
        const objId = sn.id.slice(4)
        const obj = allObjects.find(o => o.id === objId)
        if (!obj) return []
        const columnCount = fieldsMap[obj.id]?.length ?? 0
        return [{ id: sn.id, type: isSource ? 'sourceObject' : 'targetObject', position: sn.position, data: { objectId: obj.id, name: obj.name, systemName: obj.systemName, columnCount } }]
      })
      return { nodes, edges: [] }
    }
  } catch {
    return { nodes: [], edges: [] }
  }
}

function serializeCanvas(nodes: Node[], edges: Edge[]): string {
  const saveNodes: SavedNode[] = nodes.map(n => ({
    id: n.id,
    type: n.type ?? 'unknown',
    position: n.position,
    data: (({ _renaming, ...rest }) => rest)(n.data as Record<string, unknown>),
  }))
  const saveEdges = edges.map(e => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle ?? undefined,
    target: e.target,
    targetHandle: e.targetHandle ?? undefined,
  }))
  return JSON.stringify({ nodes: saveNodes, edges: saveEdges })
}

// ── Dock item ─────────────────────────────────────────────────────────────────

function DockItem({
  label,
  sub,
  columnCount,
  onCanvas,
  role,
  onClick,
}: {
  label: string
  sub?: string
  columnCount?: number
  onCanvas: boolean
  role: 'source' | 'target'
  onClick: () => void
}) {
  const isSource = role === 'source'
  const activeClass = isSource
    ? 'bg-blue-100 text-blue-800 border-blue-200'
    : 'bg-emerald-100 text-emerald-800 border-emerald-200'
  const idleClass = 'text-gray-600 hover:bg-gray-100 border-transparent'

  return (
    <button
      onClick={onClick}
      title={onCanvas ? 'Click to remove from canvas' : 'Click to add to canvas'}
      className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium transition-colors mb-1 border ${onCanvas ? activeClass : idleClass}`}
    >
      <span className="break-words block">{label}</span>
      {sub && <span className="text-xs opacity-50 font-normal break-words block">{sub}</span>}
      <span className="flex items-center justify-between mt-0.5">
        {onCanvas && <span className="text-xs opacity-50 font-normal">on canvas</span>}
        {columnCount !== undefined && (
          <span className="text-xs opacity-40 font-normal ml-auto">{columnCount} col{columnCount !== 1 ? 's' : ''}</span>
        )}
      </span>
    </button>
  )
}

// ── Main editor ───────────────────────────────────────────────────────────────

interface Props {
  transformationId: string
  onBack: () => void
}

export function TransformationEditor({ transformationId, onBack }: Props) {
  const [transformation, setTransformation] = useState<Transformation | null>(null)
  const [allObjects, setAllObjects] = useState<DataObject[]>([])
  const [fieldsMap, setFieldsMap] = useState<Record<string, ObjectField[]>>({})
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Panel state
  const [mapPanel, setMapPanel] = useState<{ mapNodeId: string; targetObjectId: string } | null>(null)
  const [joinPanel, setJoinPanel] = useState<{ joinNodeId: string } | null>(null)
  const [filterPanel, setFilterPanel] = useState<{ filterNodeId: string } | null>(null)
  const [dedupPanel, setDedupPanel] = useState<{ dedupNodeId: string } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ nodeId: string; nodeType: string; x: number; y: number } | null>(null)
  const [canvasError, setCanvasError] = useState<string | null>(null)

  const [nodes, setNodes] = useNodesState<Node>([])
  const [edges, setEdges] = useEdgesState<Edge>([])

  const nodesRef = useRef<Node[]>([])
  const edgesRef = useRef<Edge[]>([])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear any pending save on unmount to avoid calling setters on an unmounted component
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  // Keep refs in sync
  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { edgesRef.current = edges }, [edges])

  // ── Load ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [t, objects] = await Promise.all([
          platform.getTransformation(transformationId),
          platform.listObjects(),
        ])
        const fieldResults = await Promise.all(objects.map(o => platform.getObject(o.id)))
        const fMap: Record<string, ObjectField[]> = {}
        fieldResults.forEach(r => { fMap[r.object.id] = r.fields })
        const mappings = await platform.getFieldMappings(transformationId)
        if (cancelled) return

        setTransformation(t)
        setAllObjects(objects)
        setFieldsMap(fMap)
        setFieldMappings(mappings)

        const { nodes: restoredNodes, edges: restoredEdges } = restoreCanvas(t.canvasState, objects, mappings, fMap)
        setNodes(restoredNodes)
        setEdges(restoredEdges)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [transformationId])

  // ── Sync MapNode rule counts when fieldMappings change ────────────────────

  useEffect(() => {
    setNodes(nds => nds.map(n => {
      if (n.type !== 'mapOperator') return n
      const d = n.data as unknown as MapNodeData
      const count = countRulesForMapNode(n.id, d.targetObjectId, fieldMappings)
      if (count === d.ruleCount) return n
      return { ...n, data: { ...n.data, ruleCount: count } }
    }))
  }, [fieldMappings])

  // ── Auto-save canvas ───────────────────────────────────────────────────────

  const scheduleSave = useCallback((currentNodes: Node[], currentEdges: Edge[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      platform.saveCanvas(transformationId, serializeCanvas(currentNodes, currentEdges))
        .then(() => setCanvasError(null))
        .catch(err => setCanvasError(`Canvas save failed: ${err instanceof Error ? err.message : String(err)}`))
    }, SAVE_DEBOUNCE_MS)
  }, [transformationId])

  // ── Node / edge change handlers ────────────────────────────────────────────

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    // Before applying changes, detect mapOperator nodes being removed via Delete key.
    // Their field_mappings must be purged from the DB so the engine won't output them.
    const removedMapNodeIds = changes
      .filter(c => c.type === 'remove')
      .map(c => c.id)
      .filter(id => nodesRef.current.find(n => n.id === id)?.type === 'mapOperator')

    for (const nodeId of removedMapNodeIds) {
      const node = nodesRef.current.find(n => n.id === nodeId)
      const targetObjectId = (node?.data as Record<string, unknown> | undefined)?.targetObjectId as string | undefined
      if (!targetObjectId) continue

      // Check whether other MapNodes for the same target still exist after this removal.
      const otherMapNodes = nodesRef.current.filter(n =>
        n.type === 'mapOperator' &&
        n.id !== nodeId &&
        (n.data as Record<string, unknown>).targetObjectId === targetObjectId
      )

      if (otherMapNodes.length > 0) {
        // Scoped delete: only this node's rules (keep sibling MapNode rules intact).
        platform.deleteFieldMappingsByNode(nodeId)
          .then(() => setFieldMappings(prev => prev.filter(m => m.mapNodeId !== nodeId)))
          .catch(err => setCanvasError(`Failed to delete mappings: ${err instanceof Error ? err.message : String(err)}`))
      } else {
        // Last MapNode for target: full delete (covers both new-style and legacy null-scoped rows).
        platform.deleteFieldMappingsByTarget(transformationId, targetObjectId)
          .then(() => setFieldMappings(prev => prev.filter(m => m.targetObjectId !== targetObjectId)))
          .catch(err => setCanvasError(`Failed to delete mappings: ${err instanceof Error ? err.message : String(err)}`))
      }
    }

    setNodes(nds => {
      const updated = applyNodeChanges(changes, nds)
      scheduleSave(updated, edgesRef.current)
      return updated
    })
  }, [scheduleSave, transformationId])

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    // Mappings are preserved when edges are removed — the MapPanel shows broken-ref warnings
    // instead of deleting rules. Rules are only deleted when a MapNode or target is explicitly removed.
    setEdges(eds => {
      const updated = applyEdgeChanges(changes, eds)
      scheduleSave(nodesRef.current, updated)
      return updated
    })
  }, [scheduleSave])

  // ── Connect handler — creates canvas edge only (no field_mappings) ─────────

  const onConnect = useCallback((conn: Connection) => {
    const { source, target, sourceHandle, targetHandle } = conn
    if (!source || !target) return

    // Prevent duplicate connections on the same handle pair
    if (edgesRef.current.some(e =>
      e.source === source && e.target === target &&
      e.sourceHandle === sourceHandle && e.targetHandle === targetHandle
    )) return

    // Prevent multiple inputs to a MapNode (each MapNode has exactly one source pipeline)
    const targetNode = nodesRef.current.find(n => n.id === target)
    if (targetNode?.type === 'mapOperator' && edgesRef.current.some(e => e.target === target)) return

    const newEdge: Edge = {
      ...pipelineEdge() as Edge,
      id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source,
      target,
      sourceHandle: sourceHandle ?? undefined,
      targetHandle: targetHandle ?? undefined,
    }

    setEdges(eds => {
      const updated = addEdge(newEdge, eds)
      scheduleSave(nodesRef.current, updated)
      return updated
    })
  }, [scheduleSave])

  // ── Dock: add / remove sources ────────────────────────────────────────────

  const handleDockSource = useCallback((obj: DataObject) => {
    const nodeId = `src-${obj.id}`
    const isOnCanvas = nodesRef.current.some(n => n.id === nodeId)

    if (isOnCanvas) {
      // Remove the node and its edges — mappings are preserved (column-name based).
      // The MapPanel will flag any rules that reference fields no longer available.
      setNodes(nds => {
        const updated = nds.filter(n => n.id !== nodeId)
        scheduleSave(updated, edgesRef.current)
        return updated
      })
      setEdges(eds => {
        const updated = eds.filter(e => e.source !== nodeId && e.target !== nodeId)
        scheduleSave(nodesRef.current, updated)
        return updated
      })
    } else {
      const srcCount = nodesRef.current.filter(n => n.type === 'sourceObject').length
      const newNode: Node = {
        id: nodeId,
        type: 'sourceObject',
        position: { x: 60, y: 80 + srcCount * 130 },
        data: { objectId: obj.id, name: obj.name, systemName: obj.systemName, columnCount: fieldsMap[obj.id]?.length ?? 0 },
      }
      setNodes(nds => {
        const updated = [...nds, newNode]
        scheduleSave(updated, edgesRef.current)
        return updated
      })
    }
  }, [scheduleSave])

  // ── Dock: add / remove targets (auto-creates MapNode + edge) ──────────────

  const handleDockTarget = useCallback((obj: DataObject) => {
    const tgtNodeId = `tgt-${obj.id}`
    const isOnCanvas = nodesRef.current.some(n => n.id === tgtNodeId)

    if (isOnCanvas) {
      // Remove target node AND all its MapNodes (there may be multiple)
      const mapNodeIdsToRemove = nodesRef.current
        .filter(n => n.type === 'mapOperator' && (n.data as Record<string, unknown>).targetObjectId === obj.id)
        .map(n => n.id)
      const idsToRemove = new Set([tgtNodeId, ...mapNodeIdsToRemove])

      setNodes(nds => {
        const updated = nds.filter(n => !idsToRemove.has(n.id))
        scheduleSave(updated, edgesRef.current)
        return updated
      })
      setEdges(eds => {
        const updated = eds.filter(e => !idsToRemove.has(e.source) && !idsToRemove.has(e.target))
        scheduleSave(nodesRef.current, updated)
        return updated
      })
      // Delete ALL field mapping rules for this target (all MapNodes + legacy null-scoped)
      platform.deleteFieldMappingsByTarget(transformationId, obj.id).then(() => {
        setFieldMappings(prev => prev.filter(m => m.targetObjectId !== obj.id))
      }).catch(err => setCanvasError(`Failed to delete mappings: ${err instanceof Error ? err.message : String(err)}`))
    } else {
      const firstMapNodeId = `map-${obj.id}`
      const tgtCount = nodesRef.current.filter(n => n.type === 'targetObject').length
      const y = 80 + tgtCount * 150
      const ruleCount = countRulesForMapNode(firstMapNodeId, obj.id, fieldMappings)

      const mapNode: Node = {
        id: firstMapNodeId,
        type: 'mapOperator',
        position: { x: 440, y },
        data: { targetObjectId: obj.id, targetObjectName: obj.name, ruleCount },
      }
      const tgtNode: Node = {
        id: tgtNodeId,
        type: 'targetObject',
        position: { x: 680, y },
        data: { objectId: obj.id, name: obj.name, systemName: obj.systemName, columnCount: fieldsMap[obj.id]?.length ?? 0 },
      }
      const linkEdge: Edge = {
        ...pipelineEdge() as Edge,
        id: `e-${firstMapNodeId}-${tgtNodeId}`,
        source: firstMapNodeId,
        sourceHandle: 'output',
        target: tgtNodeId,
        targetHandle: 'input',
      }

      setNodes(nds => {
        const updated = [...nds, mapNode, tgtNode]
        scheduleSave(updated, [...edgesRef.current, linkEdge])
        return updated
      })
      setEdges(eds => [...eds, linkEdge])
    }
  }, [fieldMappings, scheduleSave])

  // ── Add operator nodes ─────────────────────────────────────────────────────

  const handleAddJoin = useCallback(() => {
    const id = `join-${Date.now()}`
    const opCount = nodesRef.current.filter(n => n.type === 'joinOperator' || n.type === 'filterOperator').length
    const joinCount = nodesRef.current.filter(n => n.type === 'joinOperator').length
    const newNode: Node = {
      id,
      type: 'joinOperator',
      position: { x: 240, y: 80 + opCount * 140 },
      data: { joinType: 'left', joinKeyA: '', joinKeyB: '', aliasB: `j${joinCount + 1}` },
    }
    setNodes(nds => {
      const updated = [...nds, newNode]
      scheduleSave(updated, edgesRef.current)
      return updated
    })
  }, [scheduleSave])

  const handleAddFilter = useCallback(() => {
    const id = `filter-${Date.now()}`
    const opCount = nodesRef.current.filter(n => n.type === 'joinOperator' || n.type === 'filterOperator').length
    const newNode: Node = {
      id,
      type: 'filterOperator',
      position: { x: 240, y: 80 + opCount * 140 },
      data: { conditions: [] },
    }
    setNodes(nds => {
      const updated = [...nds, newNode]
      scheduleSave(updated, edgesRef.current)
      return updated
    })
  }, [scheduleSave])

  const handleAddAppend = useCallback(() => {
    const id = `append-${Date.now()}`
    const opCount = nodesRef.current.filter(n => n.type === 'joinOperator' || n.type === 'filterOperator' || n.type === 'appendOperator').length
    const newNode: Node = {
      id,
      type: 'appendOperator',
      position: { x: 240, y: 80 + opCount * 140 },
      data: { inputCount: 2 } satisfies AppendNodeData,
    }
    setNodes(nds => {
      const updated = [...nds, newNode]
      scheduleSave(updated, edgesRef.current)
      return updated
    })
  }, [scheduleSave])

  const handleAddDedup = useCallback(() => {
    const id = `dedup-${Date.now()}`
    const opCount = nodesRef.current.filter(n => n.type === 'joinOperator' || n.type === 'filterOperator' || n.type === 'appendOperator' || n.type === 'dedupOperator').length
    const newNode: Node = {
      id,
      type: 'dedupOperator',
      position: { x: 240, y: 80 + opCount * 140 },
      data: {} satisfies DeduplicateNodeData,
    }
    setNodes(nds => {
      const updated = [...nds, newNode]
      scheduleSave(updated, edgesRef.current)
      return updated
    })
  }, [scheduleSave])

  /** Add a second (or Nth) MapNode for a target that is already on the canvas. */
  const handleAddMapForTarget = useCallback((obj: DataObject) => {
    const tgtNodeId = `tgt-${obj.id}`
    if (!nodesRef.current.some(n => n.id === tgtNodeId)) return
    const mapNodeId = `map-${obj.id}-${Date.now()}`
    const existingMaps = nodesRef.current.filter(n => n.type === 'mapOperator' && (n.data as Record<string, unknown>).targetObjectId === obj.id)
    const lastY = existingMaps.reduce((maxY, n) => Math.max(maxY, n.position.y), 80)
    const mapNode: Node = {
      id: mapNodeId,
      type: 'mapOperator',
      position: { x: 440, y: lastY + 155 },
      data: { targetObjectId: obj.id, targetObjectName: obj.name, ruleCount: 0 },
    }
    const linkEdge: Edge = {
      ...pipelineEdge() as Edge,
      id: `e-${mapNodeId}-${tgtNodeId}`,
      source: mapNodeId,
      sourceHandle: 'output',
      target: tgtNodeId,
      targetHandle: 'input',
    }
    setNodes(nds => {
      const updated = [...nds, mapNode]
      scheduleSave(updated, [...edgesRef.current, linkEdge])
      return updated
    })
    setEdges(eds => [...eds, linkEdge])
  }, [scheduleSave])

  /** Increment the input slot count on an Append node. */
  const onAppendAddInput = useCallback((appendNodeId: string) => {
    setNodes(nds => {
      const updated = nds.map(n => {
        if (n.id !== appendNodeId) return n
        const d = n.data as unknown as AppendNodeData
        return { ...n, data: { ...n.data, inputCount: Math.min((d.inputCount ?? 2) + 1, 8) } }
      })
      scheduleSave(updated, edgesRef.current)
      return updated
    })
  }, [scheduleSave])

  /** Update the label of any operator node and clear the _renaming flag. */
  const onNodeRename = useCallback((nodeId: string, label: string) => {
    const trimmed = label.trim()
    // Only check uniqueness for non-empty labels
    if (trimmed) {
      const duplicate = nodesRef.current.find(n =>
        n.id !== nodeId &&
        OPERATOR_TYPES.has(n.type ?? '') &&
        ((n.data as Record<string, unknown>).label as string | undefined)?.trim() === trimmed
      )
      if (duplicate) {
        setCanvasError(`A node named "${trimmed}" already exists in this transformation.`)
        return // Keep the node in _renaming state
      }
    }
    setCanvasError(null)
    setNodes(nds => {
      const updated = nds.map(n => n.id !== nodeId ? n : { ...n, data: { ...n.data, label: trimmed, _renaming: undefined } })
      scheduleSave(updated, edgesRef.current)
      return updated
    })
  }, [scheduleSave])

  const handleContextMenuRename = useCallback((nodeId: string) => {
    setCtxMenu(null)
    setNodes(nds => nds.map(n => n.id !== nodeId ? n : { ...n, data: { ...n.data, _renaming: true } }))
  }, [])

  const handleContextMenuDelete = useCallback((nodeId: string, nodeType: string) => {
    setCtxMenu(null)
    // DB cleanup for mapOperator (mirrors handleNodesChange logic)
    if (nodeType === 'mapOperator') {
      const node = nodesRef.current.find(n => n.id === nodeId)
      const targetObjectId = (node?.data as Record<string, unknown>)?.targetObjectId as string | undefined
      if (targetObjectId) {
        const otherMaps = nodesRef.current.filter(n =>
          n.type === 'mapOperator' && n.id !== nodeId &&
          (n.data as Record<string, unknown>).targetObjectId === targetObjectId
        )
        if (otherMaps.length > 0) {
          platform.deleteFieldMappingsByNode(nodeId)
            .then(() => setFieldMappings(prev => prev.filter(m => m.mapNodeId !== nodeId)))
            .catch(err => setCanvasError(`Failed to delete mappings: ${err instanceof Error ? err.message : String(err)}`))
        } else {
          platform.deleteFieldMappingsByTarget(transformationId, targetObjectId)
            .then(() => setFieldMappings(prev => prev.filter(m => m.targetObjectId !== targetObjectId)))
            .catch(err => setCanvasError(`Failed to delete mappings: ${err instanceof Error ? err.message : String(err)}`))
        }
      }
    }
    const connectedEdgeIds = new Set(edgesRef.current.filter(e => e.source === nodeId || e.target === nodeId).map(e => e.id))
    setEdges(eds => eds.filter(e => !connectedEdgeIds.has(e.id)))
    setNodes(nds => {
      const updated = nds.filter(n => n.id !== nodeId)
      scheduleSave(updated, edgesRef.current.filter(e => !connectedEdgeIds.has(e.id)))
      return updated
    })
  }, [scheduleSave, transformationId])

  // ── Panel callbacks ────────────────────────────────────────────────────────

  const onMapNodeClick = useCallback((mapNodeId: string, targetObjectId: string) => {
    setMapPanel({ mapNodeId, targetObjectId })
  }, [])

  const handleMapPanelSaved = useCallback((newMappings: FieldMapping[]) => {
    setFieldMappings(newMappings)
  }, [])

  const onJoinNodeClick = useCallback((joinNodeId: string) => {
    setJoinPanel({ joinNodeId })
  }, [])

  const handleJoinSave = useCallback((data: JoinNodeData) => {
    setNodes((nds: Node[]) => {
      const updated = nds.map((n: Node) => n.id === joinPanel?.joinNodeId ? { ...n, data: { ...data } } : n)
      scheduleSave(updated, edgesRef.current)
      return updated
    })
    setJoinPanel(null)
  }, [joinPanel, scheduleSave])

  const onFilterNodeClick = useCallback((filterNodeId: string) => {
    setFilterPanel({ filterNodeId })
  }, [])

  const handleFilterSave = useCallback((data: FilterNodeData) => {
    setNodes((nds: Node[]) => {
      const updated = nds.map((n: Node) => n.id === filterPanel?.filterNodeId ? { ...n, data: { ...data } } : n)
      scheduleSave(updated, edgesRef.current)
      return updated
    })
    setFilterPanel(null)
  }, [filterPanel, scheduleSave])

  const onDedupNodeClick = useCallback((dedupNodeId: string) => {
    setDedupPanel({ dedupNodeId })
  }, [])

  const handleDedupSave = useCallback((data: DeduplicateNodeData) => {
    setNodes((nds: Node[]) => {
      const updated = nds.map((n: Node) => n.id === dedupPanel?.dedupNodeId ? { ...n, data: { ...data } } : n)
      scheduleSave(updated, edgesRef.current)
      return updated
    })
    setDedupPanel(null)
  }, [dedupPanel, scheduleSave])

  // ── Context ────────────────────────────────────────────────────────────────

  const ctxValue = useMemo<EditorContextValue>(
    () => ({ onMapNodeClick, onJoinNodeClick, onFilterNodeClick, onDedupNodeClick, onAppendAddInput, onNodeRename }),
    [onMapNodeClick, onJoinNodeClick, onFilterNodeClick, onDedupNodeClick, onAppendAddInput, onNodeRename],
  )

  // ── Derived ────────────────────────────────────────────────────────────────

  const sourceObjects = allObjects.filter(o => o.role === 'source')
  const targetObjects = allObjects.filter(o => o.role === 'target')
  const canvasNodeIds = new Set(nodes.map(n => n.id))
  const totalRules = fieldMappings.length

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 gap-2">
        <span className="animate-spin text-lg">⟳</span>
        <span className="text-sm">Loading editor…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-500 mb-3">{error}</p>
          <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Top bar */}
      <div className="px-4 py-2.5 border-b bg-white shrink-0 flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          ← Transformations
        </button>
        <span className="text-gray-200">|</span>
        <span className="text-sm font-semibold text-gray-800">{transformation?.name}</span>
        <div className="ml-auto text-xs text-gray-400">
          {totalRules} rule{totalRules !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left dock — Sources + Operators */}
        <div className="w-44 shrink-0 overflow-y-auto border-r border-gray-100 bg-gray-50 p-3 flex flex-col gap-4">

          {/* Sources */}
          <div>
            <p className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-2">Sources</p>
            {sourceObjects.length === 0 ? (
              <p className="text-xs text-gray-300 italic">No source objects</p>
            ) : (
              sourceObjects.map(obj => (
                <DockItem
                  key={obj.id}
                  label={obj.name}
                  sub={obj.systemName}
                  columnCount={fieldsMap[obj.id]?.length}
                  role="source"
                  onCanvas={canvasNodeIds.has(`src-${obj.id}`)}
                  onClick={() => handleDockSource(obj)}
                />
              ))
            )}
          </div>

          {/* Operators */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Operators</p>
            <button
              onClick={handleAddJoin}
              className="w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 mb-1 transition-colors"
            >
              ⋈ Add Join
            </button>
            <button
              onClick={handleAddFilter}
              className="w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-colors"
            >
              ⊻ Add Filter
            </button>
            <button
              onClick={handleAddAppend}
              className="w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 mt-1 transition-colors"
            >
              ∪ Add Append
            </button>
            <button
              onClick={handleAddDedup}
              className="w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium mt-1 transition-colors"
              style={{ color: '#0f766e', background: '#f0fdfa', border: '1px solid #5eead4' }}
            >
              ◎ Add Deduplicate
            </button>
          </div>

          <div className="mt-auto pt-2 border-t border-gray-200">
            <p className="text-xs text-gray-300 leading-relaxed">
              Draw edges to wire the pipeline. Click a <span className="text-violet-400 font-medium">Map</span> node to configure field rules.
            </p>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative bg-gray-50">
          {canvasError && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-2 rounded-lg shadow-md pointer-events-none">
              {canvasError}
            </div>
          )}
          <EditorContext.Provider value={ctxValue}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              onNodeContextMenu={(e, node) => {
                if (!OPERATOR_TYPES.has(node.type ?? '') && node.type !== 'mapOperator') return
                e.preventDefault()
                setCtxMenu({ nodeId: node.id, nodeType: node.type!, x: e.clientX, y: e.clientY })
              }}
              onPaneClick={() => setCtxMenu(null)}
              fitView
              fitViewOptions={{ padding: 0.25 }}
              deleteKeyCode="Delete"
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#e5e7eb" gap={16} />
              <Controls />
              <MiniMap
                nodeColor={n =>
                  n.type === 'sourceObject'   ? '#bfdbfe' :
                  n.type === 'targetObject'   ? '#bbf7d0' :
                  n.type === 'mapOperator'    ? '#ddd6fe' :
                  n.type === 'joinOperator'   ? '#fed7aa' :
                  n.type === 'appendOperator' ? '#e2e8f0' :
                  '#fde68a'
                }
                maskColor="rgba(0,0,0,0.03)"
              />

              {nodes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <p className="text-sm text-gray-300 font-medium">Canvas is empty</p>
                    <p className="text-xs text-gray-200 mt-1">Add sources and targets from the side panels</p>
                  </div>
                </div>
              )}
            </ReactFlow>
          </EditorContext.Provider>

          {/* Node context menu (right-click on operator nodes) */}
          {ctxMenu && (
            <NodeContextMenu
              x={ctxMenu.x}
              y={ctxMenu.y}
              onRename={() => handleContextMenuRename(ctxMenu.nodeId)}
              onDelete={() => handleContextMenuDelete(ctxMenu.nodeId, ctxMenu.nodeType)}
              onClose={() => setCtxMenu(null)}
            />
          )}

          {/* MapPanel (field-rule config) */}
          {mapPanel && (
            <MapPanel
              mapNodeId={mapPanel.mapNodeId}
              targetObjectId={mapPanel.targetObjectId}
              transformationId={transformationId}
              fieldMappings={fieldMappings}
              fieldsMap={fieldsMap}
              sourceObjects={sourceObjects}
              nodes={nodes}
              edges={edges}
              onSaved={handleMapPanelSaved}
              onClose={() => setMapPanel(null)}
            />
          )}

          {/* JoinPanel (join config) */}
          {joinPanel && (() => {
            const joinNode = nodes.find((n: Node) => n.id === joinPanel.joinNodeId)
            if (!joinNode) return null
            return (
              <JoinPanel
                joinNodeId={joinPanel.joinNodeId}
                nodes={nodes}
                edges={edges}
                allObjects={allObjects}
                fieldsMap={fieldsMap}
                initialData={joinNode.data as unknown as JoinNodeData}
                onSave={handleJoinSave}
                onClose={() => setJoinPanel(null)}
              />
            )
          })()}

          {/* FilterPanel (filter config) */}
          {filterPanel && (() => {
            const filterNode = nodes.find((n: Node) => n.id === filterPanel.filterNodeId)
            if (!filterNode) return null
            return (
              <FilterPanel
                filterNodeId={filterPanel.filterNodeId}
                nodes={nodes}
                edges={edges}
                allObjects={allObjects}
                fieldsMap={fieldsMap}
                initialData={filterNode.data as unknown as FilterNodeData}
                onSave={handleFilterSave}
                onClose={() => setFilterPanel(null)}
              />
            )
          })()}

          {/* DeduplicatePanel (dedup config) */}
          {dedupPanel && (() => {
            const dedupNode = nodes.find((n: Node) => n.id === dedupPanel.dedupNodeId)
            if (!dedupNode) return null
            return (
              <DeduplicatePanel
                dedupNodeId={dedupPanel.dedupNodeId}
                nodes={nodes}
                edges={edges}
                allObjects={allObjects}
                fieldsMap={fieldsMap}
                initialData={dedupNode.data as unknown as DeduplicateNodeData}
                onSave={handleDedupSave}
                onClose={() => setDedupPanel(null)}
              />
            )
          })()}
        </div>

        {/* Right dock — Targets */}
        <div className="w-44 shrink-0 overflow-y-auto border-l border-gray-100 bg-gray-50 p-3">
          <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-2">Targets</p>
          {targetObjects.length === 0 ? (
            <p className="text-xs text-gray-300 italic">No target objects</p>
          ) : (
            targetObjects.map(obj => {
              const isOnCanvas = canvasNodeIds.has(`tgt-${obj.id}`)
              return (
                <div key={obj.id}>
                  <DockItem
                    label={obj.name}
                    sub={obj.systemName}
                    columnCount={fieldsMap[obj.id]?.length}
                    role="target"
                    onCanvas={isOnCanvas}
                    onClick={() => handleDockTarget(obj)}
                  />
                  {isOnCanvas && (
                    <button
                      onClick={() => handleAddMapForTarget(obj)}
                      title="Add another Map node for this target (different-structure source)"
                      className="w-full text-center py-0.5 -mt-0.5 mb-1.5 text-xs text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors"
                    >
                      + add mapping
                    </button>
                  )}
                </div>
              )
            })
          )}
          <p className="text-xs text-gray-300 mt-3 leading-relaxed">
            Adding a target also places a Map node on the canvas.
          </p>
        </div>

      </div>
    </div>
  )
}
