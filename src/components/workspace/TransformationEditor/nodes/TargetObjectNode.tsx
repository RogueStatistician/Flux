import { memo, useContext } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { ObjectField } from '../../../../types/index.js'
import { EditorContext } from '../context.js'
import { HEADER_H, ROW_H } from './SourceObjectNode.js'

// ── Node data type ────────────────────────────────────────────────────────────
export interface TargetNodeData extends Record<string, unknown> {
  objectId: string
  name: string
  systemName?: string
  fields: ObjectField[]
}

// ── Rule dot indicator ────────────────────────────────────────────────────────
function RuleDot({ ruleType }: { ruleType: string }) {
  const color = ruleType === 'direct' ? '#3b82f6'
    : ruleType === 'constant' ? '#f59e0b'
    : ruleType === 'uuid' ? '#8b5cf6'
    : '#6b7280'
  return (
    <span
      title={ruleType}
      style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: color,
        marginRight: 5,
        flexShrink: 0,
      }}
    />
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

function TargetObjectNodeInner({ data, selected }: NodeProps) {
  const d = data as unknown as TargetNodeData
  const ctx = useContext(EditorContext)

  return (
    <div
      style={{
        minWidth: 200,
        background: '#f0fdf4',
        border: `1.5px solid ${selected ? '#16a34a' : '#86efac'}`,
        borderRadius: 8,
        boxShadow: selected ? '0 0 0 2px #bbf7d0' : '0 1px 3px rgba(0,0,0,0.08)',
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
          borderBottom: '1px solid #bbf7d0',
          background: '#dcfce7',
          borderRadius: '6px 6px 0 0',
        }}
      >
        <p style={{ fontSize: 11, fontWeight: 700, color: '#15803d', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {d.name}
        </p>
        {d.systemName && (
          <p style={{ fontSize: 9, color: '#16a34a', margin: 0, marginTop: 1 }}>{d.systemName}</p>
        )}
      </div>

      {/* Fields */}
      {d.fields.map((f, i) => {
        const handleTop = HEADER_H + i * ROW_H + ROW_H / 2
        const mapping = ctx?.mappingsByTargetFieldId[f.id]
        const isMapped = !!mapping

        return (
          <div
            key={f.id}
            style={{
              height: ROW_H,
              paddingLeft: 20,
              paddingRight: isMapped ? 6 : 10,
              display: 'flex',
              alignItems: 'center',
              borderBottom: i < d.fields.length - 1 ? '1px solid #dcfce7' : 'none',
              background: isMapped ? 'transparent' : undefined,
            }}
          >
            <Handle
              type="target"
              position={Position.Left}
              id={`left-${f.name}`}
              style={{
                top: handleTop,
                left: -5,
                width: 8,
                height: 8,
                background: isMapped ? '#16a34a' : '#d1d5db',
                border: '2px solid white',
                transform: 'translateY(-50%)',
              }}
            />

            {isMapped && <RuleDot ruleType={mapping.ruleType} />}

            <span style={{
              fontSize: 10,
              color: isMapped ? '#111827' : '#6b7280',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              fontWeight: isMapped ? 600 : 400,
            }}>
              {f.displayName || f.name}
            </span>

            {/* Config button for all mapped fields */}
            {isMapped && (
              <button
                onClick={e => {
                  e.stopPropagation()
                  ctx?.onTargetFieldClick(d.objectId, f, mapping)
                }}
                style={{
                  fontSize: 9,
                  background: '#fef3c7',
                  color: '#92400e',
                  border: '1px solid #fde68a',
                  borderRadius: 3,
                  padding: '1px 4px',
                  cursor: 'pointer',
                  marginLeft: 3,
                  flexShrink: 0,
                }}
              >
                ⚙
              </button>
            )}

            {/* Config button for unmapped fields */}
            {!isMapped && (
              <button
                onClick={e => {
                  e.stopPropagation()
                  ctx?.onTargetFieldClick(d.objectId, f, undefined)
                }}
                style={{
                  fontSize: 9,
                  color: '#9ca3af',
                  background: 'transparent',
                  border: '1px solid #e5e7eb',
                  borderRadius: 3,
                  padding: '1px 4px',
                  cursor: 'pointer',
                  marginLeft: 3,
                  flexShrink: 0,
                  opacity: 0,
                }}
                className="config-btn"
                title="Configure rule"
              >
                +
              </button>
            )}
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

export const TargetObjectNode = memo(TargetObjectNodeInner)
