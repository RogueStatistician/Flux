import { useState, useEffect, useCallback } from 'react'
import { platform } from '@/platform/index'
import type { Picklist, PicklistSide } from '../../../types/index.js'
import { PicklistDetailOverlay } from '../PicklistDetailOverlay.js'

// ── Bulk import result dialog ──────────────────────────────────────────────────

interface BulkResult {
  results: Array<{ name: string; created: boolean; valueCount: number }>
  errors: Array<{ name: string; error: string }>
}

function BulkImportResultDialog({ result, onClose }: { result: BulkResult; onClose: () => void }) {
  const total = result.results.reduce((s, r) => s + r.valueCount, 0)
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-[28rem] p-6 max-h-[80vh] flex flex-col">
        <p className="text-sm font-semibold text-gray-800 mb-1">Bulk import complete</p>
        <p className="text-xs text-gray-500 mb-4">
          {result.results.length} picklist{result.results.length !== 1 ? 's' : ''} imported · {total} total values
        </p>
        <div className="flex-1 overflow-auto space-y-1 text-xs">
          {result.results.map(r => (
            <div key={r.name} className="flex items-center gap-2 px-2 py-1 rounded bg-gray-50">
              <span className="text-emerald-500 shrink-0">✓</span>
              <span className="font-medium text-gray-700 flex-1 truncate">{r.name}</span>
              <span className="text-gray-400 shrink-0">{r.created ? 'created' : 'updated'} · {r.valueCount} values</span>
            </div>
          ))}
          {result.errors.map(e => (
            <div key={e.name} className="px-2 py-1 rounded bg-red-50 border border-red-100">
              <p className="font-medium text-red-700">{e.name}</p>
              <p className="text-red-500 mt-0.5">{e.error}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Picklist Card ──────────────────────────────────────────────────────────────

function PicklistCard({
  picklist,
  valueCount,
  onClick,
  onDelete,
}: {
  picklist: Picklist
  valueCount: number
  onClick: () => void
  onDelete: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirmDelete) { setConfirmDelete(true); return }
    await platform.deletePicklist(picklist.id)
    onDelete()
  }

  return (
    <div
      onClick={onClick}
      className="group bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:border-purple-300 hover:shadow-sm transition-all relative"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-800 break-words">{picklist.name}</p>
          {picklist.description && (
            <p className="text-xs text-gray-400 mt-0.5 break-words">{picklist.description}</p>
          )}
        </div>
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
      <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
        <span>{valueCount} value{valueCount !== 1 ? 's' : ''}</span>
      </div>
    </div>
  )
}

// ── Column (source or target) ──────────────────────────────────────────────────

function PicklistColumn({
  side,
  picklists,
  valueCounts,
  onSelect,
  onDeleted,
  onCreated,
  onBulkImported,
}: {
  side: PicklistSide
  picklists: Picklist[]
  valueCounts: Record<string, number>
  onSelect: (pl: Picklist) => void
  onDeleted: (id: string) => void
  onCreated: (pl: Picklist) => void
  onBulkImported: (result: BulkResult) => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const [bulkImporting, setBulkImporting] = useState(false)

  const isSource = side === 'source'
  const accent = isSource ? 'blue' : 'emerald'

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const pl = await platform.createPicklist(side, newName.trim(), newDesc.trim() || undefined)
      onCreated(pl)
      setNewName('')
      setNewDesc('')
      setShowForm(false)
    } finally {
      setCreating(false)
    }
  }

  const handleBulkImport = async () => {
    const res = await platform.openFile({
      title: 'Select bulk picklist file',
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile'],
    })
    if (res.canceled || !res.filePaths[0]) return
    setBulkImporting(true)
    try {
      const result = await platform.bulkImportPicklistsFromFile(res.filePaths[0], side)
      onBulkImported(result)
    } finally {
      setBulkImporting(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 border-r last:border-r-0 border-gray-100">
      {/* Column header */}
      <div className={`px-5 py-3 border-b bg-${accent}-50/40 flex items-center justify-between shrink-0`}>
        <div>
          <p className={`text-xs font-bold text-${accent}-700 uppercase tracking-wide`}>
            {isSource ? 'Source' : 'Target'} Picklists
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{picklists.length} list{picklists.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleBulkImport}
            disabled={bulkImporting}
            className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-40"
            title="Import multiple picklists from an Excel file (one sheet per picklist)"
          >
            {bulkImporting ? '…' : '↑ Bulk'}
          </button>
          <button
            onClick={() => setShowForm(v => !v)}
            className={`text-xs px-3 py-1.5 bg-${accent}-600 text-white rounded-lg hover:bg-${accent}-700 transition-colors font-medium`}
          >
            + New
          </button>
        </div>
      </div>

      {/* New picklist form */}
      {showForm && (
        <div className="px-5 py-3 border-b bg-white">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowForm(false) }}
            placeholder="Picklist name *"
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm mb-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="text-xs text-gray-500 hover:text-gray-700 px-2">Cancel</button>
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className={`text-xs px-3 py-1 bg-${accent}-600 text-white rounded-lg disabled:opacity-40 hover:bg-${accent}-700`}
            >
              {creating ? '…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {picklists.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <p className="text-sm text-gray-300 font-medium">No {side} picklists</p>
            <p className="text-xs text-gray-200 mt-1">Click "+ New" to create one</p>
          </div>
        ) : (
          picklists.map(pl => (
            <PicklistCard
              key={pl.id}
              picklist={pl}
              valueCount={valueCounts[pl.id] ?? 0}
              onClick={() => onSelect(pl)}
              onDelete={() => onDeleted(pl.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── PicklistsView ─────────────────────────────────────────────────────────────

export function PicklistsView() {
  const [picklists, setPicklists] = useState<Picklist[]>([])
  const [valueCounts, setValueCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Picklist | null>(null)
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null)

  const load = useCallback(async () => {
    const all = await platform.listPicklists()
    setPicklists(all)
    // Load value counts in parallel
    const counts: Record<string, number> = {}
    await Promise.all(all.map(async pl => {
      const { values } = await platform.getPicklist(pl.id)
      counts[pl.id] = values.length
    }))
    setValueCounts(counts)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const sourceLists = picklists.filter(p => p.side === 'source')
  const targetLists = picklists.filter(p => p.side === 'target')

  const handleCreated = (pl: Picklist) => {
    setPicklists(prev => [...prev, pl])
    setValueCounts(prev => ({ ...prev, [pl.id]: 0 }))
  }

  const handleDeleted = (id: string) => {
    setPicklists(prev => prev.filter(p => p.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const handleUpdated = (pl: Picklist, newCount: number) => {
    setPicklists(prev => prev.map(p => p.id === pl.id ? pl : p))
    setValueCounts(prev => ({ ...prev, [pl.id]: newCount }))
  }

  const handleBulkImported = (result: BulkResult) => {
    setBulkResult(result)
    // Reload all picklists and counts to reflect new/updated ones
    load()
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="px-6 py-4 border-b bg-white shrink-0">
        <p className="text-sm font-semibold text-gray-800">Picklists</p>
        <p className="text-xs text-gray-400 mt-0.5">
          Named value sets for source and target systems
        </p>
      </div>

      {/* Two-column layout */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-300 text-sm">Loading…</div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <PicklistColumn
            side="source"
            picklists={sourceLists}
            valueCounts={valueCounts}
            onSelect={setSelected}
            onDeleted={handleDeleted}
            onCreated={handleCreated}
            onBulkImported={handleBulkImported}
          />
          <PicklistColumn
            side="target"
            picklists={targetLists}
            valueCounts={valueCounts}
            onSelect={setSelected}
            onDeleted={handleDeleted}
            onCreated={handleCreated}
            onBulkImported={handleBulkImported}
          />
        </div>
      )}

      {/* Detail overlay */}
      {selected && (
        <PicklistDetailOverlay
          picklist={selected}
          onClose={() => setSelected(null)}
          onUpdated={(pl, count) => handleUpdated(pl, count)}
        />
      )}

      {/* Bulk import result */}
      {bulkResult && (
        <BulkImportResultDialog
          result={bulkResult}
          onClose={() => setBulkResult(null)}
        />
      )}
    </div>
  )
}
