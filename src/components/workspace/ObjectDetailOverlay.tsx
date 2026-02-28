import { useState, useEffect } from 'react'
import type { DataObject, ObjectField } from '../../types/index.js'

const TYPE_COLORS: Record<string, string> = {
  string: 'bg-gray-100 text-gray-600',
  integer: 'bg-blue-50 text-blue-600',
  float: 'bg-cyan-50 text-cyan-700',
  date: 'bg-amber-50 text-amber-700',
  datetime: 'bg-orange-50 text-orange-700',
  picklist: 'bg-purple-50 text-purple-700',
}

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

  // Load fields on mount
  useEffect(() => {
    window.electronAPI.getObject(object.id).then(({ fields: f }) => {
      setFields(f)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [object.id])

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
  const headers = fields.length > 0
    ? fields.map(f => f.displayName || f.name)
    : rows.length > 0 ? Object.keys(rows[0]) : []

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
            <SchemaTab fields={fields} />
          ) : (
            <DataTab
              headers={headers}
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

function SchemaTab({ fields }: { fields: ObjectField[] }) {
  if (fields.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-300 text-sm">
        No fields defined
      </div>
    )
  }

  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 sticky top-0">
        <tr>
          {['#', 'Field Name', 'Display Name', 'Type', 'Required'].map(h => (
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
            <td className="px-4 py-2.5 text-xs text-gray-600">{f.displayName || '—'}</td>
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
  )
}

// ── Data preview tab ──────────────────────────────────────────────────────────

function DataTab({
  headers, rows, page, totalPages, onPage,
}: {
  headers: string[]
  rows: Record<string, string>[]
  page: number
  totalPages: number
  onPage: (p: number) => void
}) {
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
                <th key={h} className="text-left px-3 py-2.5 font-semibold text-gray-500 whitespace-nowrap border-r border-gray-100 last:border-0">
                  {h}
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
