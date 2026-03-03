/**
 * ImportWizard — 3-step overlay for importing a data object.
 *
 * Sources:  file → infer schema → edit schema → metadata → create + import rows
 * Targets:  file (headers only) OR manual → edit/build schema → metadata → create
 *
 * Layout options (all file types):
 *   • Header row    — 1-based row number that contains column names.
 *   • Skip columns  — number of leading columns to ignore when reading/writing data.
 * These are particularly useful for Workday templates, which ship with several
 * metadata rows above the actual header and sometimes fixed columns on the left.
 * The engine uses this information to preserve the preamble rows and column
 * offsets so the output file matches the input template structure exactly.
 *
 * CSV import: additionally allows a custom column separator.
 * Picklist fields: user can reference which picklist the field maps to.
 */
import { useState, useEffect, useCallback } from 'react'
import type { DataObject, InferredField, ObjectRole, OutputFormat, Picklist } from '../../types/index.js'

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

interface EditableField {
  _key: string
  name: string
  dataType: FieldType
  isRequired: boolean
  isNullable: boolean
  description?: string
  picklistId?: string
  dateFormat?: string
}

function makeKey() { return Math.random().toString(36).slice(2) }

function isCsvPath(p: string | null): boolean {
  return Boolean(p?.toLowerCase().endsWith('.csv'))
}

export function ImportWizard({ role, filePath, onDone, onCancel }: Props) {
  const [step, setStep] = useState<Step>('schema')
  const [fields, setFields] = useState<EditableField[]>([])
  const [loadingSchema, setLoadingSchema] = useState(false)
  const [schemaError, setSchemaError] = useState<string | null>(null)

  // File layout options
  const isCsv = isCsvPath(filePath)
  const [separator, setSeparator] = useState(',')
  /**
   * headerRow  — 1-indexed row that contains the column names used for field-
   *              name inference and mapping.
   * dataStartRow — 1-indexed row where transformed data begins in the output.
   *              Defaults to headerRow + 1 and auto-follows headerRow changes
   *              unless the user has set it independently.
   */
  const [headerRow, setHeaderRow] = useState(1)
  const [dataStartRow, setDataStartRow] = useState(2)
  const [dataStartRowLinked, setDataStartRowLinked] = useState(true) // follows headerRow
  const [skipColumns, setSkipColumns] = useState(0)

  function handleHeaderRowChange(v: number) {
    setHeaderRow(v)
    if (dataStartRowLinked) setDataStartRow(v + 1)
  }

  function handleDataStartRowChange(v: number) {
    setDataStartRow(v)
    setDataStartRowLinked(false)
  }

  // Picklists for the matching role side
  const [picklists, setPicklists] = useState<Picklist[]>([])

  // Details form
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [systemName, setSystemName] = useState('')
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('xlsx')
  const [saveError, setSaveError] = useState<string | null>(null)

  // Load picklists for the matching side once
  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.listPicklists(role === 'source' ? 'source' : 'target')
      .then(setPicklists)
      .catch(() => {})
  }, [role])

  // ── Schema loading ─────────────────────────────────────────────────────────

  const loadSchema = useCallback(async (sep: string, hRow: number, skipCols: number) => {
    if (!filePath) return
    setLoadingSchema(true)
    setSchemaError(null)
    try {
      // Convert 1-indexed headerRow to 0-indexed skipRows for the backend.
      const skipRows = Math.max(0, hRow - 1)
      const opts = {
        ...(isCsv && sep !== ',' ? { separator: sep } : {}),
        ...(skipRows > 0 ? { skipRows } : {}),
        ...(skipCols > 0 ? { skipColumns: skipCols } : {}),
      }
      const hasOpts = Object.keys(opts).length > 0
      const inferFn = role === 'target'
        ? window.electronAPI.inferSchemaFromHeaders(filePath, hasOpts ? opts : undefined)
        : window.electronAPI.inferSchema(filePath, hasOpts ? opts : undefined)
      const { fields: inferred } = await inferFn
      setFields(inferred.map(f => ({
        _key: makeKey(),
        name: f.name,
        dataType: f.dataType,
        isRequired: f.isRequired,
        isNullable: f.isNullable,
        dateFormat: f.dateFormat,
      })))
      setName(prev => prev || (filePath.split(/[\\/]/).pop() ?? '').replace(/\.[^.]+$/, ''))
    } catch (e) {
      setSchemaError(e instanceof Error ? e.message : 'Failed to read file.')
    } finally {
      setLoadingSchema(false)
    }
  }, [filePath, role, isCsv])

  // Auto-load on mount — only schema/header-row options affect field inference
  useEffect(() => {
    loadSchema(separator, headerRow, skipColumns)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // User re-triggers via button after changing layout options

  // ── Field editing helpers ─────────────────────────────────────────────────

  function updateField(key: string, patch: Partial<EditableField>) {
    setFields(prev => prev.map(f => f._key === key ? { ...f, ...patch } : f))
  }

  function addField() {
    setFields(prev => [...prev, {
      _key: makeKey(), name: '', dataType: 'string',
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
      // Build template config for target objects that were uploaded from a file.
      // Convert 1-indexed UI values to 0-indexed for the backend.
      const headerRow0 = Math.max(0, headerRow - 1)
      const dataStartRow0 = Math.max(0, dataStartRow - 1)
      const templateConfig = (role === 'target' && filePath)
        ? {
            headerRow: headerRow0,
            // Only store dataStartRow when it differs from the natural default
            // (headerRow + 1) so older DB rows without the column still work.
            dataStartRow: dataStartRow0 !== headerRow0 + 1 ? dataStartRow0 : undefined,
            skipColumns: skipColumns > 0 ? skipColumns : undefined,
            filePath,
          }
        : undefined

      const object = await window.electronAPI.createObject(
        role, name.trim(), description.trim() || undefined,
        systemName.trim() || undefined,
        role === 'target' ? outputFormat : 'xlsx',
        templateConfig
      )

      if (fields.length > 0) {
        await window.electronAPI.upsertFields(
          object.id,
          fields.map(({ _key: _k, ...f }) => f)
        )
      }

      if (role === 'source' && filePath) {
        const skipRows = Math.max(0, headerRow - 1)
        const opts = {
          ...(isCsv && separator !== ',' ? { separator } : {}),
          ...(skipRows > 0 ? { skipRows } : {}),
          ...(skipColumns > 0 ? { skipColumns } : {}),
        }
        await window.electronAPI.importRows(
          object.id, filePath,
          Object.keys(opts).length ? opts : undefined
        )
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

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col mx-4">
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
              role={role}
              hasFile={!!filePath}
              isCsv={isCsv}
              separator={separator}
              onSeparator={setSeparator}
              headerRow={headerRow}
              onHeaderRow={handleHeaderRowChange}
              dataStartRow={dataStartRow}
              onDataStartRow={handleDataStartRowChange}
              dataStartRowLinked={dataStartRowLinked}
              skipColumns={skipColumns}
              onSkipColumns={setSkipColumns}
              onReInfer={() => loadSchema(separator, headerRow, skipColumns)}
              loading={loadingSchema}
              error={schemaError}
              fields={fields}
              picklists={picklists}
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
  role, hasFile, isCsv,
  separator, onSeparator,
  headerRow, onHeaderRow,
  dataStartRow, onDataStartRow, dataStartRowLinked,
  skipColumns, onSkipColumns,
  onReInfer,
  loading, error, fields, picklists, onUpdateField, onAddField, onRemoveField,
}: {
  role: ObjectRole
  hasFile: boolean
  isCsv: boolean
  separator: string; onSeparator: (v: string) => void
  headerRow: number; onHeaderRow: (v: number) => void
  dataStartRow: number; onDataStartRow: (v: number) => void
  dataStartRowLinked: boolean
  skipColumns: number; onSkipColumns: (v: number) => void
  onReInfer: () => void
  loading: boolean
  error: string | null
  fields: EditableField[]
  picklists: Picklist[]
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
      {/* File layout options — shown whenever a file was provided */}
      {hasFile && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-100 flex flex-wrap items-end gap-4">
          {isCsv && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Column separator</label>
              <input
                value={separator}
                onChange={e => onSeparator(e.target.value)}
                maxLength={3}
                className="w-20 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
                placeholder=","
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              Header row
              <span className="ml-1 text-gray-400 font-normal">(row with column names)</span>
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={headerRow}
              onChange={e => onHeaderRow(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-20 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          {role === 'target' && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                Data starts at row
                {dataStartRowLinked && (
                  <span className="ml-1 text-gray-400 font-normal">(auto)</span>
                )}
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={dataStartRow}
                onChange={e => onDataStartRow(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className={`w-20 border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                  dataStartRowLinked ? 'border-gray-200 bg-gray-50 text-gray-400' : 'border-blue-300 bg-white'
                }`}
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              Skip columns
              <span className="ml-1 text-gray-400 font-normal">(leading columns to ignore)</span>
            </label>
            <input
              type="number"
              min={0}
              max={20}
              value={skipColumns}
              onChange={e => onSkipColumns(Math.max(0, parseInt(e.target.value, 10) || 0))}
              className="w-20 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <button
            onClick={onReInfer}
            className="px-3 py-1 text-xs bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 font-medium"
          >
            ↺ Re-read schema
          </button>
          {role === 'target' && (dataStartRow > 1 || skipColumns > 0) && (
            <p className="w-full text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">
              Rows 1–{dataStartRow - 1} and
              {skipColumns > 0 ? ` the first ${skipColumns} column${skipColumns > 1 ? 's' : ''}` : ' all columns'}
              {' '}before column {skipColumns + 1} will be preserved unchanged in the output file.
            </p>
          )}
        </div>
      )}

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
        {['Column name', 'Description', 'Type', 'Req', ''].map(h => (
          <span key={h} className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</span>
        ))}
      </div>

      <div className="space-y-1.5 max-h-72 overflow-y-auto">
        {fields.map(f => (
          <div key={f._key} className="space-y-1">
            <div className="grid grid-cols-[2fr_2fr_1.5fr_auto_auto] gap-2 items-center px-2 py-1 rounded-lg hover:bg-gray-50">
              <input
                value={f.name}
                onChange={e => onUpdateField(f._key, { name: e.target.value })}
                className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
                placeholder="field_name"
              />
              <input
                value={f.description ?? ''}
                onChange={e => onUpdateField(f._key, { description: e.target.value || undefined })}
                className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="Optional description…"
              />
              <select
                value={f.dataType}
                onChange={e => onUpdateField(f._key, {
                  dataType: e.target.value as FieldType,
                  picklistId: e.target.value !== 'picklist' ? undefined : f.picklistId,
                })}
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
            {/* Picklist reference row */}
            {f.dataType === 'picklist' && (
              <div className="px-2 pb-1">
                <label className="text-xs text-gray-400 mr-2">Picklist:</label>
                <select
                  value={f.picklistId ?? ''}
                  onChange={e => onUpdateField(f._key, { picklistId: e.target.value || undefined })}
                  className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-400 bg-white"
                >
                  <option value="">— none —</option>
                  {picklists.map(pl => (
                    <option key={pl.id} value={pl.id}>{pl.name}</option>
                  ))}
                </select>
              </div>
            )}
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
