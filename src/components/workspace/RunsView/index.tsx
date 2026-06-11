import { useState, useEffect, useCallback, useRef } from 'react'
import { platform } from '@/platform/index'
import type { Transformation, Run, RunIssue } from '../../../types/index.js'
import type { RunProgressEvent, OutputManifestTarget } from '../../../electron.d.js'
import type { TransformationQuery } from '../../../platform/IPlatform.js'
import { generateSqlPreview } from '../../../utils/sqlPreview.js'

// ── SQL Preview modal ─────────────────────────────────────────────────────────

function SqlPreviewModal({
  transformationId,
  onClose,
}: {
  transformationId: string
  onClose: () => void
}) {
  const [queries, setQueries] = useState<TransformationQuery[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    platform.renderTransformationQuery(transformationId)
      .then(q => { setQueries(q); setLoading(false) })
      .catch(err => { setError(String(err)); setLoading(false) })
  }, [transformationId])

  const sqlText = queries ? generateSqlPreview(queries) : ''

  const handleCopy = () => {
    navigator.clipboard.writeText(sqlText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 'min(95vw, 900px)', maxHeight: '88vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b flex items-center justify-between shrink-0">
          <div>
            <p className="text-sm font-semibold text-gray-800">Query preview</p>
            <p className="text-xs text-gray-400 mt-0.5">Pseudo-SQL representation of the transformation logic</p>
          </div>
          <div className="flex items-center gap-2">
            {!loading && !error && (
              <button
                onClick={handleCopy}
                className="text-xs px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none ml-1">✕</button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="flex items-center justify-center h-40 text-sm text-gray-400">
              Generating preview…
            </div>
          )}
          {error && (
            <div className="m-4 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
          )}
          {!loading && !error && queries && queries.length === 0 && (
            <div className="flex items-center justify-center h-40 text-sm text-gray-400">
              No field mappings defined yet.
            </div>
          )}
          {!loading && !error && sqlText && (
            <pre
              className="text-xs font-mono leading-relaxed p-5 text-gray-800 whitespace-pre overflow-x-auto"
              style={{ tabSize: 4 }}
            >
              {sqlText}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const base = 'text-xs px-2 py-0.5 rounded font-medium'
  if (status === 'completed') return <span className={`${base} bg-green-100 text-green-700`}>Completed</span>
  if (status === 'running')   return <span className={`${base} bg-blue-100 text-blue-700`}>Running…</span>
  if (status === 'failed')    return <span className={`${base} bg-red-100 text-red-700`}>Failed</span>
  return <span className={`${base} bg-gray-100 text-gray-500`}>{status}</span>
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString()
}

// ── Run detail panel ──────────────────────────────────────────────────────────

interface PreviewData {
  headers: string[]
  rows: Record<string, string>[]
  totalRows: number
}

function RunDetailPanel({
  run,
  onClose,
}: {
  run: Run
  onClose: () => void
}) {
  const [issues, setIssues] = useState<RunIssue[]>([])
  const [loadingIssues, setLoadingIssues] = useState(true)
  const [previewTargetId, setPreviewTargetId] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const manifest = run.outputManifest
    ? (run.outputManifest as unknown as { targets: OutputManifestTarget[] })
    : null

  const stats = run.stats as unknown as
    | { totalRowsProcessed: number; totalIssues: number; targetCount: number }
    | undefined

  // Auto-select first target for preview
  useEffect(() => {
    if (manifest?.targets.length && !previewTargetId) {
      setPreviewTargetId(manifest.targets[0].objectId)
    }
  }, [manifest])

  useEffect(() => {
    platform.getRunIssues(run.id)
      .then(iss => { setIssues(iss); setLoadingIssues(false) })
      .catch(() => setLoadingIssues(false))
  }, [run.id])

  useEffect(() => {
    if (!previewTargetId) return
    setPreviewLoading(true)
    setPreviewError(null)
    setPreview(null)
    platform.previewOutput(run.id, previewTargetId, 100)
      .then(data => setPreview(data))
      .catch(err => setPreviewError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPreviewLoading(false))
  }, [run.id, previewTargetId])

  const handleSaveOutput = async (target: OutputManifestTarget) => {
    const ext = target.format === 'xlsx' ? '.xlsx' : '.csv'
    const result = await platform.saveFile({
      title: 'Save output file',
      defaultPath: `${target.objectName}${ext}`,
      filters: target.format === 'xlsx'
        ? [{ name: 'Excel', extensions: ['xlsx'] }]
        : [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (result.canceled || !result.filePath) return
    try {
      await platform.saveOutput(run.id, target.objectId, result.filePath)
    } catch (err) {
      alert(`Save failed: ${String(err)}`)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 'min(95vw, 1100px)', maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-800">Run detail</p>
            <p className="text-xs text-gray-400 mt-0.5">{fmtDate(run.startedAt)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Status + stats */}
          <div className="flex items-center gap-4 flex-wrap">
            {statusBadge(run.status)}
            {stats && (
              <>
                <span className="text-xs text-gray-500">{stats.totalRowsProcessed.toLocaleString()} rows processed</span>
                {stats.totalIssues > 0 && (
                  <span className="text-xs text-amber-600">{stats.totalIssues} issue{stats.totalIssues !== 1 ? 's' : ''}</span>
                )}
                <span className="text-xs text-gray-400">{stats.targetCount} target{stats.targetCount !== 1 ? 's' : ''}</span>
              </>
            )}
          </div>

          {/* Output files */}
          {manifest && manifest.targets.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Output files</p>
              <div className="space-y-2">
                {manifest.targets.map(t => (
                  <div key={t.objectId} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{t.objectName}</p>
                      <p className="text-xs text-gray-400">{t.rowCount.toLocaleString()} rows · {t.format.toUpperCase()}</p>
                    </div>
                    <button
                      onClick={() => handleSaveOutput(t)}
                      className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      ↓ Save
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Preview */}
          {manifest && manifest.targets.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Preview</p>
                {manifest.targets.length > 1 && (
                  <div className="flex gap-1">
                    {manifest.targets.map(t => (
                      <button
                        key={t.objectId}
                        onClick={() => setPreviewTargetId(t.objectId)}
                        className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                          previewTargetId === t.objectId
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {t.objectName}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {previewLoading && (
                <div className="text-xs text-gray-400 py-4 text-center">Loading preview…</div>
              )}
              {previewError && (
                <div className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">{previewError}</div>
              )}
              {preview && !previewLoading && (
                <div>
                  <div className="overflow-auto rounded-lg border border-gray-200" style={{ maxHeight: 320 }}>
                    <table className="text-xs border-collapse" style={{ minWidth: '100%' }}>
                      <thead className="sticky top-0 bg-gray-50 z-10">
                        <tr>
                          {preview.headers.map((h, i) => (
                            <th key={i} className="text-left px-3 py-2 text-gray-500 font-semibold border-b border-gray-200 whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((row, i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                            {preview.headers.map((h, ci) => (
                              <td key={ci} className="px-3 py-1.5 text-gray-700 border-b border-gray-100 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis" title={row[String(ci)]}>
                                {row[String(ci)] || <span className="text-gray-300">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {preview.totalRows > 100 && (
                    <p className="text-xs text-gray-400 mt-1.5">
                      Showing first 100 of {preview.totalRows.toLocaleString()} rows.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Issues */}
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">
              Issues {!loadingIssues && `(${issues.length})`}
            </p>
            {loadingIssues ? (
              <p className="text-xs text-gray-300">Loading…</p>
            ) : issues.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No issues — clean run.</p>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium w-16">Row</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium w-28">Field</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium w-20">Severity</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issues.slice(0, 200).map(iss => (
                      <tr key={iss.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-1.5 text-gray-400">{iss.rowIndex ?? '—'}</td>
                        <td className="px-3 py-1.5 text-gray-600 break-words">{iss.fieldName ?? '—'}</td>
                        <td className="px-3 py-1.5">
                          <span className={iss.severity === 'error' ? 'text-red-600 font-medium' : 'text-amber-600'}>
                            {iss.severity}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-gray-700">{iss.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {issues.length > 200 && (
                  <p className="text-xs text-gray-400 px-3 py-2 border-t border-gray-100">
                    Showing first 200 of {issues.length} issues.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Live progress bar ─────────────────────────────────────────────────────────

function ProgressBar({
  progress,
  onCancel,
}: {
  progress: RunProgressEvent
  onCancel: () => void
}) {
  const pct = progress.rowsTotal
    ? Math.round((progress.rowsDone ?? 0) / progress.rowsTotal * 100)
    : 0

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-semibold text-blue-800">Running transformation…</p>
          {progress.currentTarget && (
            <p className="text-xs text-blue-600 mt-0.5">
              Processing: <span className="font-medium">{progress.currentTarget}</span>
              {progress.rowsTotal ? ` — ${(progress.rowsDone ?? 0).toLocaleString()} / ${progress.rowsTotal.toLocaleString()} rows` : ''}
            </p>
          )}
          {progress.phase === 'loading' && (
            <p className="text-xs text-blue-600 mt-0.5">Loading data…</p>
          )}
        </div>
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 bg-white border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
        >
          Cancel
        </button>
      </div>
      <div className="h-1.5 bg-blue-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-300"
          style={{ width: progress.phase === 'loading' ? '5%' : `${Math.max(5, pct)}%` }}
        />
      </div>
    </div>
  )
}

// ── RunsView ──────────────────────────────────────────────────────────────────

export function RunsView() {
  const [transformations, setTransformations] = useState<Transformation[]>([])
  const [selectedTransId, setSelectedTransId] = useState<string>('')
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [progress, setProgress] = useState<RunProgressEvent | null>(null)
  const [detailRun, setDetailRun] = useState<Run | null>(null)
  const [showSqlPreview, setShowSqlPreview] = useState(false)
  const [exportingAudit, setExportingAudit] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const unsubRef = useRef<(() => void) | null>(null)

  // Load transformations on mount
  useEffect(() => {
    platform.listTransformations()
      .then(list => {
        setTransformations(list)
        if (list.length > 0) setSelectedTransId(list[0].id)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // Clear validation error when the user switches transformation
  useEffect(() => { setValidationError(null) }, [selectedTransId])

  // Load runs whenever selected transformation changes
  const loadRuns = useCallback(() => {
    if (!selectedTransId) return
    platform.listRuns(selectedTransId)
      .then(list => setRuns(list))
      .catch(() => {})
  }, [selectedTransId])

  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  // Clean up progress listener on unmount
  useEffect(() => {
    return () => {
      if (unsubRef.current) {
        unsubRef.current()
        unsubRef.current = null
      }
    }
  }, [])

  const handleRun = async () => {
    if (!selectedTransId) return

    // Pre-flight: check for join nodes with missing key configuration
    try {
      const trans = await platform.getTransformation(selectedTransId)
      if (trans.canvasState) {
        const canvas = JSON.parse(trans.canvasState) as {
          nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>
        }
        const badJoins = (canvas.nodes ?? [])
          .filter(n => n.type === 'joinOperator' && (!n.data.joinKeyA || !n.data.joinKeyB))
          .map(n => (n.data.label as string | undefined)?.trim() || n.id)
        if (badJoins.length > 0) {
          setValidationError(
            `Cannot run: ${badJoins.length === 1 ? 'a Join node is' : 'some Join nodes are'} missing key configuration and would produce a cartesian product.\n` +
            `Open the Join panel${badJoins.length > 1 ? 's' : ''} and set both key fields:\n` +
            badJoins.map(l => `• ${l}`).join('\n')
          )
          return
        }
      }
    } catch {
      // If we can't load the canvas (e.g. no canvas yet) just let the run proceed — the engine will catch it
    }

    setValidationError(null)
    setRunning(true)
    setProgress({ runId: '', status: 'running', phase: 'loading' })

    // Subscribe to progress events
    if (unsubRef.current) unsubRef.current()
    unsubRef.current = platform.onRunProgress(evt => {
      setProgress(evt)
      if (evt.status === 'completed' || evt.status === 'failed') {
        setRunning(false)
        setActiveRunId(null)
        // Refresh the run list
        {
          platform.listRuns(selectedTransId).then(list => setRuns(list))
        }
        // Unsubscribe
        if (unsubRef.current) {
          unsubRef.current()
          unsubRef.current = null
        }
        // Clear progress after a short delay
        setTimeout(() => setProgress(null), 3000)
      }
    })

    try {
      const runId = await platform.startRun(selectedTransId)
      setActiveRunId(runId)
    } catch (err) {
      alert(`Failed to start run: ${String(err)}`)
      setRunning(false)
      setProgress(null)
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
    }
  }

  const handleCancel = async () => {
    if (!activeRunId) return
    await platform.cancelRun(activeRunId)
  }

  const handleViewDetail = async (run: Run) => {
    // Refresh the run from DB to get latest manifest/stats
    const fresh = await platform.getRun(run.id)
    setDetailRun(fresh ?? run)
  }

  const selectedTrans = transformations.find(t => t.id === selectedTransId)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="px-6 py-4 border-b bg-white shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-gray-800">Runs</p>
            <p className="text-xs text-gray-400 mt-0.5">Execute transformations and download output files</p>
          </div>

          <div className="flex items-center gap-3">
            {/* Transformation selector */}
            <select
              value={selectedTransId}
              onChange={e => setSelectedTransId(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
              disabled={loading || running}
            >
              {transformations.length === 0 && (
                <option value="">No transformations</option>
              )}
              {transformations.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>

            {/* Preview SQL button */}
            <button
              onClick={() => setShowSqlPreview(true)}
              disabled={!selectedTransId || loading}
              className="px-3 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
              title="Preview transformation as SQL"
            >
              SQL
            </button>

            {/* Export mapping audit */}
            <button
              onClick={async () => {
                if (!selectedTransId) return
                const res = await platform.saveFile({
                  title: 'Export mapping audit',
                  defaultPath: `mapping-audit.xlsx`,
                  filters: [{ name: 'Excel', extensions: ['xlsx'] }],
                })
                if (res.canceled || !res.filePath) return
                setExportingAudit(true)
                try {
                  await platform.exportMappingAudit(selectedTransId, res.filePath)
                } catch (e) {
                  alert(`Export failed: ${String(e)}`)
                } finally {
                  setExportingAudit(false)
                }
              }}
              disabled={!selectedTransId || loading || exportingAudit}
              className="px-3 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
              title="Export mapping audit to Excel"
            >
              {exportingAudit ? '…' : 'Mapping'}
            </button>

            {/* Run button */}
            <button
              onClick={handleRun}
              disabled={!selectedTransId || running || loading}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40 flex items-center gap-2"
            >
              {running ? (
                <>
                  <span className="animate-spin text-xs">⟳</span>
                  Running…
                </>
              ) : '▶ Run'}
            </button>
          </div>
        </div>
      </div>

      {/* Validation error banner */}
      {validationError && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-200 flex items-start gap-3 shrink-0">
          <span className="text-red-500 mt-0.5 shrink-0">⚠</span>
          <div className="flex-1 min-w-0">
            {validationError.split('\n').map((line, i) => (
              <p key={i} className={`text-sm ${i === 0 ? 'font-medium text-red-700' : 'text-red-600 mt-0.5'}`}>{line}</p>
            ))}
          </div>
          <button
            onClick={() => setValidationError(null)}
            className="text-red-400 hover:text-red-600 shrink-0 text-sm leading-none mt-0.5"
          >✕</button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Live progress */}
        {progress && running && (
          <ProgressBar progress={progress} onCancel={handleCancel} />
        )}

        {/* Completion notice */}
        {progress && !running && (
          <div className={`rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-2 ${
            progress.status === 'completed'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {progress.status === 'completed' ? '✓ Run completed successfully' : `✗ Run failed${progress.error ? `: ${progress.error}` : ''}`}
          </div>
        )}

        {/* Run history */}
        {loading ? (
          <div className="text-center text-gray-300 text-sm mt-20">Loading…</div>
        ) : !selectedTransId || transformations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-64 text-center">
            <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mb-4 text-2xl">▶</div>
            <p className="text-sm font-medium text-gray-500">No transformations yet</p>
            <p className="text-xs text-gray-400 mt-1">Create a transformation first, then run it here</p>
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-48 text-center">
            <p className="text-sm text-gray-400">No runs yet for <span className="font-medium text-gray-600">{selectedTrans?.name}</span></p>
            <p className="text-xs text-gray-300 mt-1">Press Run to execute the transformation</p>
          </div>
        ) : (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Run history — {selectedTrans?.name}
            </p>
            <div className="space-y-2">
              {runs.map(run => {
                const stats = run.stats as unknown as
                  | { totalRowsProcessed: number; totalIssues: number; targetCount: number }
                  | undefined
                const manifest = run.outputManifest as unknown as
                  | { targets: OutputManifestTarget[] }
                  | undefined

                return (
                  <div
                    key={run.id}
                    className="bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-gray-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3 flex-wrap">
                        {statusBadge(run.status)}
                        <span className="text-xs text-gray-500">{fmtDate(run.startedAt)}</span>
                        {stats && (
                          <>
                            <span className="text-xs text-gray-400">{stats.totalRowsProcessed.toLocaleString()} rows</span>
                            {stats.totalIssues > 0 && (
                              <span className="text-xs text-amber-600">{stats.totalIssues} issue{stats.totalIssues !== 1 ? 's' : ''}</span>
                            )}
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Quick-save buttons */}
                        {manifest?.targets.map(t => (
                          <button
                            key={t.objectId}
                            onClick={async () => {
                              const ext = t.format === 'xlsx' ? '.xlsx' : '.csv'
                              const res = await platform.saveFile({
                                title: 'Save output',
                                defaultPath: `${t.objectName}${ext}`,
                                filters: t.format === 'xlsx'
                                  ? [{ name: 'Excel', extensions: ['xlsx'] }]
                                  : [{ name: 'CSV', extensions: ['csv'] }],
                              })
                              if (!res.canceled && res.filePath) {
                                try {
                                  await platform.saveOutput(run.id, t.objectId, res.filePath)
                                } catch (e) {
                                  alert(`Save failed: ${String(e)}`)
                                }
                              }
                            }}
                            className="text-xs px-2.5 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-1"
                            title={`Save ${t.objectName}`}
                          >
                            ↓ {t.objectName}
                          </button>
                        ))}

                        <button
                          onClick={() => handleViewDetail(run)}
                          className="text-xs px-2.5 py-1 text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Detail overlay */}
      {detailRun && (
        <RunDetailPanel run={detailRun} onClose={() => setDetailRun(null)} />
      )}

      {/* SQL preview overlay */}
      {showSqlPreview && selectedTransId && (
        <SqlPreviewModal transformationId={selectedTransId} onClose={() => setShowSqlPreview(false)} />
      )}
    </div>
  )
}
