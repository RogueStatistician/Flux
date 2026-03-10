import { memo, useContext, useState, useRef, useEffect } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { EditorContext } from '../context.js'

export interface FilterNodeData extends Record<string, unknown> {
  conditions?: Array<{ field: string; op: string; value: string }>
  label?: string
  _renaming?: boolean
}

function FilterOperatorNodeInner({ id, data, selected }: NodeProps) {
  const d = data as unknown as FilterNodeData
  const condCount = (d.conditions ?? []).length
  const ctx = useContext(EditorContext)
  const editing = !!d._renaming
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const label = d.label?.trim() || 'Filter'

  useEffect(() => {
    if (editing) {
      setDraft(d.label ?? '')
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [editing])

  const commitEdit = () => ctx?.onNodeRename(id, draft.trim())
  const cancelEdit = () => ctx?.onNodeRename(id, d.label ?? '')

  return (
    <div
      onClick={() => !editing && ctx?.onFilterNodeClick(id)}
      style={{
        width: 150,
        background: '#fffbeb',
        border: `2px solid ${selected ? '#d97706' : '#fcd34d'}`,
        borderRadius: 10,
        boxShadow: selected ? '0 0 0 3px #fde68a' : '0 2px 6px rgba(0,0,0,0.08)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{ left: -6, top: '50%', width: 12, height: 12, background: '#d97706', border: '2px solid white', borderRadius: '50%' }}
      />

      <div style={{ padding: '10px 14px', background: '#fef3c7', borderRadius: '8px 8px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 16, lineHeight: 1 }}>⊻</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: '#92400e', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Filter
          </p>
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
              onClick={e => e.stopPropagation()}
              style={{
                fontSize: 10, fontWeight: 600, color: '#78350f', margin: 0,
                background: 'white', border: '1px solid #fcd34d', borderRadius: 3,
                padding: '1px 4px', width: '100%', outline: 'none',
              }}
              autoFocus
            />
          ) : (
            <p style={{ fontSize: 10, fontWeight: 600, color: '#78350f', margin: 0 }}>
              {label} · {condCount === 0 ? 'no conditions' : `${condCount} cond.`}
            </p>
          )}
        </div>
      </div>
      <div style={{ padding: '5px 14px', fontSize: 9, color: condCount > 0 ? '#92400e' : '#9ca3af' }}>
        {condCount > 0 ? 'rows pass-through' : 'click to configure'}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        style={{ right: -6, top: '50%', width: 12, height: 12, background: '#d97706', border: '2px solid white', borderRadius: '50%' }}
      />
    </div>
  )
}

export const FilterOperatorNode = memo(FilterOperatorNodeInner)
