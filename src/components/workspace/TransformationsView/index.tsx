import { useState, useEffect, useCallback } from 'react'
import type { Transformation, FieldMapping } from '../../../types/index.js'
import { TransformationEditor } from '../TransformationEditor/index.js'

// ── Transformation Card ───────────────────────────────────────────────────────

function TransformationCard({
  transformation,
  mappingCount,
  onClick,
  onDelete,
}: {
  transformation: Transformation
  mappingCount: number
  onClick: () => void
  onDelete: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirmDelete) { setConfirmDelete(true); return }
    await window.electronAPI.deleteTransformation(transformation.id)
    onDelete()
  }

  const updatedAt = new Date(transformation.updatedAt).toLocaleDateString()

  return (
    <div
      onClick={onClick}
      className="group bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:border-violet-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-800 truncate">{transformation.name}</p>
          {transformation.description && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">{transformation.description}</p>
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
        <span className="bg-violet-50 text-violet-700 px-2 py-0.5 rounded font-medium">
          {mappingCount} rule{mappingCount !== 1 ? 's' : ''}
        </span>
        <span>Updated {updatedAt}</span>
      </div>

      <div className="mt-3">
        <span className="text-xs text-violet-600 font-medium group-hover:underline">
          Open editor →
        </span>
      </div>
    </div>
  )
}

// ── TransformationsView ───────────────────────────────────────────────────────

export function TransformationsView() {
  const [transformations, setTransformations] = useState<Transformation[]>([])
  const [mappingCounts, setMappingCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)

  // New transformation form
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const all = await window.electronAPI.listTransformations()
    setTransformations(all)
    const counts: Record<string, number> = {}
    await Promise.all(all.map(async t => {
      const mappings = await window.electronAPI.getFieldMappings(t.id)
      counts[t.id] = mappings.length
    }))
    setMappingCounts(counts)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const t = await window.electronAPI.createTransformation(newName.trim(), newDesc.trim() || undefined)
      setTransformations(prev => [...prev, t])
      setMappingCounts(prev => ({ ...prev, [t.id]: 0 }))
      setNewName('')
      setNewDesc('')
      setShowForm(false)
      // Open editor immediately
      setEditingId(t.id)
    } finally {
      setCreating(false)
    }
  }

  const handleDeleted = (id: string) => {
    setTransformations(prev => prev.filter(t => t.id !== id))
  }

  const handleEditorBack = useCallback(() => {
    setEditingId(null)
    // Refresh mapping counts when coming back
    load()
  }, [load])

  // ── Editor mode ──────────────────────────────────────────────────────────────

  if (editingId) {
    return (
      <TransformationEditor
        transformationId={editingId}
        onBack={handleEditorBack}
      />
    )
  }

  // ── List mode ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="px-6 py-4 border-b bg-white shrink-0 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">Transformations</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Visual field-mapping rules between source and target objects
          </p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors"
        >
          + New transformation
        </button>
      </div>

      {/* New form */}
      {showForm && (
        <div className="px-6 py-3 border-b bg-white flex items-start gap-3">
          <div className="flex-1 space-y-2">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowForm(false) }}
              placeholder="Transformation name *"
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <input
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>
          <div className="flex gap-2 pt-0.5">
            <button onClick={() => setShowForm(false)} className="text-sm text-gray-500 hover:text-gray-700 px-2 py-1.5">Cancel</button>
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="px-4 py-1.5 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 disabled:opacity-40"
            >
              {creating ? '…' : 'Create & open'}
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="text-center text-gray-300 text-sm mt-20">Loading…</div>
        ) : transformations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-64 text-center">
            <div className="w-14 h-14 bg-violet-50 rounded-2xl flex items-center justify-center mb-4 text-2xl">⚡</div>
            <p className="text-sm font-medium text-gray-500">No transformations yet</p>
            <p className="text-xs text-gray-400 mt-1 mb-4">Create one to start mapping fields between objects</p>
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors"
            >
              New transformation
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {transformations.map(t => (
              <TransformationCard
                key={t.id}
                transformation={t}
                mappingCount={mappingCounts[t.id] ?? 0}
                onClick={() => setEditingId(t.id)}
                onDelete={() => handleDeleted(t.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
