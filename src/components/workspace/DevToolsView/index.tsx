/**
 * DevToolsView — SQLite table browser + transformation query renderer.
 * Helps debug mapping issues by inspecting raw DB state and rendering
 * a human-readable description of what each transformation does.
 */
import { useState, useEffect, useCallback } from 'react'
import { platform } from '@/platform/index'
import type { TableInfo, TableQueryResult, TransformationQuery } from '@/platform/IPlatform'
import { useAppStore } from '../../../store/index'

// ── Shared UI atoms ───────────────────────────────────────────────────────────

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
        active
          ? 'border-blue-600 text-blue-600'
          : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

// ── DB Browser ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

function DbBrowser() {
  const [tables,       setTables]       = useState<TableInfo[]>([])
  const [selected,     setSelected]     = useState<string | null>(null)
  const [result,       setResult]       = useState<TableQueryResult | null>(null)
  const [page,         setPage]         = useState(0)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  const [sqlMode,      setSqlMode]      = useState(false)
  const [sqlDraft,     setSqlDraft]     = useState('')
  const [sqlResult,    setSqlResult]    = useState<TableQueryResult | null>(null)
  const [sqlError,     setSqlError]     = useState<string | null>(null)
  const [sqlLoading,   setSqlLoading]   = useState(false)

  useEffect(() => {
    platform.dbListTables().then(setTables).catch(() => {})
  }, [])

  const loadTable = useCallback(async (tableName: string, p: number) => {
    setLoading(true)
    setError(null)
    try {
      const r = await platform.dbQueryTable(tableName, p, PAGE_SIZE)
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load table.')
    } finally {
      setLoading(false)
    }
  }, [])

  const selectTable = (name: string) => {
    setSelected(name)
    setPage(0)
    loadTable(name, 0)
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    if (selected) loadTable(selected, newPage)
  }

  const runSql = async () => {
    setSqlLoading(true)
    setSqlError(null)
    setSqlResult(null)
    try {
      const r = await platform.dbRawQuery(sqlDraft)
      setSqlResult(r)
    } catch (e) {
      setSqlError(e instanceof Error ? e.message : 'Query failed.')
    } finally {
      setSqlLoading(false)
    }
  }

  const totalPages = result ? Math.ceil(result.total / PAGE_SIZE) : 0
  const displayResult = sqlMode ? sqlResult : result

  return (
    <div className="flex h-full overflow-hidden">
      {/* Table list */}
      <aside className="w-48 shrink-0 border-r border-gray-200 overflow-y-auto bg-gray-50">
        <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-200">
          Tables
        </div>
        {tables.map(t => (
          <button
            key={t.name}
            onClick={() => { setSqlMode(false); selectTable(t.name) }}
            className={[
              'w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-1 transition-colors',
              selected === t.name && !sqlMode
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'text-gray-700 hover:bg-gray-100',
            ].join(' ')}
          >
            <span className="truncate">{t.name}</span>
            <span className="shrink-0 text-gray-400 tabular-nums">{t.rowCount.toLocaleString()}</span>
          </button>
        ))}
        <button
          onClick={() => { setSqlMode(true); setSelected(null) }}
          className={[
            'w-full text-left px-3 py-2 text-xs font-medium transition-colors border-t border-gray-200 mt-1',
            sqlMode ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-100',
          ].join(' ')}
        >
          SQL Query…
        </button>
      </aside>

      {/* Main panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {sqlMode ? (
          <div className="flex flex-col h-full p-4 gap-3">
            <div className="flex items-center gap-2">
              <textarea
                value={sqlDraft}
                onChange={e => setSqlDraft(e.target.value)}
                placeholder="SELECT * FROM field_mappings WHERE rule_type = 'constant' LIMIT 100"
                rows={4}
                className="flex-1 font-mono text-xs border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runSql() } }}
              />
              <button
                onClick={runSql}
                disabled={sqlLoading || !sqlDraft.trim()}
                className="shrink-0 bg-blue-600 text-white text-xs font-medium px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {sqlLoading ? '…' : 'Run'}
              </button>
            </div>
            <p className="text-xs text-gray-400">Ctrl+Enter to run · SELECT only</p>
            {sqlError && <p className="text-xs text-red-600">{sqlError}</p>}
            {sqlResult && <DataGrid result={sqlResult} />}
          </div>
        ) : !selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
            Select a table to browse its rows
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
            Loading…
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center text-sm text-red-500">{error}</div>
        ) : displayResult ? (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Table header info */}
            <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold text-gray-700">{selected}</span>
              <span className="text-xs text-gray-400">
                {displayResult.total.toLocaleString()} rows · page {page + 1} of {Math.max(1, totalPages)}
              </span>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center gap-2 px-4 py-1.5 border-b border-gray-100 shrink-0">
                <button
                  onClick={() => handlePageChange(0)}
                  disabled={page === 0}
                  className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30"
                >«</button>
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page === 0}
                  className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30"
                >‹</button>
                <span className="text-xs text-gray-400 flex-1 text-center">
                  rows {(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, displayResult.total).toLocaleString()}
                </span>
                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages - 1}
                  className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30"
                >›</button>
                <button
                  onClick={() => handlePageChange(totalPages - 1)}
                  disabled={page >= totalPages - 1}
                  className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30"
                >»</button>
              </div>
            )}

            <DataGrid result={displayResult} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function DataGrid({ result }: { result: TableQueryResult }) {
  if (result.rows.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-sm text-gray-400">No rows</div>
  }

  const formatCell = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    if (typeof v === 'string' && v.length > 120) return v.slice(0, 117) + '…'
    return String(v)
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="min-w-full text-xs border-collapse">
        <thead className="sticky top-0 bg-gray-100 z-10">
          <tr>
            {result.columns.map(col => (
              <th
                key={col}
                className="px-3 py-2 text-left font-semibold text-gray-600 border-b border-gray-200 whitespace-nowrap"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              {result.columns.map(col => (
                <td
                  key={col}
                  className="px-3 py-1.5 border-b border-gray-100 text-gray-700 font-mono max-w-xs truncate"
                  title={String(row[col] ?? '')}
                >
                  {formatCell(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Query Renderer ────────────────────────────────────────────────────────────

const RULE_COLORS: Record<string, string> = {
  direct:           'bg-blue-100 text-blue-700',
  constant:         'bg-green-100 text-green-700',
  uuid:             'bg-purple-100 text-purple-700',
  incremental:      'bg-purple-100 text-purple-700',
  concat:           'bg-yellow-100 text-yellow-700',
  split:            'bg-yellow-100 text-yellow-700',
  substring:        'bg-yellow-100 text-yellow-700',
  dateformat:       'bg-orange-100 text-orange-700',
  picklisttranslate:'bg-teal-100 text-teal-700',
  expression:       'bg-pink-100 text-pink-700',
  conditional:      'bg-indigo-100 text-indigo-700',
  unmapped:         'bg-gray-100 text-gray-400',
}

function QueryRenderer() {
  const [transformations, setTransformations] = useState<Array<{ id: string; name: string }>>([])
  const [selectedId,      setSelectedId]      = useState<string | null>(null)
  const [queries,         setQueries]         = useState<TransformationQuery[]>([])
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState<string | null>(null)

  useEffect(() => {
    platform.listTransformations().then(ts => {
      setTransformations(ts.map(t => ({ id: t.id, name: t.name })))
    }).catch(() => {})
  }, [])

  const load = async (id: string) => {
    setLoading(true)
    setError(null)
    setQueries([])
    try {
      const result = await platform.renderTransformationQuery(id)
      setQueries(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to render query.')
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (id: string) => {
    setSelectedId(id)
    load(id)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Transformation selector */}
      <aside className="w-48 shrink-0 border-r border-gray-200 overflow-y-auto bg-gray-50">
        <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-200">
          Transformations
        </div>
        {transformations.length === 0 && (
          <p className="px-3 py-4 text-xs text-gray-400">No transformations found.</p>
        )}
        {transformations.map(t => (
          <button
            key={t.id}
            onClick={() => handleSelect(t.id)}
            className={[
              'w-full text-left px-3 py-2 text-xs transition-colors',
              selectedId === t.id
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'text-gray-700 hover:bg-gray-100',
            ].join(' ')}
          >
            {t.name}
          </button>
        ))}
      </aside>

      {/* Query plan */}
      <div className="flex-1 overflow-y-auto p-5">
        {!selectedId && (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Select a transformation to view its mapping plan
          </div>
        )}
        {loading && (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">Loading…</div>
        )}
        {error && (
          <div className="text-sm text-red-500">{error}</div>
        )}
        {!loading && queries.length === 0 && selectedId && !error && (
          <div className="text-sm text-gray-400">No field mappings found for this transformation.</div>
        )}
        <div className="space-y-6">
          {queries.map((q, qi) => (
            <div key={qi} className="border border-gray-200 rounded-lg overflow-hidden">
              {/* Target header */}
              <div className="bg-gray-800 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-sm font-semibold">{q.targetObject}</span>
                <span className="text-xs text-gray-400 font-mono">{q.targetObjectId.slice(0, 8)}…</span>
              </div>

              {q.paths.map((path, pi) => (
                <div key={pi} className={pi > 0 ? 'border-t border-gray-200' : ''}>
                  {/* Path header */}
                  <div className="bg-gray-50 px-4 py-2 flex items-center gap-4 text-xs flex-wrap">
                    {path.sourceObject ? (
                      <span className="flex items-center gap-1.5">
                        <span className="font-semibold text-gray-500">Source:</span>
                        <span className="font-medium text-gray-800">{path.sourceObject}</span>
                        {path.sourceRowCount !== null && (
                          <span className="text-gray-400">({path.sourceRowCount.toLocaleString()} rows)</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-amber-600 font-medium">No source connected</span>
                    )}
                    {path.mapNodeId && (
                      <span className="text-gray-400 font-mono">node: {path.mapNodeId.slice(0, 16)}…</span>
                    )}
                    {path.filters.length > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="font-semibold text-gray-500">Filters:</span>
                        {path.filters.map((f, fi) => (
                          <span key={fi} className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded text-xs">{f}</span>
                        ))}
                      </span>
                    )}
                  </div>

                  {/* Mappings table */}
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-t border-gray-100">
                        <th className="px-4 py-1.5 text-left font-semibold text-gray-500 w-48">Target field</th>
                        <th className="px-3 py-1.5 text-left font-semibold text-gray-500 w-28">Rule</th>
                        <th className="px-3 py-1.5 text-left font-semibold text-gray-500">Description</th>
                        <th className="px-3 py-1.5 text-left font-semibold text-gray-500 w-40">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {path.mappings.map((m, mi) => (
                        <tr
                          key={mi}
                          className={[
                            'border-t border-gray-100',
                            m.ruleType === 'unmapped' ? 'opacity-40' : '',
                            mi % 2 === 0 ? 'bg-white' : 'bg-gray-50/50',
                          ].join(' ')}
                        >
                          <td className="px-4 py-1.5 font-mono text-gray-800">{m.targetField}</td>
                          <td className="px-3 py-1.5">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${RULE_COLORS[m.ruleType] ?? 'bg-gray-100 text-gray-600'}`}>
                              {m.ruleType}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 font-mono text-gray-700">{m.description}</td>
                          <td className="px-3 py-1.5 text-gray-400 italic">{m.notes ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

type Tab = 'browser' | 'query'

export function DevToolsView() {
  const [tab, setTab] = useState<Tab>('browser')
  // Refresh tables whenever the view is shown
  const section = useAppStore(s => s.workspaceSection)
  const [key, setKey] = useState(0)
  useEffect(() => { if (section === 'devtools') setKey(k => k + 1) }, [section])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-gray-200 px-4 shrink-0 bg-white">
        <TabButton label="DB Browser" active={tab === 'browser'} onClick={() => setTab('browser')} />
        <TabButton label="Query Plan" active={tab === 'query'}   onClick={() => setTab('query')} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'browser' ? <DbBrowser key={key} /> : <QueryRenderer />}
      </div>
    </div>
  )
}
