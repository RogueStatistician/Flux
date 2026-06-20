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

// ── Main overlay ──────────────────────────────────────────────────────────────

export function ObjectDetailOverlay({ object, onClose, onObjectUpdated }: Props) {
  const [tab, setTab] = useState<'schema' | 'data' | 'query'>(object.role === 'source' ? 'data' : 'schema')
  const [fields, setFields] = useState<ObjectField[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [picklists, setPicklists] = useState<Picklist[]>([])
  const [replacing, setReplacing] = useState(false)
  const [rowCount, setRowCount] = useState(object.rowCount)

  const handleReplaceData = async () => {
    const result = await platform.openFile({
      title: `Replace data for "${object.name}"`,
      filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return
    setReplacing(true)
    try {
      const { rowCount: newCount } = await platform.relinkSourceFile(object.id, result.filePaths[0])
      setRowCount(newCount)
      setTotal(newCount)
      setPage(0)
      onObjectUpdated({ ...object, rowCount: newCount })
      setTab('data')
      const { rows: r, total: t } = await platform.getRows(object.id, 0, PAGE_SIZE)
      setRows(r)
      setTotal(t)
    } catch (e) {
      alert(`Replace failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setReplacing(false)
    }
  }

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
                onClick={handleReplaceData}
                disabled={replacing}
                className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 text-gray-600 hover:text-blue-700 font-medium transition-colors disabled:opacity-50"
              >
                {replacing ? '↑ Replacing…' : '↑ Replace data'}
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-6 border-b flex gap-6 shrink-0">
          {(['schema', 'data', 'query'] as const)
            .filter(t => t === 'schema' || object.role === 'source')
            .map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={[
                  'py-3 text-sm font-medium border-b-2 transition-colors',
                  tab === t
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {t === 'schema' ? `Schema (${fields.length})` : t === 'data' ? `Data (${total.toLocaleString()})` : 'Query'}
              </button>
            ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading && tab !== 'query' ? (
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
          ) : tab === 'query' ? (
            <QueryTab objectId={object.id} fields={fields} />
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

// ── Query tab ─────────────────────────────────────────────────────────────────

const NO_VALUE_OPS = new Set(['is_empty', 'is_not_empty'])

const QUERY_OPS = [
  { value: '=',            label: 'equals' },
  { value: '!=',           label: 'not equals' },
  { value: 'contains',     label: 'contains' },
  { value: 'not_contains', label: "doesn't contain" },
  { value: 'starts_with',  label: 'starts with' },
  { value: 'ends_with',    label: 'ends with' },
  { value: 'is_empty',     label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
  { value: '>',            label: 'greater than' },
  { value: '<',            label: 'less than' },
]

const ALL_ROWS_LIMIT = 9999
const MAX_DISPLAY    = 500

interface QueryFilter {
  id: string
  field: string
  op: string
  value: string
}

function applyQueryFilter(row: Record<string, string>, f: QueryFilter): boolean {
  const cell = (row[f.field] ?? '').toLowerCase()
  const val  = f.value.toLowerCase()
  switch (f.op) {
    case '=':            return cell === val
    case '!=':           return cell !== val
    case 'contains':     return cell.includes(val)
    case 'not_contains': return !cell.includes(val)
    case 'starts_with':  return cell.startsWith(val)
    case 'ends_with':    return cell.endsWith(val)
    case 'is_empty':     return cell === ''
    case 'is_not_empty': return cell !== ''
    case '>':            return cell > val
    case '<':            return cell < val
    default:             return true
  }
}

function QueryTab({ objectId, fields }: { objectId: string; fields: ObjectField[] }) {
  const fieldNames = fields.map(f => f.name)

  const [allRows,       setAllRows]       = useState<Record<string, string>[]>([])
  const [loadTotal,     setLoadTotal]     = useState(0)
  const [loading,       setLoading]       = useState(true)
  const [filters,       setFilters]       = useState<QueryFilter[]>([])
  const [visibleCols,   setVisibleCols]   = useState<Set<string>>(() => new Set(fieldNames))
  const [distinct,      setDistinct]      = useState(false)
  const [colPickerOpen, setColPickerOpen] = useState(false)
  const colPickerRef = useRef<HTMLDivElement>(null)
  const colBtnRef    = useRef<HTMLButtonElement>(null)

  // Sync visible cols if fields arrive after first render
  const prevFieldCount = useRef(0)
  useEffect(() => {
    if (fieldNames.length !== prevFieldCount.current) {
      prevFieldCount.current = fieldNames.length
      setVisibleCols(new Set(fieldNames))
    }
  })

  useEffect(() => {
    setLoading(true)
    platform.getRows(objectId, 0, ALL_ROWS_LIMIT)
      .then(({ rows, total }) => { setAllRows(rows); setLoadTotal(total) })
      .finally(() => setLoading(false))
  }, [objectId])

  useEffect(() => {
    if (!colPickerOpen) return
    const handler = (e: MouseEvent) => {
      if (
        !colPickerRef.current?.contains(e.target as Node) &&
        !colBtnRef.current?.contains(e.target as Node)
      ) setColPickerOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [colPickerOpen])

  const allColNames = fieldNames.length > 0
    ? fieldNames
    : allRows.length > 0 ? Object.keys(allRows[0]) : []

  const effectiveCols = allColNames.filter(n => visibleCols.has(n))

  const activeFilters = filters.filter(f =>
    f.field && f.op && (f.value !== '' || NO_VALUE_OPS.has(f.op))
  )
  const filteredRows = activeFilters.length === 0
    ? allRows
    : allRows.filter(row => activeFilters.every(f => applyQueryFilter(row, f)))

  const resultRows = distinct
    ? (() => {
        const seen = new Set<string>()
        return filteredRows.filter(row => {
          const key = effectiveCols.map(c => row[c] ?? '').join('\x00')
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      })()
    : filteredRows

  const displayRows = resultRows.slice(0, MAX_DISPLAY)

  const addFilter = () => setFilters(prev => [
    ...prev,
    { id: crypto.randomUUID(), field: allColNames[0] ?? '', op: 'contains', value: '' },
  ])
  const removeFilter = (id: string) => setFilters(prev => prev.filter(f => f.id !== id))
  const updateFilter = (id: string, patch: Partial<QueryFilter>) =>
    setFilters(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))

  const toggleCol = (name: string) =>
    setVisibleCols(prev => {
      const next = new Set(prev)
      if (next.has(name)) { if (next.size > 1) next.delete(name) }
      else next.add(name)
      return next
    })

  if (loading) return (
    <div className="flex items-center justify-center h-40 text-gray-400 gap-2">
      <span className="animate-spin">⟳</span>
      <span className="text-sm">Loading…</span>
    </div>
  )

  if (allRows.length === 0) return (
    <div className="flex items-center justify-center h-40 text-gray-300 text-sm">
      No data — import a file first
    </div>
  )

  return (
    <div className="flex flex-col h-full">

      {/* Controls */}
      <div className="px-4 py-3 border-b bg-gray-50 shrink-0 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">

          {/* Distinct toggle */}
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={distinct}
              onChange={e => setDistinct(e.target.checked)}
              className="w-4 h-4 accent-blue-600 rounded"
            />
            Unique rows only
          </label>

          {/* Column picker */}
          <div className="relative">
            <button
              ref={colBtnRef}
              onClick={() => setColPickerOpen(v => !v)}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-600 font-medium flex items-center gap-1.5 transition-colors"
            >
              ⊞ Columns ({visibleCols.size}/{allColNames.length})
            </button>
            {colPickerOpen && (
              <div
                ref={colPickerRef}
                className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-1 min-w-[200px] max-h-72 overflow-y-auto"
              >
                <div className="px-3 py-1.5 flex gap-3 border-b border-gray-100 mb-1">
                  <button
                    onClick={() => setVisibleCols(new Set(allColNames))}
                    className="text-xs text-blue-600 hover:underline"
                  >All</button>
                  <button
                    onClick={() => { if (allColNames[0]) setVisibleCols(new Set([allColNames[0]])) }}
                    className="text-xs text-gray-400 hover:underline"
                  >None</button>
                </div>
                {allColNames.map(name => (
                  <label
                    key={name}
                    className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={visibleCols.has(name)}
                      onChange={() => toggleCol(name)}
                      className="w-3.5 h-3.5 accent-blue-600 shrink-0"
                    />
                    <span className="text-xs font-mono text-gray-700 truncate">{name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Add filter */}
          <button
            onClick={addFilter}
            className="text-xs px-3 py-1.5 border border-dashed border-gray-300 rounded-lg hover:bg-white text-gray-500 hover:text-gray-700 transition-colors"
          >
            + Add filter
          </button>
        </div>

        {/* Filter rows */}
        {filters.map(f => (
          <div key={f.id} className="flex items-center gap-2 flex-wrap">
            <select
              value={f.field}
              onChange={e => updateFilter(f.id, { field: e.target.value })}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              {allColNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <select
              value={f.op}
              onChange={e => updateFilter(f.id, { op: e.target.value, value: '' })}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              {QUERY_OPS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
            </select>
            {!NO_VALUE_OPS.has(f.op) && (
              <input
                value={f.value}
                onChange={e => updateFilter(f.id, { value: e.target.value })}
                placeholder="value…"
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 w-36 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            )}
            <button
              onClick={() => removeFilter(f.id)}
              className="text-gray-300 hover:text-red-400 text-sm transition-colors"
              title="Remove filter"
            >✕</button>
          </div>
        ))}
      </div>

      {/* Row count */}
      <div className="px-4 py-1.5 border-b shrink-0 text-xs text-gray-400 flex items-center gap-1 bg-white">
        <span className="font-semibold text-gray-700">{resultRows.length.toLocaleString()}</span>
        <span>of {allRows.length.toLocaleString()} rows</span>
        {loadTotal > allRows.length && (
          <span className="ml-1 text-amber-500">
            · source has {loadTotal.toLocaleString()} rows, showing first {ALL_ROWS_LIMIT.toLocaleString()}
          </span>
        )}
        {resultRows.length > MAX_DISPLAY && (
          <span className="ml-1 text-amber-500">· display capped at {MAX_DISPLAY}</span>
        )}
      </div>

      {/* Results table */}
      <div className="flex-1 overflow-auto">
        {displayRows.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-300 text-sm">
            No rows match the current filters
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {effectiveCols.map(h => (
                  <th
                    key={h}
                    className="text-left px-3 py-2.5 font-semibold text-gray-500 whitespace-nowrap border-r border-gray-100 last:border-0"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayRows.map((row, i) => (
                <tr key={i} className="hover:bg-blue-50/30">
                  {effectiveCols.map(h => (
                    <td key={h} className="px-3 py-2 text-gray-700 whitespace-nowrap border-r border-gray-50 last:border-0">
                      {row[h] || <span className="text-gray-300">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
