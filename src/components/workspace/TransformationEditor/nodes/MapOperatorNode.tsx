import { memo, useContext, useState, useRef, useEffect } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { EditorContext } from '../context.js'

export interface MapNodeData extends Record<string, unknown> {
  targetObjectId: string
  targetObjectName: string
  ruleCount?: number
  label?: string
  _renaming?: boolean
}

function MapOperatorNodeInner({ id, data, selected }: NodeProps) {
  const d = data as unknown as MapNodeData
  const ctx = useContext(EditorContext)
  const count = d.ruleCount ?? 0
  const editing = !!d._renaming
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const label = d.label?.trim() || d.targetObjectName

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
      onClick={() => !editing && ctx?.onMapNodeClick(id, d.targetObjectId)}
      style={{
        width: 170,
        background: '#faf5ff',
        border: `2px solid ${selected ? '#7c3aed' : '#c4b5fd'}`,
        borderRadius: 10,
        boxShadow: selected ? '0 0 0 3px #ddd6fe' : '0 2px 6px rgba(0,0,0,0.08)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{ left: -6, top: '50%', width: 12, height: 12, background: '#7c3aed', border: '2px solid white', borderRadius: '50%' }}
      />

      <div style={{ padding: '10px 14px', background: '#ede9fe', borderRadius: '8px 8px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 16, lineHeight: 1 }}>⇌</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: '#5b21b6', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Map
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
                fontSize: 11, fontWeight: 700, color: '#4c1d95', margin: 0,
                background: 'white', border: '1px solid #c4b5fd', borderRadius: 3,
                padding: '1px 4px', width: '100%', outline: 'none',
              }}
              autoFocus
            />
          ) : (
            <p style={{ fontSize: 11, fontWeight: 700, color: '#4c1d95', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {label}
            </p>
          )}
        </div>
      </div>
      <div style={{ padding: '6px 14px', fontSize: 9, color: count > 0 ? '#7c3aed' : '#9ca3af' }}>
        {count > 0 ? `${count} rule${count !== 1 ? 's' : ''} · click to edit` : 'click to configure'}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        style={{ right: -6, top: '50%', width: 12, height: 12, background: '#7c3aed', border: '2px solid white', borderRadius: '50%' }}
      />
    </div>
  )
}

export const MapOperatorNode = memo(MapOperatorNodeInner)
