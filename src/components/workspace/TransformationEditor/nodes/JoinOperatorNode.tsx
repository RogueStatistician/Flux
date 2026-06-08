import { memo, useContext, useState, useRef, useEffect } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { EditorContext } from '../context.js'

export interface JoinNodeData extends Record<string, unknown> {
  joinType?: 'inner' | 'left' | 'right'
  joinKeyA?: string
  joinKeyB?: string
  /** Short prefix applied to all B-side field names in the engine output (e.g. "j1"). */
  aliasB?: string
  label?: string
  _renaming?: boolean
}

function JoinOperatorNodeInner({ id, data, selected }: NodeProps) {
  const d = data as unknown as JoinNodeData
  const joinType = d.joinType ?? 'left'
  const ctx = useContext(EditorContext)
  const editing = !!d._renaming
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const label = d.label?.trim() || 'Join'

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
      onClick={() => !editing && ctx?.onJoinNodeClick(id)}
      style={{
        width: 150,
        background: '#fff7ed',
        border: `2px solid ${selected ? '#ea580c' : '#fdba74'}`,
        borderRadius: 10,
        boxShadow: selected ? '0 0 0 3px #fed7aa' : '0 2px 6px rgba(0,0,0,0.08)',
        cursor: 'pointer',
        userSelect: 'none',
        position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Left} id="input-a"
        style={{ left: -6, top: '35%', width: 12, height: 12, background: '#ea580c', border: '2px solid white', borderRadius: '50%' }}
      />
      <Handle type="target" position={Position.Left} id="input-b"
        style={{ left: -6, top: '65%', width: 12, height: 12, background: '#ea580c', border: '2px solid white', borderRadius: '50%' }}
      />

      <div style={{ padding: '10px 14px', background: '#ffedd5', borderRadius: '8px 8px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 16, lineHeight: 1 }}>⋈</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: '#c2410c', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Join
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
                fontSize: 10, fontWeight: 600, color: '#9a3412', margin: 0,
                background: 'white', border: '1px solid #fdba74', borderRadius: 3,
                padding: '1px 4px', width: '100%', outline: 'none',
              }}
              autoFocus
            />
          ) : (
            <p style={{ fontSize: 10, fontWeight: 600, color: '#9a3412', margin: 0 }}>
              {label} · {joinType}
            </p>
          )}
        </div>
      </div>

      {(d.joinKeyA || d.joinKeyB) && (
        <div style={{ padding: '5px 14px', fontSize: 9, color: '#92400e', fontFamily: 'monospace' }}>
          {d.joinKeyA ?? '?'} ↔ {d.joinKeyB ?? '?'}
        </div>
      )}
      {!d.joinKeyA && !d.joinKeyB && (
        <div style={{ padding: '5px 14px', fontSize: 9, color: '#9ca3af' }}>click to configure</div>
      )}
      {d.aliasB && (
        <div style={{ padding: '2px 14px 6px', fontSize: 8, color: '#c2410c', fontFamily: 'monospace', opacity: 0.7 }}>
          B → {d.aliasB}_*
        </div>
      )}

      <Handle type="source" position={Position.Right} id="output"
        style={{ right: -6, top: '50%', width: 12, height: 12, background: '#ea580c', border: '2px solid white', borderRadius: '50%' }}
      />
    </div>
  )
}

export const JoinOperatorNode = memo(JoinOperatorNodeInner)
