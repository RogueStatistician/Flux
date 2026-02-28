/**
 * FilterPanel — modal dialog for configuring a FilterOperatorNode.
 * Lets the user define conditions; rows that match ALL conditions pass through.
 *
 * Config is stored in canvas state (node data), not in the DB.
 */
import { useState, useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import type { DataObject, ObjectField } from '../../../types/index.js'
import type { FilterNodeData } from './nodes/FilterOperatorNode.js'
import { findUpstreamSourceIds, SourceFieldPicker } from './shared.js'

export interface FilterCondition {
  field: string  // encoded as objectId::fieldName
  op: string
  value: string
}

const OPERATORS: Array<{ value: string; label: string; noValue?: boolean }> = [
  { value: '=',            label: '= equals' },
  { value: '!=',           label: '≠ not equals' },
  { value: '>',            label: '> greater than' },
  { value: '<',            label: '< less than' },
  { value: '>=',           label: '≥ greater or equal' },
  { value: '<=',           label: '≤ less or equal' },
  { value: 'contains',     label: 'contains' },
  { value: 'not_contains', label: 'not contains' },
  { value: 'starts_with',  label: 'starts with' },
  { value: 'ends_with',    label: 'ends with' },
  { value: 'is_empty',     label: 'is empty',     noValue: true },
  { value: 'is_not_empty', label: 'is not empty', noValue: true },
]

const NO_VALUE_OPS = new Set(OPERATORS.filter(o => o.noValue).map(o => o.value))

interface Props {
  filterNodeId: string
  nodes: Node[]
  edges: Edge[]
  allObjects: DataObject[]
  fieldsMap: Record<string, ObjectField[]>
  initialData: FilterNodeData
  onSave: (data: FilterNodeData) => void
  onClose: () => void
}

export function FilterPanel({
  filterNodeId,
  nodes,
  edges,
  allObjects,
  fieldsMap,
  initialData,
  onSave,
  onClose,
}: Props) {
  const upstreamSourceIds = useMemo(
    () => findUpstreamSourceIds(filterNodeId, nodes, edges),
    [filterNodeId, nodes, edges],
  )

  const [conditions, setConditions] = useState<FilterCondition[]>(
    () => (initialData.conditions ?? []) as FilterCondition[]
  )

  function addCondition() {
    setConditions(prev => [...prev, { field: '', op: '=', value: '' }])
  }

  function removeCondition(i: number) {
    setConditions(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateCondition(i: number, patch: Partial<FilterCondition>) {
    setConditions(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  }

  function handleSave() {
    onSave({ conditions })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 'min(95vw, 760px)', maxHeight: 'min(90vh, 700px)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b bg-amber-50 shrink-0 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-0.5">Filter conditions</p>
            <p className="text-base font-semibold text-gray-900">
              Rows pass through when <span className="text-amber-600">all</span> conditions match
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none shrink-0 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Condition list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {upstreamSourceIds.length === 0 && (
            <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              ⚠ No source is connected to this Filter node — connect one to pick fields.
            </div>
          )}

          {conditions.length === 0 && (
            <p className="text-sm text-gray-400 italic py-4 text-center">
              No conditions — all rows pass through. Add a condition below.
            </p>
          )}

          {conditions.map((cond, i) => {
            const noValue = NO_VALUE_OPS.has(cond.op)
            return (
              <div key={i} className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-xs font-semibold text-gray-400 w-8 shrink-0 text-center">
                  {i === 0 ? 'IF' : 'AND'}
                </span>

                {/* Field picker */}
                <SourceFieldPicker
                  value={cond.field}
                  sourceObjects={allObjects}
                  fieldsMap={fieldsMap}
                  upstreamSourceIds={upstreamSourceIds}
                  onChange={v => updateCondition(i, { field: v })}
                  placeholder="— field —"
                  className="flex-1 min-w-0"
                />

                {/* Operator */}
                <select
                  value={cond.op}
                  onChange={e => updateCondition(i, { op: e.target.value, value: '' })}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 shrink-0"
                >
                  {OPERATORS.map(op => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>

                {/* Value */}
                {!noValue ? (
                  <input
                    value={cond.value}
                    onChange={e => updateCondition(i, { value: e.target.value })}
                    placeholder="value…"
                    className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                ) : (
                  <span className="flex-1" />
                )}

                {/* Remove */}
                <button
                  onClick={() => removeCondition(i)}
                  className="text-gray-300 hover:text-red-400 text-sm shrink-0 transition-colors"
                  title="Remove condition"
                >
                  ✕
                </button>
              </div>
            )
          })}

          <button
            onClick={addCondition}
            className="w-full mt-1 py-2 rounded-xl border border-dashed border-amber-300 text-sm text-amber-600 hover:bg-amber-50 transition-colors"
          >
            + Add condition
          </button>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 shrink-0 flex items-center justify-between">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-amber-500 text-white text-sm font-medium rounded-xl hover:bg-amber-600 transition-colors"
          >
            Save
          </button>
        </div>

      </div>
    </div>
  )
}
