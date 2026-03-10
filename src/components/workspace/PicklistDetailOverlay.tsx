import { useState, useEffect } from 'react'
import type { Picklist, PicklistValue } from '../../types/index.js'

interface Props {
  picklist: Picklist
  onClose: () => void
  onUpdated: (pl: Picklist, valueCount: number) => void
}

// ── Editable row ──────────────────────────────────────────────────────────────

interface EditableValue {
  _key: string
  key: string
  label: string
}

function makeKey() { return Math.random().toString(36).slice(2) }

function valueToEditable(v: PicklistValue): EditableValue {
  return { _key: makeKey(), key: v.key, label: v.label ?? '' }
}

// ── Column picker dialog ──────────────────────────────────────────────────────

function ColumnPickerDialog({
  headers,
  onConfirm,
  onCancel,
}: {
  headers: string[]
  onConfirm: (keyCol: string, labelCol: string | undefined) => void
  onCancel: () => void
}) {
  const [keyCol, setKeyCol] = useState(headers[0] ?? '')
  const [labelCol, setLabelCol] = useState('')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-2xl w-96 p-6">
        <p className="text-sm font-semibold text-gray-800 mb-4">Choose columns</p>

        <label className="block text-xs font-semibold text-gray-500 mb-1">Key column *</label>
        <select
          value={keyCol}
          onChange={e => setKeyCol(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          {headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select>

        <label className="block text-xs font-semibold text-gray-500 mb-1">Label column (optional)</label>
        <select
          value={labelCol}
          onChange={e => setLabelCol(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
        >
          <option value="">(none)</option>
          {headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select>

        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          <button
            onClick={() => onConfirm(keyCol, labelCol || undefined)}
            disabled={!keyCol}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main overlay ──────────────────────────────────────────────────────────────

export function PicklistDetailOverlay({ picklist, onClose, onUpdated }: Props) {
  const [rows, setRows] = useState<EditableValue[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Column picker state (for file import)
  const [importHeaders, setImportHeaders] = useState<string[] | null>(null)
  const [importFilePath, setImportFilePath] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.getPicklist(picklist.id).then(({ values }) => {
      setRows(values.map(valueToEditable))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [picklist.id])

  // ── Row editing ───────────────────────────────────────────────────────────

  const updateRow = (key: string, patch: Partial<EditableValue>) => {
    setRows(prev => prev.map(r => r._key === key ? { ...r, ...patch } : r))
    setIsDirty(true)
  }

  const addRow = () => {
    setRows(prev => [...prev, { _key: makeKey(), key: '', label: '' }])
    setIsDirty(true)
  }

  const removeRow = (key: string) => {
    setRows(prev => prev.filter(r => r._key !== key))
    setIsDirty(true)
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    const values = rows
      .filter(r => r.key.trim())
      .map(r => ({ key: r.key.trim(), label: r.label.trim() || undefined }))
    setSaving(true)
    setError(null)
    try {
      await window.electronAPI.setPicklistValues(picklist.id, values)
      setIsDirty(false)
      onUpdated(picklist, values.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  // ── File import ───────────────────────────────────────────────────────────

  const handleImportFile = async () => {
    const result = await window.electronAPI.openFile({
      title: 'Select picklist file',
      filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return
    // We need the headers — use inferSchema to get them
    const { headers } = await window.electronAPI.inferSchema(result.filePaths[0])
    setImportFilePath(result.filePaths[0])
    setImportHeaders(headers)
  }

  // ── Template download ─────────────────────────────────────────────────────

  const handleDownloadTemplate = async () => {
    const result = await window.electronAPI.saveFile({
      title: 'Save picklist template',
      defaultPath: `${picklist.name.replace(/\s+/g, '_')}_template.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (result.canceled || !result.filePath) return
    const csv = 'key,label\nVALUE_A,Label A\nVALUE_B,Label B'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filePath.split(/[\\/]/).pop() ?? 'template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleColumnConfirm = async (keyCol: string, labelCol: string | undefined) => {
    if (!importFilePath) return
    setImportHeaders(null)
    setLoading(true)
    try {
      const { valueCount } = await window.electronAPI.importPicklistFromFile(
        picklist.id, importFilePath, keyCol, labelCol
      )
      // Reload rows
      const { values } = await window.electronAPI.getPicklist(picklist.id)
      setRows(values.map(valueToEditable))
      setIsDirty(false)
      onUpdated(picklist, valueCount)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to import.')
    } finally {
      setLoading(false)
      setImportFilePath(null)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex">
        <div className="absolute inset-0 bg-black/30" onClick={onClose} />

        <div className="relative ml-auto bg-white shadow-2xl w-full max-w-2xl flex flex-col h-full">
          {/* Header */}
          <div className="px-6 py-4 border-b flex items-start justify-between shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-base font-semibold text-gray-800">{picklist.name}</p>
                <span className={[
                  'text-xs font-semibold px-2 py-0.5 rounded-full',
                  picklist.side === 'source'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-emerald-100 text-emerald-700',
                ].join(' ')}>
                  {picklist.side.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {rows.filter(r => r.key.trim()).length} values
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none mt-1">✕</button>
          </div>

          {/* Toolbar */}
          <div className="px-6 py-2 border-b flex items-center gap-3 shrink-0 bg-gray-50">
            <button
              onClick={addRow}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              + Add value
            </button>
            <span className="text-gray-200">|</span>
            <button
              onClick={handleImportFile}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              ↑ Import from file
            </button>
            <span className="text-gray-200">|</span>
            <button
              onClick={handleDownloadTemplate}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              ↓ Download template
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center h-40 text-gray-400 gap-2">
                <span className="animate-spin">⟳</span>
                <span className="text-sm">Loading…</span>
              </div>
            ) : (
              <>
                {error && (
                  <div className="mx-6 mt-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
                    {error}
                  </div>
                )}

                {/* Table header */}
                <div className="grid grid-cols-[2fr_2fr_auto] gap-2 px-6 py-2 border-b bg-gray-50 sticky top-0">
                  {['Key', 'Label', ''].map(h => (
                    <span key={h} className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</span>
                  ))}
                </div>

                {rows.length === 0 ? (
                  <div className="flex items-center justify-center h-40 text-gray-300 text-sm">
                    No values — add one or import from a file
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {rows.map(r => (
                      <div key={r._key} className="grid grid-cols-[2fr_2fr_auto] gap-2 px-6 py-2 items-center hover:bg-gray-50">
                        <input
                          value={r.key}
                          onChange={e => updateRow(r._key, { key: e.target.value })}
                          placeholder="key"
                          className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
                        />
                        <input
                          value={r.label}
                          onChange={e => updateRow(r._key, { label: e.target.value })}
                          placeholder="label (optional)"
                          className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <button
                          onClick={() => removeRow(r._key)}
                          className="text-gray-300 hover:text-red-400 text-xs leading-none w-4 text-center"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t flex items-center justify-between shrink-0">
            <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Close</button>
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : 'Save values'}
            </button>
          </div>
        </div>
      </div>

      {/* Column picker dialog */}
      {importHeaders && (
        <ColumnPickerDialog
          headers={importHeaders}
          onConfirm={handleColumnConfirm}
          onCancel={() => { setImportHeaders(null); setImportFilePath(null) }}
        />
      )}
    </>
  )
}
