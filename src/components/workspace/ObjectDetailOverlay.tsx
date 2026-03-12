import { useState, useEffect, useRef } from 'react'
import { platform } from '@/platform/index'
import type { DataObject, ObjectField, Picklist } from '../../types/index.js'

const TYPE_COLORS: Record<string, string> = {
  string: 'bg-gray-100 text-gray-600',
  integer: 'bg-blue-50 text-blue-600',
  float: 'bg-cyan-50 text-cyan-700',
  date: 'bg-amber-50 text-amber-700',
  datetime: 'bg-orange-50 text-orange-700',
  picklist: 'bg-purple-50 text-purple-700',
}

const FIELD_TYPES = ['string', 'integer', 'float', 'date', 'datetime', 'picklist'] as const

const PAGE_SIZE = 50

interface Props {
  object: DataObject
  onClose: () => void
  onObjectUpdated: (obj: DataObject) => void
}

// ── Replace Data Modal ────────────────────────────────────────────────────────

function ReplaceDataModal({
  object,
  onClose,
  onReplaced,
}: {
  object: DataObject
  onClose: () => void
  onReplaced: (newRowCount: number) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [filePath, setFilePath] = useState<string>('')
  const [fileName, setFileName] = useState<string>('')
  const [headerRow, setHeaderRow] = useState(object.templateHeaderRow ?? 0)
  const [dataStartRow, setDataStartRow] = useState(object.templateDataStartRow ?? (object.templateHeaderRow ?? 0) + 1)
  const [preview, setPreview] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadPreview(fp: string, skipRows: number) {
    try {
      const res = await platform.inferSchema(fp, { skipRows })
      setPreview({ headers: res.headers ?? [], rows: (res.rows ?? []).slice(0, 8) })
      setError(null)
    } catch (e) {
      setError(`Preview failed: ${e instanceof Error ? e.message : String(e)}`)
      setPreview(null)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const fp = (file as unknown as { path: string }).path
    setFilePath(fp)
    setFileName(file.name)
    loadPreview(fp, headerRow)
  }

  function handleHeaderRowChange(v: number) {
    setHeaderRow(v)
    const newDataStart = Math.max(v + 1, dataStartRow)
    setDataStartRow(newDataStart)
    if (filePath) loadPreview(filePath, v)
  }

  async function handleImport() {
    if (!filePath) return
    setImporting(true)
    setError(null)
    try {
      const opts: { skipRows: number; dataStartRow?: number } = { skipRows: headerRow }
      if (dataStartRow !== headerRow + 1) opts.dataStartRow = dataStartRow
      await platform.importRows(object.id, filePath, opts)
      // Get updated row count from a fresh getRows call (total field)
      const { total } = await platform.getRows(object.id, 0, 1)
      onReplaced(total)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
      setImporting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-6"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 'min(95vw, 860px)', maxHeight: 'min(90vh, 700px)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b bg-blue-50 shrink-0 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-0.5">Replace source data</p>
            <p className="text-base font-semibold text-gray-900">{object.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Existing rows will be replaced. Schema and transformation rules are unchanged.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none shrink-0">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* File picker */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Select file</p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => fileRef.current?.click()}
                className="px-4 py-2 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Browse…
              </button>
              <span className="text-sm text-gray-500">{fileName || 'No file selected'}</span>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
            </div>
          </div>

          {/* Parse options */}
          <div className="flex items-center gap-6 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              Header row
              <input
                type="number"
                min={0}
                value={headerRow + 1}
                onChange={e => handleHeaderRowChange(Math.max(0, Number(e.target.value) - 1))}
                className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <span className="text-xs text-gray-400">(1 = first row)</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              Data starts at row
              <input
                type="number"
                min={headerRow + 2}
                value={dataStartRow + 1}
                onChange={e => setDataStartRow(Math.max(headerRow + 1, Number(e.target.value) - 1))}
                className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <span className="text-xs text-gray-400">(1 = first row)</span>
            </label>
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Preview (first {preview.rows.length} data rows)
              </p>
              <div className="overflow-auto border border-gray-100 rounded-xl" style={{ maxHeight: 260 }}>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      {preview.headers.map(h => (
                        <th key={h} className="text-left px-3 py-2 font-semibold text-gray-500 whitespace-nowrap border-r border-gray-100 last:border-0">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {preview.rows.map((row, i) => (
                      <tr key={i}>
                        {preview.headers.map(h => (
                          <td key={h} className="px-3 py-1.5 text-gray-700 whitespace-nowrap border-r border-gray-50 last:border-0">
                            {row[h] ?? <span className="text-gray-300">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 shrink-0 flex items-center justify-between">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!filePath || importing}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {importing ? 'Importing…' : 'Replace data'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main overlay ──────────────────────────────────────────────────────────────

export function ObjectDetailOverlay({ object, onClose, onObjectUpdated }: Props) {
  const [tab, setTab] = useState<'schema' | 'data'>(object.role === 'source' ? 'data' : 'schema')
  const [fields, setFields] = useState<ObjectField[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [picklists, setPicklists] = useState<Picklist[]>([])
  const [showReplaceModal, setShowReplaceModal] = useState(false)
  const [rowCount, setRowCount] = useState(object.rowCount)

  // Load fields on mount
  useEffect(() => {
    platform.getObject(object.id).then(({ fields: f }) => {
      setFields(f)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [object.id])

  // Load picklists for the matching side
  useEffect(() => {
    platform.listPicklists(object.role === 'source' ? 'source' : 'target')
      .then(setPicklists)
      .catch(() => {})
  }, [object.role])

  // Load data rows when on data tab
  useEffect(() => {
    if (tab !== 'data' || object.role !== 'source') return
    setLoading(true)
    platform.getRows(object.id, page * PAGE_SIZE, PAGE_SIZE).then(({ rows: r, total: t }) => {
      setRows(r)
      setTotal(t)
    }).finally(() => setLoading(false))
  }, [tab, object.id, object.role, page])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const handleFieldsSaved = (updated: ObjectField[]) => {
    setFields(updated)
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel (slide in from right) */}
      <div className="relative ml-auto bg-white shadow-2xl w-full max-w-4xl flex flex-col h-full">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-start justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-base font-semibold text-gray-800">{object.name}</p>
              <span className={[
                'text-xs font-semibold px-2 py-0.5 rounded-full',
                object.role === 'source' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700',
              ].join(' ')}>
                {object.role.toUpperCase()}
              </span>
            </div>
            <div className="flex gap-4 mt-1 text-xs text-gray-400">
              {object.systemName && <span>{object.systemName}</span>}
              {object.fileName && <span>{object.fileName}</span>}
              {object.role === 'source' && rowCount !== undefined && (
                <span>{rowCount.toLocaleString()} rows</span>
              )}
              <span>{fields.length} field{fields.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {object.role === 'source' && (
              <button
                onClick={() => setShowReplaceModal(true)}
                className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 text-gray-600 hover:text-blue-700 font-medium transition-colors"
              >
                ↑ Replace data
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-6 border-b flex gap-6 shrink-0">
          {(['schema', 'data'] as const).filter(t => t !== 'data' || object.role === 'source').map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'py-3 text-sm font-medium border-b-2 transition-colors capitalize',
                tab === t
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              {t === 'schema' ? `Schema (${fields.length})` : `Data (${total.toLocaleString()})`}
            </button>
          ))}
        </div>

        {/* Replace data modal */}
        {showReplaceModal && (
          <ReplaceDataModal
            object={object}
            onClose={() => setShowReplaceModal(false)}
            onReplaced={newCount => {
              setRowCount(newCount)
              setTotal(newCount)
              setPage(0)
              onObjectUpdated({ ...object, rowCount: newCount })
              // Reload the data tab
              setTab('data')
              platform.getRows(object.id, 0, PAGE_SIZE).then(({ rows: r, total: t }) => {
                setRows(r)
                setTotal(t)
              }).catch(() => {})
            }}
          />
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-gray-400 gap-2">
              <span className="animate-spin">⟳</span>
              <span className="text-sm">Loading…</span>
            </div>
          ) : tab === 'schema' ? (
            <SchemaTab
              objectId={object.id}
              fields={fields}
              picklists={picklists}
              onFieldsSaved={handleFieldsSaved}
            />
          ) : (
            <DataTab
              fields={fields}
              rows={rows}
              page={page}
              totalPages={totalPages}
              onPage={setPage}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Schema tab ────────────────────────────────────────────────────────────────

interface EditableField {
  id: string
  name: string
  description?: string
  dataType: typeof FIELD_TYPES[number]
  isRequired: boolean
  isNullable: boolean
  picklistId?: string
  dateFormat?: string
  maxLength?: number
  notes?: string
}

function SchemaTab({ objectId, fields, picklists, onFieldsSaved }: {
  objectId: string
  fields: ObjectField[]
  picklists: Picklist[]
  onFieldsSaved: (fields: ObjectField[]) => void
}) {
  const [editMode, setEditMode] = useState(false)
  const [editedFields, setEditedFields] = useState<EditableField[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  function enterEdit() {
    setEditedFields(fields.map(f => ({
      id: f.id,
      name: f.name,
      description: f.description,
      dataType: f.dataType as typeof FIELD_TYPES[number],
      isRequired: f.isRequired,
      isNullable: f.isNullable,
      picklistId: f.picklistId,
      dateFormat: f.dateFormat,
      maxLength: f.maxLength,
      notes: f.notes,
    })))
    setSaveError(null)
    setEditMode(true)
  }

  function updateField(id: string, patch: Partial<EditableField>) {
    setEditedFields(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await platform.upsertFields(
        objectId,
        editedFields.map(({ id: _id, ...f }) => f)
      )
      onFieldsSaved(updated)
      setEditMode(false)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  if (fields.length === 0 && !editMode) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-300 text-sm">
        No fields defined
      </div>
    )
  }

  // ── Edit mode ──────────────────────────────────────────────────────────────
  if (editMode) {
    return (
      <div className="flex flex-col h-full">
        {saveError && (
          <div className="mx-4 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
            {saveError}
          </div>
        )}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {['#', 'Field Name', 'Description', 'Type', 'Picklist', 'Req'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {editedFields.map((f, i) => (
                <tr key={f.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs text-gray-400">{i + 1}</td>
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs text-gray-700">{f.name}</span>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      value={f.description ?? ''}
                      onChange={e => updateField(f.id, { description: e.target.value || undefined })}
                      className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      placeholder="Add description…"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={f.dataType}
                      onChange={e => updateField(f.id, {
                        dataType: e.target.value as typeof FIELD_TYPES[number],
                        picklistId: e.target.value !== 'picklist' ? undefined : f.picklistId,
                      })}
                      className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                    >
                      {FIELD_TYPES.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    {f.dataType === 'picklist' ? (
                      <select
                        value={f.picklistId ?? ''}
                        onChange={e => updateField(f.id, { picklistId: e.target.value || undefined })}
                        className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-400 bg-white"
                      >
                        <option value="">— none —</option>
                        {picklists.map(pl => (
                          <option key={pl.id} value={pl.id}>{pl.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={f.isRequired}
                      onChange={e => updateField(f.id, { isRequired: e.target.checked })}
                      className="w-4 h-4 accent-blue-600 cursor-pointer"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-3 flex items-center justify-between shrink-0 bg-white">
          <button
            onClick={() => setEditMode(false)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    )
  }

  // ── View mode ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['#', 'Field Name', 'Description', 'Type', 'Required'].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {fields.map((f, i) => (
              <tr key={f.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 text-xs text-gray-400">{i + 1}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{f.name}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500 max-w-xs">
                  {f.description
                    ? <span title={f.description}>{f.description}</span>
                    : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[f.dataType] ?? 'bg-gray-100 text-gray-600'}`}>
                    {f.dataType}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {f.isRequired
                    ? <span className="text-red-500 font-medium">Yes</span>
                    : <span className="text-gray-300">No</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t px-4 py-3 flex justify-end shrink-0 bg-white">
        <button
          onClick={enterEdit}
          className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 font-medium"
        >
          ✏ Edit schema
        </button>
      </div>
    </div>
  )
}

// ── Data preview tab ──────────────────────────────────────────────────────────

function DataTab({
  fields, rows, page, totalPages, onPage,
}: {
  fields: ObjectField[]
  rows: Record<string, string>[]
  page: number
  totalPages: number
  onPage: (p: number) => void
}) {
  // Use field name as column key; show description as tooltip on header
  const headers = fields.length > 0
    ? fields.map(f => f.name)
    : rows.length > 0 ? Object.keys(rows[0]) : []

  const fieldByName = Object.fromEntries(fields.map(f => [f.name, f]))

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-300 text-sm">
        No data — import a file to see rows
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {headers.map(h => (
                <th
                  key={h}
                  title={fieldByName[h]?.description}
                  className="text-left px-3 py-2.5 font-semibold text-gray-500 whitespace-nowrap border-r border-gray-100 last:border-0 cursor-default"
                >
                  {h}
                  {fieldByName[h]?.description && (
                    <span className="ml-1 text-gray-300 text-xs">ⓘ</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-blue-50/30">
                {headers.map(h => (
                  <td key={h} className="px-3 py-2 text-gray-700 break-words border-r border-gray-50 last:border-0" title={row[h]}>
                    {row[h] || <span className="text-gray-300">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="border-t px-4 py-2.5 flex items-center justify-between shrink-0 bg-white">
          <span className="text-xs text-gray-400">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => onPage(page - 1)}
              className="text-xs px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
            >
              ← Prev
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => onPage(page + 1)}
              className="text-xs px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
