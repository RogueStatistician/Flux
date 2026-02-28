import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { ObjectField } from '../../../../types/index.js'

// ── Layout constants ──────────────────────────────────────────────────────────
export const HEADER_H = 44
export const ROW_H    = 24

// ── Node data type ────────────────────────────────────────────────────────────
export interface SourceNodeData extends Record<string, unknown> {
  objectId: string
  name: string
  systemName?: string
  fields: ObjectField[]
}

// ── Component ─────────────────────────────────────────────────────────────────

function SourceObjectNodeInner({ data, selected }: NodeProps) {
  const d = data as unknown as SourceNodeData

  return (
    <div
      style={{
        minWidth: 200,
        background: '#eff6ff',
        border: `1.5px solid ${selected ? '#2563eb' : '#93c5fd'}`,
        borderRadius: 8,
        boxShadow: selected ? '0 0 0 2px #bfdbfe' : '0 1px 3px rgba(0,0,0,0.08)',
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div
        style={{
          height: HEADER_H,
          padding: '0 12px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          borderBottom: '1px solid #bfdbfe',
          background: '#dbeafe',
          borderRadius: '6px 6px 0 0',
        }}
      >
        <p style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {d.name}
        </p>
        {d.systemName && (
          <p style={{ fontSize: 9, color: '#3b82f6', margin: 0, marginTop: 1 }}>{d.systemName}</p>
        )}
      </div>

      {/* Fields */}
      {d.fields.map((f, i) => {
        const handleTop = HEADER_H + i * ROW_H + ROW_H / 2
        return (
          <div
            key={f.id}
            style={{
              height: ROW_H,
              paddingLeft: 10,
              paddingRight: 20,
              display: 'flex',
              alignItems: 'center',
              borderBottom: i < d.fields.length - 1 ? '1px solid #e0f2fe' : 'none',
            }}
          >
            <Handle
              type="source"
              position={Position.Right}
              id={`right-${f.name}`}
              style={{
                top: handleTop,
                right: -5,
                width: 8,
                height: 8,
                background: '#3b82f6',
                border: '2px solid white',
                transform: 'translateY(-50%)',
              }}
            />
            <span style={{
              fontSize: 10,
              color: '#374151',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}>
              {f.displayName || f.name}
            </span>
          </div>
        )
      })}

      {d.fields.length === 0 && (
        <div style={{ padding: '8px 12px', fontSize: 10, color: '#9ca3af', fontStyle: 'italic' }}>
          No fields
        </div>
      )}
    </div>
  )
}

export const SourceObjectNode = memo(SourceObjectNodeInner)
