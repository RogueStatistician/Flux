import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'

export interface TargetNodeData extends Record<string, unknown> {
  objectId: string
  name: string
  systemName?: string
  columnCount?: number
}

function TargetObjectNodeInner({ data, selected }: NodeProps) {
  const d = data as unknown as TargetNodeData

  return (
    <div
      style={{
        width: 200,
        background: '#f0fdf4',
        border: `2px solid ${selected ? '#16a34a' : '#86efac'}`,
        borderRadius: 10,
        boxShadow: selected ? '0 0 0 3px #bbf7d0' : '0 2px 6px rgba(0,0,0,0.08)',
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
          background: '#16a34a',
          border: '2px solid white',
          borderRadius: '50%',
        }}
      />

      <div
        style={{
          padding: '10px 14px',
          background: '#dcfce7',
          borderRadius: '8px 8px 0 0',
        }}
      >
        <p style={{ fontSize: 9, fontWeight: 700, color: '#14532d', margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Target
        </p>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#15803d', margin: 0, overflowWrap: 'break-word', wordBreak: 'break-word' }}>
          {d.name}
        </p>
        {d.systemName && (
          <p style={{ fontSize: 9, color: '#16a34a', margin: '2px 0 0', overflowWrap: 'break-word' }}>{d.systemName}</p>
        )}
      </div>
      <div style={{ padding: '6px 14px', fontSize: 9, color: '#6b7280', display: 'flex', justifyContent: 'space-between' }}>
        <span>Output destination</span>
        {d.columnCount !== undefined && (
          <span style={{ color: '#86efac', fontWeight: 600 }}>{d.columnCount} col{d.columnCount !== 1 ? 's' : ''}</span>
        )}
      </div>
    </div>
  )
}

export const TargetObjectNode = memo(TargetObjectNodeInner)
