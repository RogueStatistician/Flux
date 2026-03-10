/**
 * ProjectWorkspace — the main application shell once a project is open.
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { useAppStore } from '../../store/index.js'
import type { WorkspaceSection } from '../../types/index.js'
import { SourcesView } from '../workspace/SourcesView/index.js'
import { TargetsView } from '../workspace/TargetsView/index.js'
import { PicklistsView } from '../workspace/PicklistsView/index.js'
import { PLMappingsView } from '../workspace/PLMappingsView/index.js'
import { TransformationsView } from '../workspace/TransformationsView/index.js'
import { RunsView } from '../workspace/RunsView/index.js'

// ── Sidebar nav ───────────────────────────────────────────────────────────────

const NAV_ITEMS: { id: WorkspaceSection; label: string; icon: string }[] = [
  { id: 'sources',         label: 'Sources',         icon: '↑' },
  { id: 'targets',         label: 'Targets',         icon: '↓' },
  { id: 'picklists',       label: 'Picklists',       icon: '≡' },
  { id: 'plmappings',      label: 'PL Mappings',     icon: '⇌' },
  { id: 'transformations', label: 'Transformations', icon: '⚡' },
  { id: 'runs',            label: 'Runs',            icon: '▶' },
]

// ── Section placeholders ──────────────────────────────────────────────────────

function EmptySection({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <p className="text-base font-medium text-gray-300">{label}</p>
        <p className="text-sm text-gray-200 mt-1">Coming soon</p>
      </div>
    </div>
  )
}

// ── Inline project name editor ────────────────────────────────────────────────

function ProjectNameEditor() {
  const project           = useAppStore(s => s.project)
  const updateProjectMeta = useAppStore(s => s.updateProjectMeta)

  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')
  const inputRef              = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const startEdit = () => {
    setDraft(project?.name ?? '')
    setEditing(true)
  }

  const save = useCallback(async () => {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === project?.name) { setEditing(false); return }
    try {
      const updated = await window.electronAPI.updateProject({ name: trimmed })
      updateProjectMeta({ name: updated.name })
    } finally {
      setEditing(false)
    }
  }, [draft, project?.name, updateProjectMeta])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  save()
    if (e.key === 'Escape') setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={onKeyDown}
        className="w-full bg-gray-800 text-white text-sm font-semibold rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    )
  }

  return (
    <button
      onClick={startEdit}
      title="Click to rename"
      className="w-full text-left text-sm font-semibold text-white break-words hover:text-blue-300 transition-colors"
    >
      {project?.name}
    </button>
  )
}

// ── Delete confirmation panel ─────────────────────────────────────────────────

function DeleteProjectPanel({ onCancel }: { onCancel: () => void }) {
  const closeProject = useAppStore(s => s.closeProject)
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    setBusy(true)
    setError(null)
    try {
      await window.electronAPI.deleteProject()
      closeProject()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete project.')
      setBusy(false)
    }
  }

  return (
    <div className="p-3 border-t border-gray-700 bg-gray-950">
      <p className="text-xs text-red-400 font-medium mb-1">Delete this project?</p>
      <p className="text-xs text-gray-500 mb-3 leading-relaxed">
        The .flux file will be permanently removed from disk.
      </p>
      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="flex-1 text-xs text-gray-400 hover:text-white transition-colors py-1"
        >
          Cancel
        </button>
        <button
          onClick={handleDelete}
          disabled={busy}
          className="flex-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded py-1 transition-colors disabled:opacity-50"
        >
          {busy ? '…' : 'Delete'}
        </button>
      </div>
    </div>
  )
}

// ── Workspace ─────────────────────────────────────────────────────────────────

export function ProjectWorkspace() {
  const project      = useAppStore(s => s.project)
  const section      = useAppStore(s => s.workspaceSection)
  const setSection   = useAppStore(s => s.setWorkspaceSection)
  const closeProject = useAppStore(s => s.closeProject)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleClose = useCallback(async () => {
    await window.electronAPI.closeProject()
    closeProject()
  }, [closeProject])

  const activeLabel = NAV_ITEMS.find(i => i.id === section)?.label ?? section

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* ── Sidebar ── */}
      <aside className="w-52 bg-gray-900 flex flex-col shrink-0">
        {/* Project identity */}
        <div className="px-4 py-4 border-b border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-xs">F</span>
            </div>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Flux</span>
          </div>
          <ProjectNameEditor />
          {project?.client && (
            <p className="text-xs text-gray-400 break-words mt-0.5">{project.client}</p>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={[
                'w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors',
                section === item.id
                  ? 'bg-blue-600 text-white font-medium'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white',
              ].join(' ')}
            >
              <span className="text-base leading-none w-4 text-center">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        {/* Bottom actions */}
        {showDeleteConfirm ? (
          <DeleteProjectPanel onCancel={() => setShowDeleteConfirm(false)} />
        ) : (
          <div className="p-3 border-t border-gray-700 flex flex-col gap-1">
            <button
              onClick={handleClose}
              className="w-full text-left text-xs text-gray-500 hover:text-gray-200 transition-colors py-1"
            >
              ← Close project
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full text-left text-xs text-red-900 hover:text-red-400 transition-colors py-1"
            >
              Delete project…
            </button>
          </div>
        )}
      </aside>

      {/* ── Main area ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="px-6 py-3 border-b bg-white shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-800">{project?.name}</span>
            <span className="text-gray-300">·</span>
            <span className="text-sm text-gray-400">{activeLabel}</span>
          </div>
          {project?.client && (
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
              {project.client}
            </span>
          )}
        </div>

        {/* Section content */}
        {section === 'sources'             ? <SourcesView />
          : section === 'targets'          ? <TargetsView />
          : section === 'picklists'        ? <PicklistsView />
          : section === 'plmappings'       ? <PLMappingsView />
          : section === 'transformations'  ? <TransformationsView />
          : section === 'runs'             ? <RunsView />
          : <EmptySection label={activeLabel} />
        }
      </main>
    </div>
  )
}
