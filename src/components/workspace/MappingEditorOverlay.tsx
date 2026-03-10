import { useState, useEffect } from 'react'
import type { PicklistMapping, Picklist, PicklistValue, PicklistMappingEntry } from '../../types/index.js'

// ── Column picker dialog ───────────────────────────────────────────────────────

function ColumnPickerDialog({
  headers,
  label1,
  label2,
  onConfirm,
  onCancel,
}: {
  headers: string[]
  label1: string
  label2: string
  onConfirm: (col1: string, col2: string) => void
  onCancel: () => void
}) {
  const [col1, setCol1] = useState(headers[0] ?? '')
  const [col2, setCol2] = useState(headers[1] ?? headers[0] ?? '')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-2xl w-96 p-6">
        <p className="text-sm font-semibold text-gray-800 mb-4">Choose columns</p>

        <label className="block text-xs font-semibold text-gray-500 mb-1">{label1} *</label>
        <select
          value={col1}
          onChange={e => setCol1(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          {headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select>

        <label className="block text-xs font-semibold text-gray-500 mb-1">{label2} *</label>
        <select
          value={col2}
          onChange={e => setCol2(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          {headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select>

        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          <button
            onClick={() => onConfirm(col1, col2)}
            disabled={!col1 || !col2}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-40"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  )
}

interface Props {
  mapping: PicklistMapping
  picklists: Picklist[]
  onClose: () => void
  onUpdated: (mapping: PicklistMapping, entryCount: number) => void
}

// ── MappingEditorOverlay ───────────────────────────────────────────────────────

export function MappingEditorOverlay({ mapping, picklists, onClose, onUpdated }: Props) {
  const [sourcePicklistId, setSourcePicklistId] = useState(mapping.sourcePicklistId ?? '')
  const [targetPicklistId, setTargetPicklistId] = useState(mapping.targetPicklistId ?? '')

  const [sourceValues, setSourceValues] = useState<PicklistValue[]>([])
  const [targetValues, setTargetValues] = useState<PicklistValue[]>([])
  const [entries, setEntries] = useState<Record<string, string>>({}) // sourceKey → targetKey
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  // Import state
  const [importHeaders, setImportHeaders] = useState<string[] | null>(null)
  const [importFilePath, setImportFilePath] = useState<string | null>(null)

  const sourcePLs = picklists.filter(p => p.side === 'source')
  const targetPLs = picklists.filter(p => p.side === 'target')

  // Load values whenever picklist selection changes
  useEffect(() => {
    let cancelled = false
    async function loadValues() {
      setLoading(true)
      const [sv, tv] = await Promise.all([
        sourcePicklistId ? window.electronAPI.getPicklist(sourcePicklistId) : Promise.resolve({ picklist: null, values: [] }),
        targetPicklistId ? window.electronAPI.getPicklist(targetPicklistId) : Promise.resolve({ picklist: null, values: [] }),
      ])
      if (cancelled) return
      setSourceValues(sv.values)
      setTargetValues(tv.values)
      setLoading(false)
    }
    loadValues()
    return () => { cancelled = true }
  }, [sourcePicklistId, targetPicklistId])

  // Load existing entries on mount
  useEffect(() => {
    window.electronAPI.getPlMapping(mapping.id).then(({ entries: e }) => {
      const map: Record<string, string> = {}
      e.forEach((en: PicklistMappingEntry) => { map[en.sourceKey] = en.targetKey })
      setEntries(map)
    })
  }, [mapping.id])

  const setEntry = (sourceKey: string, targetKey: string) => {
    setEntries(prev => ({ ...prev, [sourceKey]: targetKey }))
    setIsDirty(true)
  }

  // Auto-fill: exact key match
  const autoFill = () => {
    const targetKeySet = new Set(targetValues.map(v => v.key))
    const newEntries: Record<string, string> = { ...entries }
    sourceValues.forEach(sv => {
      if (targetKeySet.has(sv.key)) newEntries[sv.key] = sv.key
    })
    setEntries(newEntries)
    setIsDirty(true)
  }

  // Import from file
  const handleImportFile = async () => {
    const result = await window.electronAPI.openFile({
      title: 'Select mapping file',
      filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return
    const { headers } = await window.electronAPI.inferSchema(result.filePaths[0])
    setImportFilePath(result.filePaths[0])
    setImportHeaders(headers)
  }

  const handleImportConfirm = async (sourceKeyCol: string, targetKeyCol: string) => {
    if (!importFilePath) return
    setImportHeaders(null)
    setLoading(true)
    setError(null)
    try {
      await window.electronAPI.importPlMappingEntriesFromFile(mapping.id, importFilePath, sourceKeyCol, targetKeyCol)
      // Reload entries
      const { entries: e } = await window.electronAPI.getPlMapping(mapping.id)
      const map: Record<string, string> = {}
      e.forEach((en: PicklistMappingEntry) => { map[en.sourceKey] = en.targetKey })
      setEntries(map)
      setIsDirty(false)
      onUpdated(mapping, e.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import.')
    } finally {
      setLoading(false)
      setImportFilePath(null)
    }
  }

  // Download template
  const handleDownloadTemplate = async () => {
    const result = await window.electronAPI.saveFile({
      title: 'Save mapping template',
      defaultPath: `${mapping.name.replace(/\s+/g, '_')}_template.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (result.canceled || !result.filePath) return
    const header = 'source_key,target_key'
    const exampleRows = sourceValues.length > 0
      ? sourceValues.slice(0, 3).map(sv => `${sv.key},`).join('\n')
      : 'VALUE_A,VALUE_B\nVALUE_C,VALUE_D'
    const csv = `${header}\n${exampleRows}`
    // Write via a data URL workaround — use the saveFile path directly with a small fetch-like approach
    // We'll use IPC to write the file since we're in the renderer
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filePath.split(/[\\/]/).pop() ?? 'template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      // Update picklist links if changed
      const needsUpdate =
        sourcePicklistId !== (mapping.sourcePicklistId ?? '') ||
        targetPicklistId !== (mapping.targetPicklistId ?? '')
      const updated = needsUpdate
        ? await window.electronAPI.updatePlMapping(mapping.id, {
            sourcePicklistId: sourcePicklistId || null,
            targetPicklistId: targetPicklistId || null,
          })
        : mapping

      const entryList = Object.entries(entries)
        .filter(([, v]) => v)
        .map(([sourceKey, targetKey]) => ({ sourceKey, targetKey }))

      await window.electronAPI.setPlMappingEntries(mapping.id, entryList)
      setIsDirty(false)
      onUpdated(updated, entryList.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  const mappedCount = Object.values(entries).filter(Boolean).length
  const unmappedKeys = sourceValues.filter(sv => !entries[sv.key])

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative ml-auto bg-white shadow-2xl w-full max-w-3xl flex flex-col h-full">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-start justify-between shrink-0">
          <div>
            <p className="text-base font-semibold text-gray-800">{mapping.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {mappedCount} of {sourceValues.length} source values mapped
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none mt-1">✕</button>
        </div>

        {/* Picklist selectors */}
        <div className="px-6 py-3 border-b bg-gray-50 flex items-center gap-4 shrink-0">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-blue-700 mb-1">Source picklist</label>
            <select
              value={sourcePicklistId}
              onChange={e => { setSourcePicklistId(e.target.value); setIsDirty(true) }}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">(none)</option>
              {sourcePLs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <span className="text-gray-300 text-lg mt-4">→</span>
          <div className="flex-1">
            <label className="block text-xs font-semibold text-emerald-700 mb-1">Target picklist</label>
            <select
              value={targetPicklistId}
              onChange={e => { setTargetPicklistId(e.target.value); setIsDirty(true) }}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">(none)</option>
              {targetPLs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-2 border-b flex items-center gap-4 shrink-0 bg-white">
          {sourceValues.length > 0 && targetValues.length > 0 && (
            <button
              onClick={autoFill}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              ⚡ Auto-fill exact matches
            </button>
          )}
          <button
            onClick={handleImportFile}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            ↑ Import from file
          </button>
          <button
            onClick={handleDownloadTemplate}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            ↓ Download template
          </button>
          {unmappedKeys.length > 0 && (
            <span className="text-xs text-amber-600 font-medium ml-auto">
              {unmappedKeys.length} unmapped
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-gray-400 gap-2">
              <span className="animate-spin">⟳</span>
              <span className="text-sm">Loading…</span>
            </div>
          ) : sourceValues.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-300 text-sm">
              {sourcePicklistId ? 'Source picklist has no values' : 'Select a source picklist'}
            </div>
          ) : (
            <>
              {error && (
                <div className="mx-6 mt-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
                  {error}
                </div>
              )}

              {/* Table header */}
              <div className="grid grid-cols-2 gap-4 px-6 py-2 border-b bg-gray-50 sticky top-0">
                <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Source value</span>
                <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Target value</span>
              </div>

              <div className="divide-y divide-gray-50">
                {sourceValues.map(sv => {
                  const isMapped = !!entries[sv.key]
                  return (
                    <div
                      key={sv.key}
                      className={['grid grid-cols-2 gap-4 px-6 py-2 items-center', !isMapped ? 'bg-amber-50/40' : ''].join(' ')}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-mono text-gray-700 break-words">{sv.key}</p>
                        {sv.label && <p className="text-xs text-gray-400 break-words">{sv.label}</p>}
                      </div>
                      <select
                        value={entries[sv.key] ?? ''}
                        onChange={e => setEntry(sv.key, e.target.value)}
                        className={[
                          'w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1',
                          isMapped
                            ? 'border-gray-200 focus:ring-blue-400'
                            : 'border-amber-200 focus:ring-amber-400',
                        ].join(' ')}
                      >
                        <option value="">— unmapped —</option>
                        {targetValues.map(tv => (
                          <option key={tv.key} value={tv.key}>
                            {tv.key}{tv.label ? ` — ${tv.label}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-between shrink-0">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Close</button>
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : 'Save mapping'}
          </button>
        </div>
      </div>

      {/* Column picker dialog for file import */}
      {importHeaders && (
        <ColumnPickerDialog
          headers={importHeaders}
          label1="Source key column"
          label2="Target key column"
          onConfirm={handleImportConfirm}
          onCancel={() => { setImportHeaders(null); setImportFilePath(null) }}
        />
      )}
    </div>
  )
}
