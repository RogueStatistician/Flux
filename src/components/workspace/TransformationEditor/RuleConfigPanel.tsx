import { useState } from 'react'
import type { FieldMapping, ObjectField, DataObject } from '../../../types/index.js'

// ── Rule types ────────────────────────────────────────────────────────────────

const RULE_TYPES = [
  { value: 'direct',     label: 'Direct',     desc: 'Copy value from source field' },
  { value: 'constant',   label: 'Constant',   desc: 'Fixed value for every row' },
  { value: 'uuid',       label: 'UUID',       desc: 'Auto-generated unique ID' },
  { value: 'concat',     label: 'Concat',     desc: 'Combine multiple fields/literals' },
  { value: 'split',      label: 'Split',      desc: 'Extract a part of a delimited value' },
  { value: 'dateformat', label: 'Date Format', desc: 'Convert date between formats' },
  { value: 'expression', label: 'Expression', desc: 'Custom formula using field tokens' },
]

// ── Config form per rule type ─────────────────────────────────────────────────

function DirectConfig({ config }: { config: Record<string, string> }) {
  return (
    <div className="text-xs text-gray-500 bg-blue-50 rounded-lg p-3">
      <p className="font-medium text-blue-700 mb-1">Source field</p>
      <p className="font-mono text-blue-800">{config.sourceFieldName ?? '—'}</p>
      {config.sourceObjectId && (
        <p className="text-blue-500 text-xs mt-0.5">Object: {config.sourceObjectId}</p>
      )}
      <p className="text-blue-400 text-xs mt-2 italic">Source is set by drawing an edge from the source node.</p>
    </div>
  )
}

function ConstantConfig({
  config,
  onChange,
}: {
  config: Record<string, string>
  onChange: (c: Record<string, string>) => void
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1">Value</label>
      <input
        value={config.value ?? ''}
        onChange={e => onChange({ ...config, value: e.target.value })}
        placeholder="Enter constant value…"
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
      />
    </div>
  )
}

function UUIDConfig() {
  return (
    <div className="text-xs text-purple-600 bg-purple-50 rounded-lg p-3">
      A random UUID will be generated for each row.
    </div>
  )
}

function ExpressionConfig({
  config,
  onChange,
}: {
  config: Record<string, string>
  onChange: (c: Record<string, string>) => void
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1">
        Expression <span className="font-normal text-gray-400">(use {`{fieldName}`} tokens)</span>
      </label>
      <textarea
        value={config.expression ?? ''}
        onChange={e => onChange({ ...config, expression: e.target.value })}
        rows={3}
        placeholder="e.g. {FirstName} + ' ' + {LastName}"
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
      />
    </div>
  )
}

function GenericConfig({
  config,
  onChange,
}: {
  config: Record<string, string>
  onChange: (c: Record<string, string>) => void
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1">
        Configuration (JSON)
      </label>
      <textarea
        value={JSON.stringify(config, null, 2)}
        onChange={e => {
          try { onChange(JSON.parse(e.target.value)) } catch { /* ignore invalid JSON */ }
        }}
        rows={4}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-gray-400 resize-none"
      />
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface Props {
  /** The current mapping, or undefined if the field is unmapped. */
  mapping: FieldMapping | undefined
  targetField: ObjectField
  targetObject: DataObject | undefined
  onSave: (ruleType: string, ruleConfig: string) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}

export function RuleConfigPanel({ mapping, targetField, targetObject, onSave, onDelete, onClose }: Props) {
  const initialConfig = mapping ? JSON.parse(mapping.ruleConfig) as Record<string, string> : {}
  const [ruleType, setRuleType] = useState(mapping?.ruleType ?? 'constant')
  const [config, setConfig] = useState<Record<string, string>>(initialConfig)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDirty = ruleType !== (mapping?.ruleType ?? 'constant') ||
    JSON.stringify(config) !== JSON.stringify(initialConfig)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(ruleType, JSON.stringify(config))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setSaving(true)
    try {
      await onDelete()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete.')
      setSaving(false)
    }
  }

  return (
    <div
      className="absolute top-0 right-0 bottom-0 w-72 bg-white border-l border-gray-200 shadow-lg flex flex-col z-10"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-start justify-between shrink-0">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Rule Config</p>
          <p className="text-sm font-semibold text-gray-800 mt-0.5 break-words" title={targetField.description}>
            {targetField.name}
          </p>
          {targetObject && (
            <p className="text-xs text-gray-400 break-words">{targetObject.name}</p>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none mt-0.5">✕</button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
            {error}
          </div>
        )}

        {/* Rule type selector */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Rule type</label>
          <select
            value={ruleType}
            onChange={e => {
              setRuleType(e.target.value)
              setConfig({}) // reset config when type changes
            }}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            {RULE_TYPES.map(r => (
              <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
            ))}
          </select>
        </div>

        {/* Config form for selected rule type */}
        {ruleType === 'direct'     && <DirectConfig config={config} />}
        {ruleType === 'constant'   && <ConstantConfig config={config} onChange={setConfig} />}
        {ruleType === 'uuid'       && <UUIDConfig />}
        {ruleType === 'expression' && <ExpressionConfig config={config} onChange={setConfig} />}
        {!['direct', 'constant', 'uuid', 'expression'].includes(ruleType) && (
          <GenericConfig config={config} onChange={setConfig} />
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t flex items-center justify-between shrink-0">
        {mapping ? (
          <button
            onClick={handleDelete}
            disabled={saving}
            className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
          >
            Delete rule
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={handleSave}
          disabled={(!isDirty && !!mapping) || saving || ruleType === 'direct'}
          className="px-4 py-1.5 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 disabled:opacity-40 transition-colors"
        >
          {saving ? '…' : mapping ? 'Update' : 'Apply rule'}
        </button>
      </div>
    </div>
  )
}
