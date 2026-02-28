/**
 * MapPanel — modal dialog for configuring per-field mapping rules.
 * Opens when clicking a MapOperatorNode.
 */
import { useState, useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import type { DataObject, FieldMapping, ObjectField } from '../../../types/index.js'
import {
  findUpstreamSourceIds,
  encodeField,
  decodeField,
  SourceFieldPicker,
} from './shared.js'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FieldRuleState {
  ruleType: string
  config: Record<string, unknown>
}

type ConcatPart =
  | { type: 'field'; sourceObjectId: string; sourceFieldName: string }
  | { type: 'literal'; value: string }

// ── Per-rule-type config editors ──────────────────────────────────────────────

function DirectEditor({
  config, onChange, upstreamSourceIds, sourceObjects, fieldsMap,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  upstreamSourceIds: string[]
  sourceObjects: DataObject[]
  fieldsMap: Record<string, ObjectField[]>
}) {
  const val = config.sourceObjectId
    ? encodeField(config.sourceObjectId as string, (config.sourceFieldName as string) ?? '')
    : ''
  return (
    <SourceFieldPicker
      value={val}
      sourceObjects={sourceObjects}
      fieldsMap={fieldsMap}
      upstreamSourceIds={upstreamSourceIds}
      onChange={v => {
        if (!v) { onChange({}); return }
        onChange(decodeField(v))
      }}
    />
  )
}

function ConstantEditor({ config, onChange }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  return (
    <input
      value={(config.value as string) ?? ''}
      onChange={e => onChange({ value: e.target.value })}
      placeholder="Enter a fixed value for every row…"
      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
    />
  )
}

function IncrementalEditor({ config, onChange }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <label className="flex items-center gap-1.5 text-sm text-gray-600">
        Start
        <input
          type="number"
          value={(config.start as number) ?? 1}
          onChange={e => onChange({ ...config, start: Number(e.target.value) })}
          className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
        />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-600">
        Step
        <input
          type="number"
          value={(config.step as number) ?? 1}
          onChange={e => onChange({ ...config, step: Number(e.target.value) })}
          className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
        />
      </label>
      <span className="text-xs text-gray-400">→ 1, 2, 3, … per row</span>
    </div>
  )
}

function ExpressionEditor({ config, onChange }: { config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  return (
    <div className="w-full">
      <textarea
        value={(config.expression as string) ?? ''}
        onChange={e => onChange({ expression: e.target.value })}
        rows={2}
        placeholder={`JavaScript — row['FieldName'], rowIndex, String(), etc.\ne.g. (row['First'] + ' ' + row['Last']).toUpperCase()`}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400 resize-y"
      />
    </div>
  )
}

function ConcatEditor({
  config, onChange, upstreamSourceIds, sourceObjects, fieldsMap,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  upstreamSourceIds: string[]
  sourceObjects: DataObject[]
  fieldsMap: Record<string, ObjectField[]>
}) {
  const parts: ConcatPart[] = (config.parts as ConcatPart[]) ?? []

  const updatePart = (i: number, part: ConcatPart) => {
    const next = [...parts]
    next[i] = part
    onChange({ parts: next })
  }
  const removePart = (i: number) => {
    onChange({ parts: parts.filter((_, idx) => idx !== i) })
  }
  const addField = () => {
    onChange({ parts: [...parts, { type: 'field', sourceObjectId: '', sourceFieldName: '' }] })
  }
  const addLiteral = () => {
    onChange({ parts: [...parts, { type: 'literal', value: '' }] })
  }

  return (
    <div className="space-y-1.5">
      {parts.map((part, i) => (
        <div key={i} className="flex items-center gap-2">
          <select
            value={part.type}
            onChange={e => updatePart(i, e.target.value === 'field'
              ? { type: 'field', sourceObjectId: '', sourceFieldName: '' }
              : { type: 'literal', value: '' }
            )}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-violet-400 shrink-0"
          >
            <option value="field">Field</option>
            <option value="literal">Text</option>
          </select>

          {part.type === 'field' ? (
            <SourceFieldPicker
              value={part.sourceObjectId ? encodeField(part.sourceObjectId, part.sourceFieldName) : ''}
              sourceObjects={sourceObjects}
              fieldsMap={fieldsMap}
              upstreamSourceIds={upstreamSourceIds}
              onChange={v => {
                if (!v) { updatePart(i, { type: 'field', sourceObjectId: '', sourceFieldName: '' }); return }
                const { sourceObjectId, sourceFieldName } = decodeField(v)
                updatePart(i, { type: 'field', sourceObjectId, sourceFieldName })
              }}
            />
          ) : (
            <input
              value={(part as { type: 'literal'; value: string }).value}
              onChange={e => updatePart(i, { type: 'literal', value: e.target.value })}
              placeholder="literal text…"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
          )}

          <button
            onClick={() => removePart(i)}
            className="text-gray-300 hover:text-red-400 text-sm shrink-0"
            title="Remove part"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex gap-2 pt-0.5">
        <button
          onClick={addField}
          className="text-xs px-2.5 py-1 rounded-lg border border-violet-200 text-violet-600 hover:bg-violet-50 transition-colors"
        >
          + Field
        </button>
        <button
          onClick={addLiteral}
          className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          + Text
        </button>
      </div>
    </div>
  )
}

function SplitEditor({
  config, onChange, upstreamSourceIds, sourceObjects, fieldsMap,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  upstreamSourceIds: string[]
  sourceObjects: DataObject[]
  fieldsMap: Record<string, ObjectField[]>
}) {
  const val = config.sourceObjectId
    ? encodeField(config.sourceObjectId as string, (config.sourceFieldName as string) ?? '')
    : ''
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <SourceFieldPicker
        value={val}
        sourceObjects={sourceObjects}
        fieldsMap={fieldsMap}
        upstreamSourceIds={upstreamSourceIds}
        onChange={v => {
          if (!v) { onChange({ ...config, sourceObjectId: undefined, sourceFieldName: undefined }); return }
          const { sourceObjectId, sourceFieldName } = decodeField(v)
          onChange({ ...config, sourceObjectId, sourceFieldName })
        }}
      />
      <span className="text-sm text-gray-400 shrink-0">split by</span>
      <input
        value={(config.delimiter as string) ?? ' '}
        onChange={e => onChange({ ...config, delimiter: e.target.value })}
        placeholder="delim"
        className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-400"
      />
      <span className="text-sm text-gray-400 shrink-0">take part</span>
      <input
        type="number"
        min={0}
        value={(config.index as number) ?? 0}
        onChange={e => onChange({ ...config, index: Number(e.target.value) })}
        className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-400"
      />
    </div>
  )
}

const DATE_FORMAT_SUGGESTIONS = [
  'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY/MM/DD',
  'DD-MM-YYYY', 'MM-DD-YYYY', 'YYYYMMDD',
]

function DateFormatEditor({
  config, onChange, upstreamSourceIds, sourceObjects, fieldsMap,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  upstreamSourceIds: string[]
  sourceObjects: DataObject[]
  fieldsMap: Record<string, ObjectField[]>
}) {
  const val = config.sourceObjectId
    ? encodeField(config.sourceObjectId as string, (config.sourceFieldName as string) ?? '')
    : ''
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <SourceFieldPicker
        value={val}
        sourceObjects={sourceObjects}
        fieldsMap={fieldsMap}
        upstreamSourceIds={upstreamSourceIds}
        onChange={v => {
          if (!v) { onChange({ ...config, sourceObjectId: undefined, sourceFieldName: undefined }); return }
          const { sourceObjectId, sourceFieldName } = decodeField(v)
          onChange({ ...config, sourceObjectId, sourceFieldName })
        }}
      />
      <span className="text-sm text-gray-400 shrink-0">→ format</span>
      <input
        list="date-fmt-list"
        value={(config.outputFormat as string) ?? 'YYYY-MM-DD'}
        onChange={e => onChange({ ...config, outputFormat: e.target.value })}
        className="w-36 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400"
        placeholder="YYYY-MM-DD"
      />
      <datalist id="date-fmt-list">
        {DATE_FORMAT_SUGGESTIONS.map(f => <option key={f} value={f} />)}
      </datalist>
    </div>
  )
}

// ── Rule type list ────────────────────────────────────────────────────────────

const RULE_TYPES = [
  { value: '',             label: '— none —' },
  { value: 'direct',       label: 'Direct' },
  { value: 'constant',     label: 'Constant' },
  { value: 'uuid',         label: 'UUID' },
  { value: 'incremental',  label: 'Incremental' },
  { value: 'expression',   label: 'Expression' },
  { value: 'concat',       label: 'Concat' },
  { value: 'split',        label: 'Split' },
  { value: 'dateformat',   label: 'Date Format' },
]

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  mapNodeId: string
  targetObjectId: string
  transformationId: string
  fieldMappings: FieldMapping[]
  fieldsMap: Record<string, ObjectField[]>
  sourceObjects: DataObject[]
  nodes: Node[]
  edges: Edge[]
  onSaved: (newMappings: FieldMapping[]) => void
  onClose: () => void
}

// ── Main component ────────────────────────────────────────────────────────────

export function MapPanel({
  mapNodeId,
  targetObjectId,
  transformationId,
  fieldMappings,
  fieldsMap,
  sourceObjects,
  nodes,
  edges,
  onSaved,
  onClose,
}: Props) {
  const targetFields = fieldsMap[targetObjectId] ?? []

  const upstreamSourceIds = useMemo(
    () => findUpstreamSourceIds(mapNodeId, nodes, edges),
    [mapNodeId, nodes, edges]
  )

  const existingMappings = useMemo(
    () => fieldMappings.filter(m => m.targetObjectId === targetObjectId),
    [fieldMappings, targetObjectId]
  )

  const [rules, setRules] = useState<Record<string, FieldRuleState>>(() => {
    const initial: Record<string, FieldRuleState> = {}
    for (const field of targetFields) {
      const mapping = existingMappings.find(m => m.targetFieldId === field.id)
      initial[field.id] = mapping
        ? { ruleType: mapping.ruleType, config: JSON.parse(mapping.ruleConfig) as Record<string, unknown> }
        : { ruleType: '', config: {} }
    }
    return initial
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setFieldRule(fieldId: string, update: Partial<FieldRuleState>) {
    setRules(prev => ({ ...prev, [fieldId]: { ...prev[fieldId], ...update } }))
  }

  const mappedCount = Object.values(rules).filter(r => r.ruleType !== '').length

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await Promise.all(
        targetFields.map(field => {
          const rule = rules[field.id] ?? { ruleType: '', config: {} }
          const existing = existingMappings.find(m => m.targetFieldId === field.id)
          if (rule.ruleType === '') {
            return existing ? window.electronAPI.deleteFieldMapping(existing.id) : Promise.resolve()
          }
          return window.electronAPI.createFieldMapping(
            transformationId,
            targetObjectId,
            field.id,
            rule.ruleType,
            JSON.stringify(rule.config),
          )
        })
      )
      const newMappings = await window.electronAPI.getFieldMappings(transformationId)
      onSaved(newMappings)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
      setSaving(false)
    }
  }

  const sharedEditorProps = { upstreamSourceIds, sourceObjects, fieldsMap }

  return (
    // Fixed full-viewport backdrop
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Modal card */}
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 'min(95vw, 1120px)', height: 'min(90vh, 800px)' }}
        onClick={e => e.stopPropagation()}
      >

        {/* Header */}
        <div className="px-6 py-4 border-b bg-violet-50 shrink-0 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold text-violet-500 uppercase tracking-widest mb-0.5">Field mapping rules</p>
            <div className="flex items-center gap-3">
              <p className="text-base font-semibold text-gray-900">
                {upstreamSourceIds.length === 0
                  ? <span className="text-gray-400 font-normal italic">No source</span>
                  : <>
                      {sourceObjects.find(o => o.id === upstreamSourceIds[0])?.name ?? upstreamSourceIds[0]}
                      {upstreamSourceIds.length > 1 && (
                        <span className="text-gray-400 font-normal"> +{upstreamSourceIds.length - 1} more</span>
                      )}
                    </>
                }
                <span className="text-gray-400 font-normal mx-1">→</span>
                {sourceObjects.find(o => o.id === targetObjectId)?.name ?? 'Target'}
              </p>
              <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs font-semibold">
                {mappedCount} / {targetFields.length} mapped
              </span>
            </div>
            {upstreamSourceIds.length === 0 && (
              <p className="text-xs text-amber-500 mt-1">
                ⚠ No source is connected to this Map node — connect one to enable Direct rules
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none shrink-0 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Column headers */}
        <div className="grid border-b bg-gray-50 shrink-0" style={{ gridTemplateColumns: '220px 160px 1fr' }}>
          <div className="px-5 py-2.5 text-xs font-bold text-gray-400 uppercase tracking-wider">Target field</div>
          <div className="px-3 py-2.5 text-xs font-bold text-gray-400 uppercase tracking-wider">Rule type</div>
          <div className="px-4 py-2.5 text-xs font-bold text-gray-400 uppercase tracking-wider">Transformation logic</div>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="mx-6 mt-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          {targetFields.length === 0 ? (
            <div className="p-16 text-center text-gray-400">
              <p className="font-medium mb-1">No fields defined</p>
              <p className="text-sm">Define fields on the target object first.</p>
            </div>
          ) : (
            targetFields.map(field => {
              const rule = rules[field.id] ?? { ruleType: '', config: {} }
              const isMapped = rule.ruleType !== ''

              return (
                <div
                  key={field.id}
                  className={`grid items-start border-b border-gray-50 hover:bg-gray-50/60 transition-colors ${isMapped ? 'bg-violet-50/20' : ''}`}
                  style={{ gridTemplateColumns: '220px 160px 1fr' }}
                >
                  {/* Field name */}
                  <div className="px-5 py-3 flex items-start gap-1.5 min-w-0">
                    <div className="min-w-0">
                      <span className={`font-semibold text-sm truncate block ${isMapped ? 'text-gray-800' : 'text-gray-500'}`} title={field.description}>
                        {field.name}
                      </span>
                      <span className="text-xs text-gray-300">{field.dataType}</span>
                    </div>
                    {field.isRequired && (
                      <span className="text-red-400 text-sm font-bold shrink-0 mt-0.5" title="Required">*</span>
                    )}
                  </div>

                  {/* Rule type selector */}
                  <div className="px-3 py-3">
                    <select
                      value={rule.ruleType}
                      onChange={e => setFieldRule(field.id, { ruleType: e.target.value, config: {} })}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400"
                    >
                      {RULE_TYPES.map(rt => (
                        <option key={rt.value} value={rt.value}>{rt.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Configuration editor */}
                  <div className="px-4 py-3">
                    {rule.ruleType === '' && (
                      <span className="text-xs text-gray-300 italic">—</span>
                    )}
                    {rule.ruleType === 'direct' && (
                      <DirectEditor config={rule.config} onChange={c => setFieldRule(field.id, { config: c })} {...sharedEditorProps} />
                    )}
                    {rule.ruleType === 'constant' && (
                      <ConstantEditor config={rule.config} onChange={c => setFieldRule(field.id, { config: c })} />
                    )}
                    {rule.ruleType === 'uuid' && (
                      <span className="text-sm text-purple-500 italic">A new UUID will be generated for each row.</span>
                    )}
                    {rule.ruleType === 'incremental' && (
                      <IncrementalEditor config={rule.config} onChange={c => setFieldRule(field.id, { config: c })} />
                    )}
                    {rule.ruleType === 'expression' && (
                      <ExpressionEditor config={rule.config} onChange={c => setFieldRule(field.id, { config: c })} />
                    )}
                    {rule.ruleType === 'concat' && (
                      <ConcatEditor config={rule.config} onChange={c => setFieldRule(field.id, { config: c })} {...sharedEditorProps} />
                    )}
                    {rule.ruleType === 'split' && (
                      <SplitEditor config={rule.config} onChange={c => setFieldRule(field.id, { config: c })} {...sharedEditorProps} />
                    )}
                    {rule.ruleType === 'dateformat' && (
                      <DateFormatEditor config={rule.config} onChange={c => setFieldRule(field.id, { config: c })} {...sharedEditorProps} />
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 shrink-0 flex items-center justify-between">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-violet-600 text-white text-sm font-medium rounded-xl hover:bg-violet-700 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : 'Save rules'}
          </button>
        </div>

      </div>
    </div>
  )
}
