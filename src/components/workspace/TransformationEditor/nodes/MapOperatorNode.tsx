import { memo, useContext } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { EditorContext } from '../context.js'

export interface MapNodeData extends Record<string, unknown> {
  targetObjectId: string
  targetObjectName: string
  ruleCount?: number
}

function MapOperatorNodeInner({ id, data, selected }: NodeProps) {
  const d = data as unknown as MapNodeData
  const ctx = useContext(EditorContext)
  const count = d.ruleCount ?? 0

  return (
    <div
      onClick={() => ctx?.onMapNodeClick(id, d.targetObjectId)}
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
        style={{
          left: -6,
          top: '50%',
          width: 12,
          height: 12,
          background: '#7c3aed',
          border: '2px solid white',
          borderRadius: '50%',
        }}
      />

      <div
        style={{
          padding: '10px 14px',
          background: '#ede9fe',
          borderRadius: '8px 8px 0 0',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>⇌</span>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: '#5b21b6', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Map
          </p>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#4c1d95', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {d.targetObjectName}
          </p>
        </div>
      </div>
      <div style={{ padding: '6px 14px', fontSize: 9, color: count > 0 ? '#7c3aed' : '#9ca3af' }}>
        {count > 0 ? `${count} rule${count !== 1 ? 's' : ''} · click to edit` : 'click to configure'}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        style={{
          right: -6,
          top: '50%',
          width: 12,
          height: 12,
          background: '#7c3aed',
          border: '2px solid white',
          borderRadius: '50%',
        }}
      />
    </div>
  )
}

export const MapOperatorNode = memo(MapOperatorNodeInner)
