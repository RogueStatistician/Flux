import { useState, useEffect } from 'react'
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

export function ObjectDetailOverlay({ object, onClose, onObjectUpdated }: Props) {
  const [tab, setTab] = useState<'schema' | 'data'>(object.role === 'source' ? 'data' : 'schema')
  const [fields, setFields] = useState<ObjectField[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [picklists, setPicklists] = useState<Picklist[]>([])

  // Load fields on mount
  useEffect(() => {
    window.electronAPI.getObject(object.id).then(({ fields: f }) => {
      setFields(f)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [object.id])

  // Load picklists for the matching side
  useEffect(() => {
    window.electronAPI.listPicklists(object.role === 'source' ? 'source' : 'target')
      .then(setPicklists)
      .catch(() => {})
  }, [object.role])

  // Load data rows when on data tab
  useEffect(() => {
    if (tab !== 'data' || object.role !== 'source') return
    setLoading(true)
    window.electronAPI.getRows(object.id, page * PAGE_SIZE, PAGE_SIZE).then(({ rows: r, total: t }) => {
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
              {object.role === 'source' && object.rowCount !== undefined && (
                <span>{object.rowCount.toLocaleString()} rows</span>
              )}
              <span>{fields.length} field{fields.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none mt-1">✕</button>
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
      const updated = await window.electronAPI.upsertFields(
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
                  <td key={h} className="px-3 py-2 text-gray-700 max-w-[200px] truncate border-r border-gray-50 last:border-0" title={row[h]}>
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
