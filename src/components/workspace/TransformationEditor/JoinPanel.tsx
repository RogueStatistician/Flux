/**
 * JoinPanel — modal dialog for configuring a JoinOperatorNode.
 * Lets the user pick join type (inner/left/right) and join keys from
 * each of the two input sides (input-a, input-b).
 *
 * Config is stored in canvas state (node data), not in the DB.
 */
import { useState, useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import type { DataObject, ObjectField } from '../../../types/index.js'
import type { JoinNodeData, JoinKeyPair } from './nodes/JoinOperatorNode.js'
import { getJoinKeyPairs } from './nodes/JoinOperatorNode.js'
import { findUpstreamByHandle, collectJoinAliasGroups, SourceFieldPicker } from './shared.js'

const JOIN_TYPES: Array<{ value: 'inner' | 'left' | 'right'; label: string; desc: string }> = [
  { value: 'inner', label: 'Inner', desc: 'Only rows with matches on both sides' },
  { value: 'left',  label: 'Left',  desc: 'All rows from A, matched rows from B' },
  { value: 'right', label: 'Right', desc: 'All rows from B, matched rows from A' },
]

interface Props {
  joinNodeId: string
  nodes: Node[]
  edges: Edge[]
  allObjects: DataObject[]
  fieldsMap: Record<string, ObjectField[]>
  initialData: JoinNodeData
  onSave: (data: JoinNodeData) => void
  onClose: () => void
}

export function JoinPanel({
  joinNodeId,
  nodes,
  edges,
  allObjects,
  fieldsMap,
  initialData,
  onSave,
  onClose,
}: Props) {
  const [joinType, setJoinType] = useState<'inner' | 'left' | 'right'>(initialData.joinType ?? 'left')
  const [keyPairs, setKeyPairs] = useState<JoinKeyPair[]>(() => {
    const pairs = getJoinKeyPairs(initialData)
    return pairs.length > 0 ? pairs : [{ a: '', b: '' }]
  })
  const [aliasB, setAliasB] = useState(initialData.aliasB ?? '')

  function updatePair(index: number, side: 'a' | 'b', value: string) {
    setKeyPairs(prev => prev.map((p, i) => (i === index ? { ...p, [side]: value } : p)))
  }

  function addPair() {
    setKeyPairs(prev => [...prev, { a: '', b: '' }])
  }

  function removePair(index: number) {
    setKeyPairs(prev => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))
  }

  // First key's B field is used for the alias example below.
  const firstKeyB = keyPairs[0]?.b ?? ''

  const upstreamA = useMemo(() => findUpstreamByHandle(joinNodeId, 'input-a', nodes, edges), [joinNodeId, nodes, edges])
  const upstreamB = useMemo(() => findUpstreamByHandle(joinNodeId, 'input-b', nodes, edges), [joinNodeId, nodes, edges])

  // Collect alias groups from the A-side upstream graph so chained aliased joins
  // are surfaced as virtual prefixed groups (e.g. "t1 · TabB") in the key picker.
  const joinAliasGroupsA = useMemo(() => {
    const aEdge = edges.find(e => e.target === joinNodeId && e.targetHandle === 'input-a')
    if (!aEdge) return []
    return collectJoinAliasGroups(aEdge.source, nodes, edges)
  }, [joinNodeId, nodes, edges])

  const extendedFieldsMapA = useMemo(() => {
    if (joinAliasGroupsA.length === 0) return fieldsMap
    const map: Record<string, ObjectField[]> = { ...fieldsMap }
    for (const group of joinAliasGroupsA) {
      const virtualFields: ObjectField[] = []
      for (const bId of group.bSourceIds) {
        for (const f of (fieldsMap[bId] ?? [])) {
          const prefixedName = `${group.aliasPrefix}_${f.name}`
          virtualFields.push({ ...f, id: `${group.virtualId}::${prefixedName}`, name: prefixedName })
        }
      }
      map[group.virtualId] = virtualFields
    }
    return map
  }, [fieldsMap, joinAliasGroupsA])

  // B-side sources that are aliased should not appear as raw groups in the A picker.
  const extendedUpstreamA = useMemo(() => {
    const aliasedBIds = new Set(joinAliasGroupsA.flatMap(g => g.bSourceIds))
    return [...upstreamA.filter(id => !aliasedBIds.has(id)), ...joinAliasGroupsA.map(g => g.virtualId)]
  }, [upstreamA, joinAliasGroupsA])

  const groupLabelsA = useMemo(() => {
    const labels: Record<string, string> = {}
    for (const group of joinAliasGroupsA) {
      const bNames = group.bSourceIds.map(id => allObjects.find(o => o.id === id)?.name ?? id).join(', ')
      labels[group.virtualId] = `${group.aliasPrefix} · ${bNames}`
    }
    return labels
  }, [joinAliasGroupsA, allObjects])

  // Label A / B with source object name if only one source feeds that side
  const labelA = upstreamA.length === 1 ? (allObjects.find(o => o.id === upstreamA[0])?.name ?? 'Input A') : 'Input A'
  const labelB = upstreamB.length === 1 ? (allObjects.find(o => o.id === upstreamB[0])?.name ?? 'Input B') : 'Input B'

  function handleSave() {
    const cleanedPairs = keyPairs.filter(p => p.a || p.b)
    onSave({
      joinType,
      joinKeys: cleanedPairs.length > 0 ? cleanedPairs : keyPairs.slice(0, 1),
      // Keep legacy fields in sync with the first condition for older code paths.
      joinKeyA: keyPairs[0]?.a ?? '',
      joinKeyB: keyPairs[0]?.b ?? '',
      aliasB: aliasB.trim() || undefined,
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 'min(95vw, 560px)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b bg-orange-50 shrink-0 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-0.5">Join configuration</p>
            <p className="text-base font-semibold text-gray-900">
              {labelA} <span className="text-gray-400 font-normal">⋈</span> {labelB}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none shrink-0 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-6">

          {/* Join type */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Join type</p>
            <div className="flex gap-2">
              {JOIN_TYPES.map(jt => (
                <button
                  key={jt.value}
                  onClick={() => setJoinType(jt.value)}
                  className={`flex-1 py-2.5 px-3 rounded-xl border text-sm font-medium transition-colors text-center ${
                    joinType === jt.value
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300 hover:text-orange-600'
                  }`}
                >
                  <span className="block">{jt.label}</span>
                  <span className={`block text-xs font-normal mt-0.5 ${joinType === jt.value ? 'text-orange-100' : 'text-gray-400'}`}>
                    {jt.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Join keys */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Join keys</p>
            <div className="space-y-4">
              {keyPairs.map((pair, i) => (
                <div key={i} className="space-y-2">
                  {i > 0 && (
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">AND</p>
                  )}
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-orange-600 w-24 shrink-0">
                          {labelA} (A)
                        </span>
                        <SourceFieldPicker
                          value={pair.a}
                          sourceObjects={allObjects}
                          fieldsMap={extendedFieldsMapA}
                          upstreamSourceIds={extendedUpstreamA}
                          sourceGroupLabels={groupLabelsA}
                          onChange={v => updatePair(i, 'a', v)}
                          placeholder="— pick key field —"
                          className="flex-1"
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-orange-600 w-24 shrink-0">
                          {labelB} (B)
                        </span>
                        <SourceFieldPicker
                          value={pair.b}
                          sourceObjects={allObjects}
                          fieldsMap={fieldsMap}
                          upstreamSourceIds={upstreamB}
                          onChange={v => updatePair(i, 'b', v)}
                          placeholder="— pick key field —"
                          className="flex-1"
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => removePair(i)}
                      disabled={keyPairs.length === 1}
                      className="mt-1 text-gray-300 hover:text-red-500 disabled:opacity-0 disabled:pointer-events-none text-lg leading-none transition-colors"
                      title="Remove condition"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={addPair}
              className="mt-3 text-xs font-medium text-orange-600 hover:text-orange-700 transition-colors"
            >
              + Add condition
            </button>
            <p className="text-xs text-gray-400 mt-2">
              Rows are matched when the value of key A equals the value of key B for{' '}
              {keyPairs.length > 1 ? 'every condition (AND)' : 'this condition'}.
            </p>
          </div>

          {/* B-side alias */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">B-side alias</p>
            <p className="text-xs text-gray-400 mb-2">
              Fields from <span className="font-semibold text-orange-600">{labelB}</span> will be
              available in mappings as <span className="font-mono text-orange-700">{aliasB || 'fieldname'}_*</span>.
              Use a short prefix (e.g. <span className="font-mono">dept</span>, <span className="font-mono">j1</span>)
              to avoid collisions when the same source is joined more than once.
            </p>
            <input
              type="text"
              value={aliasB}
              onChange={e => setAliasB(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
              placeholder="e.g. j1, dept, mgr"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-orange-400 font-mono"
            />
            {aliasB && (
              <p className="text-xs text-orange-600 mt-1 font-mono">
                Example: {aliasB}_{(firstKeyB.includes('::') ? firstKeyB.split('::')[1] : firstKeyB) || 'fieldname'}
              </p>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 shrink-0 flex items-center justify-between">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-orange-500 text-white text-sm font-medium rounded-xl hover:bg-orange-600 transition-colors"
          >
            Save
          </button>
        </div>

      </div>
    </div>
  )
}
