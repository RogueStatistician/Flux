/**
 * ImportWizard — 3-step overlay for importing a data object.
 *
 * Sources:  file → infer schema → edit schema → metadata → create + import rows
 * Targets:  file (headers only) OR manual → edit/build schema → metadata → create
 */
import { useState, useEffect } from 'react'
import type { DataObject, InferredField, ObjectRole, OutputFormat } from '../../types/index.js'

type Step = 'schema' | 'details' | 'saving'
type FieldType = InferredField['dataType']

const FIELD_TYPES: FieldType[] = ['string', 'integer', 'float', 'date', 'datetime', 'picklist']

interface Props {
  role: ObjectRole
  /** Absolute path to the uploaded file. null = manual target (no file). */
  filePath: string | null
  onDone: (object: DataObject) => void
  onCancel: () => void
}

interface EditableField extends InferredField {
  _key: string
}

function makeKey() { return Math.random().toString(36).slice(2) }

export function ImportWizard({ role, filePath, onDone, onCancel }: Props) {
  const [step, setStep] = useState<Step>('schema')
  const [fields, setFields] = useState<EditableField[]>([])
  const [loadingSchema, setLoadingSchema] = useState(false)
  const [schemaError, setSchemaError] = useState<string | null>(null)

  // Details form
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [systemName, setSystemName] = useState('')
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('xlsx')
  const [saveError, setSaveError] = useState<string | null>(null)

  // Infer schema on mount when a filePath is provided
  useEffect(() => {
    if (!filePath) return
    setLoadingSchema(true)
    const inferFn = role === 'target'
      ? window.electronAPI.inferSchemaFromHeaders(filePath)
      : window.electronAPI.inferSchema(filePath)

    inferFn.then(({ fields: inferred }) => {
      setFields(inferred.map(f => ({ ...f, _key: makeKey() })))
      // Pre-fill name from filename
      const base = filePath.split(/[\\/]/).pop() ?? ''
      setName(base.replace(/\.[^.]+$/, ''))
    }).catch(e => {
      setSchemaError(e instanceof Error ? e.message : 'Failed to read file.')
    }).finally(() => setLoadingSchema(false))
  }, [filePath, role])

  // ── Field editing helpers ─────────────────────────────────────────────────

  function updateField(key: string, patch: Partial<EditableField>) {
    setFields(prev => prev.map(f => f._key === key ? { ...f, ...patch } : f))
  }

  function addField() {
    setFields(prev => [...prev, {
      _key: makeKey(), name: '', displayName: '', dataType: 'string',
      isRequired: false, isNullable: true,
    }])
  }

  function removeField(key: string) {
    setFields(prev => prev.filter(f => f._key !== key))
  }

  // ── Step handlers ─────────────────────────────────────────────────────────

  const goToDetails = () => {
    if (fields.some(f => !f.name.trim())) {
      setSchemaError('All fields must have a name.')
      return
    }
    setSchemaError(null)
    setStep('details')
  }

  const handleSave = async () => {
    if (!name.trim()) return
    setStep('saving')
    setSaveError(null)
    try {
      const object = await window.electronAPI.createObject(
        role, name.trim(), description.trim() || undefined,
        systemName.trim() || undefined,
        role === 'target' ? outputFormat : 'xlsx'
      )

      if (fields.length > 0) {
        await window.electronAPI.upsertFields(
          object.id,
          fields.map(({ _key: _k, ...f }) => f)
        )
      }

      if (role === 'source' && filePath) {
        await window.electronAPI.importRows(object.id, filePath)
      }

      onDone(object)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to create object.')
      setStep('details')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <div>
            <p className="text-sm font-semibold text-gray-800">
              {role === 'source' ? 'Import Source' : 'Add Target'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 'schema' ? 'Review inferred schema'
                : step === 'details' ? 'Object details'
                : 'Creating…'}
            </p>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'schema' && (
            <SchemaStep
              loading={loadingSchema}
              error={schemaError}
              fields={fields}
              onUpdateField={updateField}
              onAddField={addField}
              onRemoveField={removeField}
            />
          )}

          {step === 'details' && (
            <DetailsStep
              role={role}
              name={name} onName={setName}
              description={description} onDescription={setDescription}
              systemName={systemName} onSystemName={setSystemName}
              outputFormat={outputFormat} onOutputFormat={setOutputFormat}
              error={saveError}
            />
          )}

          {step === 'saving' && (
            <div className="flex items-center justify-center h-32 gap-3 text-gray-400">
              <span className="animate-spin text-lg">⟳</span>
              <span className="text-sm">Creating object…</span>
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== 'saving' && (
          <div className="px-6 py-4 border-t flex items-center justify-between shrink-0">
            <button
              onClick={step === 'details' ? () => setStep('schema') : onCancel}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              {step === 'details' ? '← Back' : 'Cancel'}
            </button>
            <button
              onClick={step === 'schema' ? goToDetails : handleSave}
              disabled={step === 'details' && !name.trim()}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {step === 'schema' ? 'Next →' : role === 'source' ? 'Create & Import' : 'Create'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Schema step ───────────────────────────────────────────────────────────────

function SchemaStep({
  loading, error, fields, onUpdateField, onAddField, onRemoveField,
}: {
  loading: boolean
  error: string | null
  fields: EditableField[]
  onUpdateField: (key: string, patch: Partial<EditableField>) => void
  onAddField: () => void
  onRemoveField: (key: string) => void
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 gap-3 text-gray-400">
        <span className="animate-spin text-lg">⟳</span>
        <span className="text-sm">Reading file…</span>
      </div>
    )
  }

  return (
    <div>
      {error && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
          {error}
        </div>
      )}

      <div className="text-xs text-gray-500 mb-3">
        {fields.length} field{fields.length !== 1 ? 's' : ''} detected — edit as needed before continuing.
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[2fr_2fr_1.5fr_auto_auto] gap-2 px-2 mb-1">
        {['Column name', 'Display name', 'Type', 'Req', ''].map(h => (
          <span key={h} className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</span>
        ))}
      </div>

      <div className="space-y-1.5 max-h-80 overflow-y-auto">
        {fields.map(f => (
          <div key={f._key} className="grid grid-cols-[2fr_2fr_1.5fr_auto_auto] gap-2 items-center px-2 py-1 rounded-lg hover:bg-gray-50">
            <input
              value={f.name}
              onChange={e => onUpdateField(f._key, { name: e.target.value })}
              className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="field_name"
            />
            <input
              value={f.displayName}
              onChange={e => onUpdateField(f._key, { displayName: e.target.value })}
              className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="Display Name"
            />
            <select
              value={f.dataType}
              onChange={e => onUpdateField(f._key, { dataType: e.target.value as FieldType })}
              className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
            >
              {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              type="checkbox"
              checked={f.isRequired}
              onChange={e => onUpdateField(f._key, { isRequired: e.target.checked })}
              className="w-4 h-4 accent-blue-600 cursor-pointer"
            />
            <button
              onClick={() => onRemoveField(f._key)}
              className="text-gray-300 hover:text-red-400 text-xs leading-none w-4 text-center"
            >✕</button>
          </div>
        ))}
      </div>

      <button
        onClick={onAddField}
        className="mt-3 text-xs text-blue-600 hover:text-blue-800 font-medium"
      >
        + Add field
      </button>
    </div>
  )
}

// ── Details step ──────────────────────────────────────────────────────────────

function DetailsStep({
  role, name, onName, description, onDescription,
  systemName, onSystemName, outputFormat, onOutputFormat, error,
}: {
  role: ObjectRole
  name: string; onName: (v: string) => void
  description: string; onDescription: (v: string) => void
  systemName: string; onSystemName: (v: string) => void
  outputFormat: OutputFormat; onOutputFormat: (v: OutputFormat) => void
  error: string | null
}) {
  return (
    <div className="space-y-4">
      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
          {error}
        </div>
      )}

      <Field label="Name *">
        <input
          autoFocus
          value={name}
          onChange={e => onName(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g. SF Employee Export"
        />
      </Field>

      <Field label="System name">
        <input
          value={systemName}
          onChange={e => onSystemName(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g. SAP SuccessFactors"
        />
      </Field>

      <Field label="Description">
        <textarea
          value={description}
          onChange={e => onDescription(e.target.value)}
          rows={2}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          placeholder="Optional description…"
        />
      </Field>

      {role === 'target' && (
        <Field label="Output format">
          <div className="flex gap-3">
            {(['xlsx', 'csv'] as OutputFormat[]).map(fmt => (
              <label key={fmt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value={fmt}
                  checked={outputFormat === fmt}
                  onChange={() => onOutputFormat(fmt)}
                  className="accent-blue-600"
                />
                <span className="text-sm text-gray-700">{fmt === 'xlsx' ? 'Excel (.xlsx)' : 'CSV (.csv)'}</span>
              </label>
            ))}
          </div>
        </Field>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}
