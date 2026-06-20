import { memo, useContext, useState, useEffect, useRef } from 'react'
import { type NodeProps } from '@xyflow/react'
import { EditorContext } from '../context.js'

export interface NoteNodeData extends Record<string, unknown> {
  text: string
}

function NoteNodeInner({ id, data, selected }: NodeProps) {
  const d = data as unknown as NoteNodeData
  const ctx = useContext(EditorContext)

  // Local text state — commits to node data on blur to avoid re-rendering on every keystroke
  const [text, setText] = useState(d.text ?? '')
  const prevText = useRef(d.text ?? '')

  // Sync if node data changes externally (canvas restore, undo, etc.)
  useEffect(() => {
    if (d.text !== prevText.current) {
      prevText.current = d.text ?? ''
      setText(d.text ?? '')
    }
  }, [d.text])

  const handleBlur = () => {
    if (text !== prevText.current) {
      prevText.current = text
      ctx?.onNoteChange(id, text)
    }
  }

  return (
    <div
      style={{
        width: 220,
        background: '#fefce8',
        border: `2px solid ${selected ? '#ca8a04' : '#fde047'}`,
        borderRadius: 10,
        boxShadow: selected ? '0 0 0 3px #fef08a' : '0 2px 6px rgba(0,0,0,0.07)',
      }}
    >
      {/* Drag handle bar */}
      <div
        style={{
          padding: '6px 10px',
          background: '#fef08a',
          borderRadius: '8px 8px 0 0',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'grab',
        }}
      >
        <span style={{ fontSize: 12, lineHeight: 1 }}>✎</span>
        <p style={{ fontSize: 9, fontWeight: 700, color: '#78350f', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Note
        </p>
      </div>

      {/* Editable text area — nodrag prevents React Flow from treating mousedown as a drag */}
      <textarea
        className="nodrag"
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={handleBlur}
        placeholder="Type a note or reminder…"
        rows={4}
        style={{
          display: 'block',
          width: '100%',
          padding: '8px 10px',
          fontSize: 12,
          lineHeight: 1.5,
          color: '#713f12',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

export const NoteNode = memo(NoteNodeInner)
