import { useState, useEffect, useCallback, useRef } from 'react'
import type { Transformation } from '../../../types/index.js'
import { TransformationEditor } from '../TransformationEditor/index.js'

/** Strip Electron's "Error invoking remote method '...': Error: " prefix. */
function ipcMsg(e: unknown): string {
  const msg = e instanceof Error ? e.message : 'Something went wrong.'
  const idx = msg.lastIndexOf(': Error: ')
  return idx !== -1 ? msg.slice(idx + 9) : msg
}

// ── Context Menu ──────────────────────────────────────────────────────────────

function CardMenu({
  x, y,
  onRename,
  onDuplicate,
  onDelete,
  onClose,
}: {
  x: number; y: number
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{ top: y, left: x }}
      className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px] text-sm"
    >
      <button
        onClick={(e) => { e.stopPropagation(); onRename(); onClose() }}
        className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700"
      >
        Rename
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDuplicate(); onClose() }}
        className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700"
      >
        Duplicate
      </button>
      <div className="border-t border-gray-100 my-1" />
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); onClose() }}
        className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600"
      >
        Delete
      </button>
    </div>
  )
}

// ── Transformation Card ───────────────────────────────────────────────────────

function TransformationCard({
  transformation,
  mappingCount,
  onClick,
  onDelete,
  onDuplicate,
  onRenameRequest,
}: {
  transformation: Transformation
  mappingCount: number
  onClick: () => void
  onDelete: () => void
  onDuplicate: () => void
  onRenameRequest: () => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const handleMenuButton = (e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ x: rect.left, y: rect.bottom + 4 })
  }

  const updatedAt = new Date(transformation.updatedAt).toLocaleDateString()

  return (
    <>
      <div
        onClick={onClick}
        onContextMenu={handleContextMenu}
        className="group relative bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:border-violet-300 hover:shadow-sm transition-all"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-800 break-words">{transformation.name}</p>
            {transformation.description && (
              <p className="text-xs text-gray-400 mt-0.5 break-words">{transformation.description}</p>
            )}
          </div>
          <button
            onClick={handleMenuButton}
            className="shrink-0 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 px-1 py-0.5 rounded transition-colors leading-none"
          >
            ···
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

      {menu && (
        <CardMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRename={onRenameRequest}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      )}
    </>
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

  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)

  // Create form error
  const [createError, setCreateError] = useState<string | null>(null)

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
    setCreateError(null)
    try {
      const t = await window.electronAPI.createTransformation(newName.trim(), newDesc.trim() || undefined)
      setTransformations(prev => [...prev, t])
      setMappingCounts(prev => ({ ...prev, [t.id]: 0 }))
      setNewName('')
      setNewDesc('')
      setShowForm(false)
      // Open editor immediately
      setEditingId(t.id)
    } catch (e) {
      setCreateError(ipcMsg(e))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    await window.electronAPI.deleteTransformation(id)
    setTransformations(prev => prev.filter(t => t.id !== id))
  }

  const handleDuplicate = async (id: string) => {
    const copy = await window.electronAPI.duplicateTransformation(id)
    const mappings = await window.electronAPI.getFieldMappings(copy.id)
    setTransformations(prev => [...prev, copy])
    setMappingCounts(prev => ({ ...prev, [copy.id]: mappings.length }))
  }

  const startRename = (t: Transformation) => {
    setRenamingId(t.id)
    setRenameValue(t.name)
    setRenameError(null)
  }

  const commitRename = async () => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return }
    setRenameError(null)
    try {
      const updated = await window.electronAPI.updateTransformation(renamingId, { name: renameValue.trim() })
      setTransformations(prev => prev.map(t => t.id === updated.id ? updated : t))
      setRenamingId(null)
    } catch (e) {
      setRenameError(ipcMsg(e))
    }
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
              onChange={e => { setNewName(e.target.value); setCreateError(null) }}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowForm(false) }}
              placeholder="Transformation name *"
              className={`w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 ${createError ? 'border-red-300 focus:ring-red-400' : 'border-gray-200 focus:ring-violet-500'}`}
            />
            {createError && <p className="text-xs text-red-500">{createError}</p>}
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

      {/* Rename dialog */}
      {renamingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => setRenamingId(null)}>
          <div className="bg-white rounded-xl shadow-xl p-5 w-80" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-800 mb-3">Rename transformation</p>
            <input
              autoFocus
              value={renameValue}
              onChange={e => { setRenameValue(e.target.value); setRenameError(null) }}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null) }}
              className={`w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 ${renameError ? 'border-red-300 focus:ring-red-400' : 'border-gray-200 focus:ring-violet-500'}`}
            />
            {renameError && <p className="text-xs text-red-500 mt-1">{renameError}</p>}
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setRenamingId(null)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
              <button
                onClick={commitRename}
                disabled={!renameValue.trim()}
                className="px-4 py-1.5 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 disabled:opacity-40"
              >
                Rename
              </button>
            </div>
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
                onDelete={() => handleDelete(t.id)}
                onDuplicate={() => handleDuplicate(t.id)}
                onRenameRequest={() => startRename(t)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
