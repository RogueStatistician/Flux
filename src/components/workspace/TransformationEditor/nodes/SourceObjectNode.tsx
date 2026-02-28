import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'

export interface SourceNodeData extends Record<string, unknown> {
  objectId: string
  name: string
  systemName?: string
}

function SourceObjectNodeInner({ data, selected }: NodeProps) {
  const d = data as unknown as SourceNodeData

  return (
    <div
      style={{
        width: 180,
        background: '#eff6ff',
        border: `2px solid ${selected ? '#2563eb' : '#93c5fd'}`,
        borderRadius: 10,
        boxShadow: selected ? '0 0 0 3px #bfdbfe' : '0 2px 6px rgba(0,0,0,0.08)',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          background: '#dbeafe',
          borderRadius: '8px 8px 0 0',
        }}
      >
        <p style={{ fontSize: 9, fontWeight: 700, color: '#1e40af', margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Source
        </p>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {d.name}
        </p>
        {d.systemName && (
          <p style={{ fontSize: 9, color: '#3b82f6', margin: '2px 0 0' }}>{d.systemName}</p>
        )}
      </div>
      <div style={{ padding: '6px 14px', fontSize: 9, color: '#6b7280' }}>
        Data source
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
          background: '#3b82f6',
          border: '2px solid white',
          borderRadius: '50%',
        }}
      />
    </div>
  )
}

export const SourceObjectNode = memo(SourceObjectNodeInner)
