import { useState, useEffect, useCallback } from 'react'
import type { PicklistMapping, Picklist } from '../../../types/index.js'
import { MappingEditorOverlay } from '../MappingEditorOverlay.js'

// ── Mapping Card ───────────────────────────────────────────────────────────────

function MappingCard({
  mapping,
  sourceName,
  targetName,
  entryCount,
  onClick,
  onDelete,
}: {
  mapping: PicklistMapping
  sourceName: string
  targetName: string
  entryCount: number
  onClick: () => void
  onDelete: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirmDelete) { setConfirmDelete(true); return }
    await window.electronAPI.deletePlMapping(mapping.id)
    onDelete()
  }

  return (
    <div
      onClick={onClick}
      className="group bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-gray-800 truncate flex-1">{mapping.name}</p>
        <button
          onClick={handleDelete}
          onBlur={() => setConfirmDelete(false)}
          className={[
            'shrink-0 text-xs px-2 py-0.5 rounded transition-colors opacity-0 group-hover:opacity-100',
            confirmDelete
              ? 'bg-red-100 text-red-600 hover:bg-red-200'
              : 'text-gray-400 hover:text-red-500',
          ].join(' ')}
        >
          {confirmDelete ? 'Confirm' : '✕'}
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
        <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium truncate max-w-[40%]">
          {sourceName || '—'}
        </span>
        <span className="text-gray-300">→</span>
        <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-medium truncate max-w-[40%]">
          {targetName || '—'}
        </span>
      </div>

      <p className="text-xs text-gray-400 mt-2">{entryCount} mapping{entryCount !== 1 ? 's' : ''}</p>
    </div>
  )
}

// ── PLMappingsView ─────────────────────────────────────────────────────────────

export function PLMappingsView() {
  const [mappings, setMappings] = useState<PicklistMapping[]>([])
  const [picklists, setPicklists] = useState<Picklist[]>([])
  const [entryCounts, setEntryCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PicklistMapping | null>(null)

  // New mapping form
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const [all, pls] = await Promise.all([
      window.electronAPI.listPlMappings(),
      window.electronAPI.listPicklists(),
    ])
    setMappings(all)
    setPicklists(pls)
    const counts: Record<string, number> = {}
    await Promise.all(all.map(async m => {
      const { entries } = await window.electronAPI.getPlMapping(m.id)
      counts[m.id] = entries.length
    }))
    setEntryCounts(counts)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const picklistName = (id?: string) => picklists.find(p => p.id === id)?.name ?? '—'

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const m = await window.electronAPI.createPlMapping(newName.trim())
      setMappings(prev => [...prev, m])
      setEntryCounts(prev => ({ ...prev, [m.id]: 0 }))
      setNewName('')
      setShowForm(false)
    } finally {
      setCreating(false)
    }
  }

  const handleDeleted = (id: string) => {
    setMappings(prev => prev.filter(m => m.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const handleUpdated = (m: PicklistMapping, count: number) => {
    setMappings(prev => prev.map(x => x.id === m.id ? m : x))
    setEntryCounts(prev => ({ ...prev, [m.id]: count }))
    setSelected(m)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="px-6 py-4 border-b bg-white shrink-0 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">Picklist Mappings</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Map source values to their target equivalents
          </p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + New mapping
        </button>
      </div>

      {/* New mapping form */}
      {showForm && (
        <div className="px-6 py-3 border-b bg-white flex items-center gap-3">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowForm(false) }}
            placeholder="Mapping name *"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button onClick={() => setShowForm(false)} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || creating}
            className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-40"
          >
            {creating ? '…' : 'Create'}
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="text-center text-gray-300 text-sm mt-20">Loading…</div>
        ) : mappings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-64 text-center">
            <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center mb-4 text-2xl">⇌</div>
            <p className="text-sm font-medium text-gray-500">No mappings yet</p>
            <p className="text-xs text-gray-400 mt-1 mb-4">Create a mapping to link source and target picklists</p>
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              New mapping
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {mappings.map(m => (
              <MappingCard
                key={m.id}
                mapping={m}
                sourceName={picklistName(m.sourcePicklistId)}
                targetName={picklistName(m.targetPicklistId)}
                entryCount={entryCounts[m.id] ?? 0}
                onClick={() => setSelected(m)}
                onDelete={() => handleDeleted(m.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Editor overlay */}
      {selected && (
        <MappingEditorOverlay
          mapping={selected}
          picklists={picklists}
          onClose={() => setSelected(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  )
}
