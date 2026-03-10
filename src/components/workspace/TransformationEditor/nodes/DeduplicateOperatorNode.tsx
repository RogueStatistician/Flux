import { memo, useContext, useState, useRef, useEffect } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { EditorContext } from '../context.js'

export interface DeduplicateNodeData extends Record<string, unknown> {
  keyFields?: string[]   // encoded "objectId::fieldName"
  sortField?: string     // encoded "objectId::fieldName"
  keepOrder?: 'last' | 'first'
  label?: string
  _renaming?: boolean
}

function DeduplicateOperatorNodeInner({ id, data, selected }: NodeProps) {
  const d = data as unknown as DeduplicateNodeData
  const ctx = useContext(EditorContext)
  const editing = !!d._renaming
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const label = d.label?.trim() || 'Deduplicate'
  const keyCount = (d.keyFields ?? []).length
  const hasSortField = !!d.sortField
  const keepLabel = d.keepOrder === 'first' ? 'earliest' : 'latest'

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
      onClick={() => !editing && ctx?.onDedupNodeClick(id)}
      style={{
        width: 150,
        background: '#f0fdfa',
        border: `2px solid ${selected ? '#0f766e' : '#5eead4'}`,
        borderRadius: 10,
        boxShadow: selected ? '0 0 0 3px #ccfbf1' : '0 2px 6px rgba(0,0,0,0.08)',
        cursor: 'pointer',
        userSelect: 'none',
        position: 'relative',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{ left: -6, top: '50%', width: 12, height: 12, background: '#0f766e', border: '2px solid white', borderRadius: '50%' }}
      />

      <div style={{ padding: '10px 14px', background: '#ccfbf1', borderRadius: '8px 8px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14, lineHeight: 1 }}>◎</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: '#115e59', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Deduplicate
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
                fontSize: 10, fontWeight: 600, color: '#0f766e', margin: 0,
                background: 'white', border: '1px solid #5eead4', borderRadius: 3,
                padding: '1px 4px', width: '100%', outline: 'none',
              }}
              autoFocus
            />
          ) : (
            <p style={{ fontSize: 10, fontWeight: 600, color: '#0f766e', margin: 0 }}>
              {label}
            </p>
          )}
        </div>
      </div>

      <div style={{ padding: '5px 14px 8px', fontSize: 9, color: keyCount > 0 ? '#115e59' : '#9ca3af' }}>
        {keyCount > 0 && hasSortField
          ? `${keyCount} key${keyCount !== 1 ? 's' : ''} · keep ${keepLabel}`
          : 'click to configure'}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        style={{ right: -6, top: '50%', width: 12, height: 12, background: '#0f766e', border: '2px solid white', borderRadius: '50%' }}
      />
    </div>
  )
}

export const DeduplicateOperatorNode = memo(DeduplicateOperatorNodeInner)
