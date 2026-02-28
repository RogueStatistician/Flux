/**
 * TransformationEditor — full-screen React Flow canvas for field-mapping rules.
 *
 * Layout: Source dock (left) | Canvas | Target dock (right)
 * Rules: Draw edge source→target = Direct rule. Click ⚙ on target field = any rule.
 * Canvas state (node positions) auto-saved with 500ms debounce.
 */
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
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react'
import type { DataObject, ObjectField, FieldMapping, Transformation } from '../../../types/index.js'
import { EditorContext, type EditorContextValue } from './context.js'
import { SourceObjectNode, type SourceNodeData } from './nodes/SourceObjectNode.js'
import { TargetObjectNode, type TargetNodeData } from './nodes/TargetObjectNode.js'
import { RuleConfigPanel } from './RuleConfigPanel.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const SAVE_DEBOUNCE_MS = 500

const NODE_TYPES = {
  sourceObject: SourceObjectNode,
  targetObject: TargetObjectNode,
}

// ── Canvas state helpers ──────────────────────────────────────────────────────

interface CanvasNodePos { id: string; position: { x: number; y: number } }

function parseCanvas(raw: string | undefined): CanvasNodePos[] {
  if (!raw) return []
  try { return (JSON.parse(raw) as { nodes?: CanvasNodePos[] }).nodes ?? [] }
  catch { return [] }
}

function buildNode(
  obj: DataObject,
  fields: ObjectField[],
  position: { x: number; y: number },
  mappings: FieldMapping[]
): Node {
  const isSource = obj.role === 'source'
  const id = `${isSource ? 'src' : 'tgt'}-${obj.id}`
  if (isSource) {
    return { id, type: 'sourceObject', position, data: { objectId: obj.id, name: obj.name, systemName: obj.systemName, fields } as SourceNodeData }
  }
  return { id, type: 'targetObject', position, data: { objectId: obj.id, name: obj.name, systemName: obj.systemName, fields } as TargetNodeData }
}

function buildEdges(mappings: FieldMapping[], fieldsMap: Record<string, ObjectField[]>): Edge[] {
  return mappings.flatMap(m => {
    if (m.ruleType !== 'direct') return []
    try {
      const cfg = JSON.parse(m.ruleConfig) as { sourceObjectId?: string; sourceFieldName?: string }
      if (!cfg.sourceObjectId || !cfg.sourceFieldName) return []
      const tgtField = (fieldsMap[m.targetObjectId] ?? []).find(f => f.id === m.targetFieldId)
      if (!tgtField) return []
      return [{
        id: `edge-${m.id}`,
        source: `src-${cfg.sourceObjectId}`,
        target: `tgt-${m.targetObjectId}`,
        sourceHandle: `right-${cfg.sourceFieldName}`,
        targetHandle: `left-${tgtField.name}`,
        type: 'smoothstep',
        data: { mappingId: m.id },
        style: { stroke: '#3b82f6', strokeWidth: 1.5 },
      }]
    } catch { return [] }
  })
}

// ── Dock item ──────────────────────────────────────────────────────────────────

function DockItem({
  obj,
  onCanvas,
  onClick,
}: {
  obj: DataObject
  onCanvas: boolean
  onClick: () => void
}) {
  const isSource = obj.role === 'source'
  return (
    <button
      onClick={onClick}
      className={[
        'w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium transition-colors mb-1',
        onCanvas
          ? isSource
            ? 'bg-blue-100 text-blue-800 border border-blue-200'
            : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
          : 'text-gray-600 hover:bg-gray-100 border border-transparent',
      ].join(' ')}
      title={onCanvas ? 'Click to remove from canvas' : 'Click to add to canvas'}
    >
      <span className="truncate block">{obj.name}</span>
      {onCanvas && <span className="text-xs opacity-60 font-normal">on canvas</span>}
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

  // Rule config panel state
  const [rulePanel, setRulePanel] = useState<{
    targetObjectId: string
    field: ObjectField
    mapping: FieldMapping | undefined
  } | null>(null)

  const [nodes, setNodes] = useNodesState<Node>([])
  const [edges, setEdges] = useEdgesState<Edge>([])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [t, objects] = await Promise.all([
          window.electronAPI.getTransformation(transformationId),
          window.electronAPI.listObjects(),
        ])
        const fieldResults = await Promise.all(objects.map(o => window.electronAPI.getObject(o.id)))
        const fMap: Record<string, ObjectField[]> = {}
        fieldResults.forEach(r => { fMap[r.object.id] = r.fields })
        const mappings = await window.electronAPI.getFieldMappings(transformationId)
        if (cancelled) return

        setTransformation(t)
        setAllObjects(objects)
        setFieldsMap(fMap)
        setFieldMappings(mappings)

        // Restore canvas nodes from saved positions
        const savedPositions = parseCanvas(t.canvasState)
        const posMap: Record<string, { x: number; y: number }> = {}
        savedPositions.forEach(p => { posMap[p.id] = p.position })

        const restoredNodes = savedPositions.map(p => {
          const isSource = p.id.startsWith('src-')
          const objId = p.id.slice(4)
          const obj = objects.find(o => o.id === objId)
          if (!obj) return null
          return buildNode(obj, fMap[objId] ?? [], p.position, mappings)
        }).filter(Boolean) as Node[]

        setNodes(restoredNodes)
        setEdges(buildEdges(mappings, fMap))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [transformationId])

  // ── Auto-save canvas ──────────────────────────────────────────────────────

  const scheduleSave = useCallback((currentNodes: Node[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const state = { nodes: currentNodes.map(n => ({ id: n.id, position: n.position })) }
      window.electronAPI.saveCanvas(transformationId, JSON.stringify(state)).catch(() => {})
    }, SAVE_DEBOUNCE_MS)
  }, [transformationId])

  // ── Node/edge change handlers ─────────────────────────────────────────────

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes(nds => {
      const updated = applyNodeChanges(changes, nds)
      scheduleSave(updated)
      return updated
    })
  }, [scheduleSave])

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    const removals = changes.filter(c => c.type === 'remove')
    removals.forEach(c => {
      const mappingId = c.id.replace(/^edge-/, '')
      window.electronAPI.deleteFieldMapping(mappingId).catch(() => {})
      setFieldMappings(prev => prev.filter(m => m.id !== mappingId))
    })
    setEdges(eds => applyEdgeChanges(changes, eds))
  }, [])

  // ── Connect (create Direct rule) ─────────────────────────────────────────

  const onConnect = useCallback(async (conn: Connection) => {
    const { source, target, sourceHandle, targetHandle } = conn
    if (!source || !target || !sourceHandle || !targetHandle) return

    const sourceObjectId = source.slice(4)
    const targetObjectId = target.slice(4)
    const sourceFieldName = sourceHandle.replace(/^right-/, '')
    const targetFieldName = targetHandle.replace(/^left-/, '')

    const tgtFields = fieldsMap[targetObjectId] ?? []
    const tgtField = tgtFields.find(f => f.name === targetFieldName)
    if (!tgtField) return

    // One rule per target field — prevent duplicate connections to same target handle
    if (edges.some(e => e.target === target && e.targetHandle === targetHandle)) return

    try {
      const mapping = await window.electronAPI.createFieldMapping(
        transformationId, targetObjectId, tgtField.id,
        'direct', JSON.stringify({ sourceObjectId, sourceFieldName })
      )
      const newEdge: Edge = {
        id: `edge-${mapping.id}`,
        source, target, sourceHandle, targetHandle,
        type: 'smoothstep',
        data: { mappingId: mapping.id },
        style: { stroke: '#3b82f6', strokeWidth: 1.5 },
      }
      setEdges(eds => addEdge(newEdge, eds))
      setFieldMappings(prev => [...prev, mapping])
    } catch { /* silently ignore connect errors */ }
  }, [fieldsMap, edges, transformationId])

  // ── Dock: add / remove objects ────────────────────────────────────────────

  const handleDockClick = useCallback((obj: DataObject) => {
    const nodeId = `${obj.role === 'source' ? 'src' : 'tgt'}-${obj.id}`
    const onCanvas = nodes.some(n => n.id === nodeId)

    if (onCanvas) {
      // Remove from canvas + delete connected edges/mappings
      const connectedEdges = edges.filter(e => e.source === nodeId || e.target === nodeId)
      connectedEdges.forEach(e => {
        const mappingId = e.id.replace(/^edge-/, '')
        window.electronAPI.deleteFieldMapping(mappingId).catch(() => {})
        setFieldMappings(prev => prev.filter(m => m.id !== mappingId))
      })
      setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId))
      setNodes(nds => {
        const updated = nds.filter(n => n.id !== nodeId)
        scheduleSave(updated)
        return updated
      })
    } else {
      // Add to canvas at a default position
      const sameType = nodes.filter(n => n.type === (obj.role === 'source' ? 'sourceObject' : 'targetObject'))
      const x = obj.role === 'source' ? 60 : 520
      const y = 60 + sameType.length * 220
      const newNode = buildNode(obj, fieldsMap[obj.id] ?? [], { x, y }, fieldMappings)
      setNodes(nds => {
        const updated = [...nds, newNode]
        scheduleSave(updated)
        return updated
      })
    }
  }, [nodes, edges, fieldsMap, fieldMappings, scheduleSave])

  // ── Auto-map (exact name match → Direct) ─────────────────────────────────

  const autoMap = useCallback(async () => {
    const srcNodes = nodes.filter(n => n.type === 'sourceObject')
    const tgtNodes = nodes.filter(n => n.type === 'targetObject')
    if (!srcNodes.length || !tgtNodes.length) return

    const newEdges: Edge[] = []
    const newMappings: FieldMapping[] = []

    for (const tgt of tgtNodes) {
      const tgtObjectId = tgt.id.slice(4)
      const tgtFields = fieldsMap[tgtObjectId] ?? []

      for (const src of srcNodes) {
        const srcObjectId = src.id.slice(4)
        const srcFields = fieldsMap[srcObjectId] ?? []

        for (const tf of tgtFields) {
          // Skip if already mapped
          if (edges.some(e => e.target === tgt.id && e.targetHandle === `left-${tf.name}`)) continue
          if (newEdges.some(e => e.target === tgt.id && e.targetHandle === `left-${tf.name}`)) continue
          if (fieldMappings.some(m => m.targetFieldId === tf.id)) continue

          const sf = srcFields.find(f => f.name.toLowerCase() === tf.name.toLowerCase())
          if (!sf) continue

          try {
            const m = await window.electronAPI.createFieldMapping(
              transformationId, tgtObjectId, tf.id,
              'direct', JSON.stringify({ sourceObjectId: srcObjectId, sourceFieldName: sf.name })
            )
            newMappings.push(m)
            newEdges.push({
              id: `edge-${m.id}`,
              source: src.id, target: tgt.id,
              sourceHandle: `right-${sf.name}`,
              targetHandle: `left-${tf.name}`,
              type: 'smoothstep',
              data: { mappingId: m.id },
              style: { stroke: '#3b82f6', strokeWidth: 1.5 },
            })
          } catch { /* skip on error */ }
        }
      }
    }

    if (newEdges.length > 0) {
      setEdges(eds => [...eds, ...newEdges])
      setFieldMappings(prev => [...prev, ...newMappings])
    }
  }, [nodes, edges, fieldsMap, fieldMappings, transformationId])

  // ── Rule panel handlers ───────────────────────────────────────────────────

  const onTargetFieldClick = useCallback((targetObjectId: string, field: ObjectField, mapping: FieldMapping | undefined) => {
    setRulePanel({ targetObjectId, field, mapping })
  }, [])

  const handleRuleSave = useCallback(async (ruleType: string, ruleConfig: string) => {
    if (!rulePanel) return
    const { targetObjectId, field, mapping } = rulePanel

    if (mapping) {
      // Update existing
      const updated = await window.electronAPI.updateFieldMapping(mapping.id, { ruleType, ruleConfig })
      setFieldMappings(prev => prev.map(m => m.id === updated.id ? updated : m))
    } else {
      // Create new non-direct rule
      const m = await window.electronAPI.createFieldMapping(
        transformationId, targetObjectId, field.id, ruleType, ruleConfig
      )
      setFieldMappings(prev => [...prev, m])
    }
  }, [rulePanel, transformationId])

  const handleRuleDelete = useCallback(async () => {
    if (!rulePanel?.mapping) return
    await window.electronAPI.deleteFieldMapping(rulePanel.mapping.id)
    setFieldMappings(prev => prev.filter(m => m.id !== rulePanel.mapping!.id))
    // Also remove any canvas edge for this mapping
    setEdges(eds => eds.filter(e => e.id !== `edge-${rulePanel.mapping!.id}`))
  }, [rulePanel])

  // ── Context value ─────────────────────────────────────────────────────────

  const mappingsByTargetFieldId = useMemo(() => {
    const map: Record<string, FieldMapping> = {}
    fieldMappings.forEach(m => { map[m.targetFieldId] = m })
    return map
  }, [fieldMappings])

  const ctxValue = useMemo<EditorContextValue>(() => ({
    mappingsByTargetFieldId,
    onTargetFieldClick,
  }), [mappingsByTargetFieldId, onTargetFieldClick])

  // ── Split objects by role ─────────────────────────────────────────────────

  const sourceObjects = allObjects.filter(o => o.role === 'source')
  const targetObjects = allObjects.filter(o => o.role === 'target')
  const canvasNodeIds = new Set(nodes.map(n => n.id))

  const rulePanelTarget = rulePanel
    ? allObjects.find(o => o.id === rulePanel.targetObjectId)
    : undefined

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 gap-2">
        <span className="animate-spin">⟳</span>
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
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {fieldMappings.length} rule{fieldMappings.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={autoMap}
            disabled={nodes.length === 0}
            className="text-xs px-3 py-1.5 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200 font-medium disabled:opacity-40 transition-colors"
          >
            ⚡ Auto-map
          </button>
        </div>
      </div>

      {/* Body: docks + canvas */}
      <div className="flex-1 flex overflow-hidden">
        {/* Source dock */}
        <div className="w-44 shrink-0 overflow-y-auto border-r border-gray-100 bg-gray-50 p-3">
          <p className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-2">Sources</p>
          {sourceObjects.length === 0 ? (
            <p className="text-xs text-gray-300 italic">No source objects</p>
          ) : (
            sourceObjects.map(obj => (
              <DockItem
                key={obj.id}
                obj={obj}
                onCanvas={canvasNodeIds.has(`src-${obj.id}`)}
                onClick={() => handleDockClick(obj)}
              />
            ))
          )}
        </div>

        {/* Canvas */}
        <div className="flex-1 relative bg-gray-50">
          <EditorContext.Provider value={ctxValue}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              deleteKeyCode="Delete"
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#e5e7eb" gap={16} />
              <Controls />
              <MiniMap
                nodeColor={n => n.type === 'sourceObject' ? '#bfdbfe' : '#bbf7d0'}
                maskColor="rgba(0,0,0,0.04)"
              />

              {/* Empty state overlay */}
              {nodes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <p className="text-sm text-gray-300 font-medium">Canvas is empty</p>
                    <p className="text-xs text-gray-200 mt-1">Click objects in the docks to add them</p>
                  </div>
                </div>
              )}
            </ReactFlow>
          </EditorContext.Provider>

          {/* Rule config panel */}
          {rulePanel && (
            <RuleConfigPanel
              mapping={rulePanel.mapping}
              targetField={rulePanel.field}
              targetObject={rulePanelTarget}
              onSave={handleRuleSave}
              onDelete={handleRuleDelete}
              onClose={() => setRulePanel(null)}
            />
          )}
        </div>

        {/* Target dock */}
        <div className="w-44 shrink-0 overflow-y-auto border-l border-gray-100 bg-gray-50 p-3">
          <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-2">Targets</p>
          {targetObjects.length === 0 ? (
            <p className="text-xs text-gray-300 italic">No target objects</p>
          ) : (
            targetObjects.map(obj => (
              <DockItem
                key={obj.id}
                obj={obj}
                onCanvas={canvasNodeIds.has(`tgt-${obj.id}`)}
                onClick={() => handleDockClick(obj)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
