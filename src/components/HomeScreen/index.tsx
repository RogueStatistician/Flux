import { useState, useEffect } from 'react'
import type { RecentProject } from '../../types/index.js'
import { useAppStore } from '../../store/index.js'

export function HomeScreen() {
  const openProject = useAppStore(s => s.openProject)

  const [recents, setRecents] = useState<RecentProject[]>([])
  const [newName, setNewName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.listRecentProjects().then(setRecents).catch(() => setRecents([]))
  }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setIsCreating(true)
    setError(null)
    try {
      const meta = await window.electronAPI.createProject(newName.trim())
      if (meta) openProject(meta)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create project.')
    } finally {
      setIsCreating(false)
    }
  }

  const handleOpenFile = async () => {
    setError(null)
    try {
      const result = await window.electronAPI.openFile({
        title: 'Open Flux Project',
        filters: [{ name: 'Flux Projects', extensions: ['flux'] }],
        properties: ['openFile'],
      })
      if (result.canceled || !result.filePaths[0]) return
      const meta = await window.electronAPI.openProject(result.filePaths[0])
      openProject(meta)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open project.')
    }
  }

  const handleOpenRecent = async (filePath: string) => {
    setError(null)
    try {
      const meta = await window.electronAPI.openProject(filePath)
      openProject(meta)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open project.')
    }
  }

  const handleRemoveRecent = async (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation()
    await window.electronAPI.removeRecentProject(filePath).catch(() => {})
    setRecents(prev => prev.filter(r => r.filePath !== filePath))
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
      {/* Logo */}
      <div className="mb-10 text-center">
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
          <span className="text-white font-bold text-3xl">F</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Flux</h1>
        <p className="text-sm text-gray-400 mt-1">Field Level Universal EXchange</p>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 max-w-sm w-full text-center">
          {error}
        </div>
      )}

      {/* Action cards */}
      <div className="flex flex-col gap-3 w-full max-w-sm">
        {/* New project */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-sm font-medium text-gray-700 mb-2">New Project</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Project name…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || isCreating}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {isCreating ? '…' : 'Create'}
            </button>
          </div>
        </div>

        {/* Open project */}
        <button
          onClick={handleOpenFile}
          className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm text-left hover:border-blue-300 hover:bg-blue-50 transition-colors group"
        >
          <p className="text-sm font-medium text-gray-700 group-hover:text-blue-700">Open Project</p>
          <p className="text-xs text-gray-400 mt-0.5">Browse for a .flux file</p>
        </button>
      </div>

      {/* Recent projects */}
      {recents.length > 0 && (
        <div className="mt-8 w-full max-w-sm">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recent</p>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            {recents.map((r, i) => (
              <div
                key={r.filePath}
                className={`group flex items-center hover:bg-gray-50 transition-colors ${
                  i > 0 ? 'border-t border-gray-100' : ''
                }`}
              >
                <button
                  onClick={() => handleOpenRecent(r.filePath)}
                  className="flex-1 text-left px-4 py-3 min-w-0"
                >
                  <p className="text-sm font-medium text-gray-800 break-words">{r.name}</p>
                  <p className="text-xs text-gray-400 font-mono break-words mt-0.5">{r.filePath}</p>
                </button>
                <button
                  onClick={e => handleRemoveRecent(e, r.filePath)}
                  title="Remove from list"
                  className="shrink-0 px-3 py-3 text-gray-200 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-300 mt-10">v0.4.0</p>
    </div>
  )
}
