import { useState, useEffect } from 'react'
import type { PicklistMapping, Picklist, PicklistValue, PicklistMappingEntry } from '../../types/index.js'

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
        {sourceValues.length > 0 && targetValues.length > 0 && (
          <div className="px-6 py-2 border-b flex items-center gap-4 shrink-0 bg-white">
            <button
              onClick={autoFill}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              ⚡ Auto-fill exact matches
            </button>
            {unmappedKeys.length > 0 && (
              <span className="text-xs text-amber-600 font-medium">
                {unmappedKeys.length} unmapped
              </span>
            )}
          </div>
        )}

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
                        <p className="text-xs font-mono text-gray-700 truncate">{sv.key}</p>
                        {sv.label && <p className="text-xs text-gray-400 truncate">{sv.label}</p>}
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
    </div>
  )
}
