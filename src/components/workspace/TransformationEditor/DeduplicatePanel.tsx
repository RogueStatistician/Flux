/**
 * DeduplicatePanel — modal dialog for configuring a DeduplicateOperatorNode.
 * Config is stored in canvas state (node data), not in the DB.
 */
import { useState, useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import type { DataObject, ObjectField } from '../../../types/index.js'
import type { DeduplicateNodeData } from './nodes/DeduplicateOperatorNode.js'
import { findUpstreamSourceIds, SourceFieldPicker } from './shared.js'

interface Props {
  dedupNodeId: string
  nodes: Node[]
  edges: Edge[]
  allObjects: DataObject[]
  fieldsMap: Record<string, ObjectField[]>
  initialData: DeduplicateNodeData
  onSave: (data: DeduplicateNodeData) => void
  onClose: () => void
}

export function DeduplicatePanel({
  dedupNodeId,
  nodes,
  edges,
  allObjects,
  fieldsMap,
  initialData,
  onSave,
  onClose,
}: Props) {
  const upstreamSourceIds = useMemo(
    () => findUpstreamSourceIds(dedupNodeId, nodes, edges),
    [dedupNodeId, nodes, edges],
  )

  const [keyFields, setKeyFields] = useState<string[]>(initialData.keyFields ?? [''])
  const [sortField, setSortField] = useState<string>(initialData.sortField ?? '')
  const [keepOrder, setKeepOrder] = useState<'last' | 'first'>(initialData.keepOrder ?? 'last')

  const addKeyField = () => setKeyFields(prev => [...prev, ''])
  const removeKeyField = (i: number) => setKeyFields(prev => prev.filter((_, idx) => idx !== i))
  const updateKeyField = (i: number, v: string) =>
    setKeyFields(prev => prev.map((f, idx) => idx === i ? v : f))

  function handleSave() {
    onSave({
      keyFields: keyFields.filter(Boolean),
      sortField: sortField || undefined,
      keepOrder,
    })
    onClose()
  }

  const pickerProps = { sourceObjects: allObjects, fieldsMap, upstreamSourceIds }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 'min(95vw, 580px)', maxHeight: 'min(90vh, 600px)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b shrink-0 flex items-center justify-between gap-4" style={{ background: '#ccfbf1' }}>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: '#0f766e' }}>Deduplicate</p>
            <p className="text-base font-semibold text-gray-900">Keep one row per unique key</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none shrink-0 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {upstreamSourceIds.length === 0 && (
            <div className="px-4 py-3 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-700">
              ⚠ No source connected to this node — connect one to pick fields.
            </div>
          )}

          {/* Key fields */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Key field(s)</p>
            <p className="text-xs text-gray-400 mb-3">
              Rows with the same combination of key values are considered duplicates.
              Only one row per unique key will be kept.
            </p>
            <div className="space-y-2">
              {keyFields.map((kf, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-4 shrink-0">{i + 1}.</span>
                  <SourceFieldPicker
                    value={kf}
                    onChange={v => updateKeyField(i, v ?? '')}
                    {...pickerProps}
                  />
                  {keyFields.length > 1 && (
                    <button
                      onClick={() => removeKeyField(i)}
                      className="text-gray-300 hover:text-red-400 text-sm shrink-0 transition-colors"
                      title="Remove key field"
                    >✕</button>
                  )}
                </div>
              ))}
              <button
                onClick={addKeyField}
                className="text-xs px-2.5 py-1 rounded-lg border border-dashed border-teal-300 text-teal-600 hover:bg-teal-50 transition-colors"
              >
                + Add key field
              </button>
            </div>
          </div>

          {/* Sort field */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Sort field</p>
            <p className="text-xs text-gray-400 mb-3">
              Among duplicate rows, sort by this field to decide which one to keep.
            </p>
            <SourceFieldPicker
              value={sortField}
              onChange={v => setSortField(v ?? '')}
              {...pickerProps}
            />
          </div>

          {/* Keep order */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-3">Which row to keep</p>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="keepOrder"
                  value="last"
                  checked={keepOrder === 'last'}
                  onChange={() => setKeepOrder('last')}
                  className="accent-teal-600"
                />
                <div>
                  <span className="text-sm font-medium text-gray-800">Latest</span>
                  <p className="text-xs text-gray-400">Keep the row with the highest sort field value</p>
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="keepOrder"
                  value="first"
                  checked={keepOrder === 'first'}
                  onChange={() => setKeepOrder('first')}
                  className="accent-teal-600"
                />
                <div>
                  <span className="text-sm font-medium text-gray-800">Earliest</span>
                  <p className="text-xs text-gray-400">Keep the row with the lowest sort field value</p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 shrink-0 flex items-center justify-between">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2 text-white text-sm font-medium rounded-xl transition-colors"
            style={{ background: '#0f766e' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#115e59')}
            onMouseLeave={e => (e.currentTarget.style.background = '#0f766e')}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
