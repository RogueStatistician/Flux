import { memo, useContext, useState, useRef, useEffect } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { EditorContext } from '../context.js'

export interface AppendNodeData extends Record<string, unknown> {
  inputCount?: number
  label?: string
  _renaming?: boolean
}

// Maximum number of input slots ever rendered (hard ceiling).
const MAX_INPUTS = 8

function AppendOperatorNodeInner({ id, data, selected }: NodeProps) {
  const d = data as unknown as AppendNodeData
  const inputCount = Math.max(2, Math.min(d.inputCount ?? 2, MAX_INPUTS))
  const ctx = useContext(EditorContext)
  const editing = !!d._renaming
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const label = d.label?.trim() || 'Append'

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
      style={{
        width: 150,
        background: '#f8fafc',
        border: `2px solid ${selected ? '#475569' : '#cbd5e1'}`,
        borderRadius: 10,
        boxShadow: selected ? '0 0 0 3px #e2e8f0' : '0 2px 6px rgba(0,0,0,0.08)',
        userSelect: 'none',
        position: 'relative',
      }}
    >
      {/* Dynamic input handles, evenly distributed */}
      {Array.from({ length: inputCount }, (_, i) => (
        <Handle
          key={`input-${i}`}
          type="target"
          position={Position.Left}
          id={`input-${i}`}
          style={{
            left: -6,
            top: `${((i + 0.5) / inputCount) * 100}%`,
            width: 12,
            height: 12,
            background: '#475569',
            border: '2px solid white',
            borderRadius: '50%',
          }}
        />
      ))}

      {/* Header */}
      <div style={{ padding: '10px 14px', background: '#f1f5f9', borderRadius: '8px 8px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14, lineHeight: 1 }}>∪</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: '#334155', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Append
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
                fontSize: 10, fontWeight: 600, color: '#475569', margin: 0,
                background: 'white', border: '1px solid #94a3b8', borderRadius: 3,
                padding: '1px 4px', width: '100%', outline: 'none',
              }}
              autoFocus
            />
          ) : (
            <p style={{ fontSize: 10, fontWeight: 600, color: '#475569', margin: 0 }}>
              {label}
            </p>
          )}
        </div>
      </div>

      {/* Add input button */}
      <div style={{ padding: '5px 14px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: '#94a3b8' }}>{inputCount} input{inputCount !== 1 ? 's' : ''}</span>
        {inputCount < MAX_INPUTS && (
          <button
            onClick={e => { e.stopPropagation(); ctx?.onAppendAddInput(id) }}
            style={{
              fontSize: 11, fontWeight: 700, color: '#475569', background: '#e2e8f0',
              border: 'none', borderRadius: 4, width: 18, height: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
            }}
            title="Add input slot"
          >
            +
          </button>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        style={{ right: -6, top: '50%', width: 12, height: 12, background: '#475569', border: '2px solid white', borderRadius: '50%' }}
      />
    </div>
  )
}

export const AppendOperatorNode = memo(AppendOperatorNodeInner)
