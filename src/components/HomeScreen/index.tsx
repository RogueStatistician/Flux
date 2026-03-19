import { useState, useEffect, useCallback } from 'react'
import { platform } from '@/platform/index'
import type { RecentProject } from '../../types/index.js'
import { useAppStore } from '../../store/index.js'
import { useAuthStore } from '../../store/auth.js'
import { isElectron } from '../auth/AuthGate.js'

// ── Web project list types ────────────────────────────────────────────────────

interface WebProject {
  projectUuid: string
  filePath: string
  fileName: string
  role: 'owner' | 'editor' | 'viewer'
  ownerUsername: string
  ownerId: string
  isLocked: boolean
  lockedBy: string | null
  isOpenByMe: boolean
}

// ── HomeScreen ────────────────────────────────────────────────────────────────

export function HomeScreen() {
  const openProject      = useAppStore(s => s.openProject)
  const setCurrentView   = useAppStore(s => s.setCurrentView)
  const user             = useAuthStore(s => s.user)
  const clearUser        = useAuthStore(s => s.clearUser)

  // Electron: use recents JSON; Web: use /api/project/list
  const [recents,     setRecents]     = useState<RecentProject[]>([])
  const [webProjects, setWebProjects] = useState<WebProject[]>([])
  const [newName,     setNewName]     = useState('')
  const [isCreating,  setIsCreating]  = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const handleLogout = useCallback(async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    clearUser()
  }, [clearUser])

  // Load project list
  const loadProjects = useCallback(async () => {
    if (isElectron) {
      platform.listRecentProjects().then(setRecents).catch(() => setRecents([]))
    } else {
      try {
        const res = await fetch('/api/project/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        })
        if (res.ok) setWebProjects(await res.json())
      } catch { /* ignore */ }
    }
  }, [])

  useEffect(() => { loadProjects() }, [loadProjects])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setIsCreating(true)
    setError(null)
    try {
      const meta = await platform.createProject(newName.trim())
      if (meta) { openProject(meta); loadProjects() }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create project.')
    } finally {
      setIsCreating(false)
    }
  }

  const handleOpenFile = async () => {
    setError(null)
    try {
      const result = await platform.openFile({
        title: 'Open Flux Project',
        filters: [{ name: 'Flux Projects', extensions: ['flux'] }],
        properties: ['openFile'],
      })
      if (result.canceled || !result.filePaths[0]) return
      const meta = await platform.openProject(result.filePaths[0])
      openProject(meta)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open project.')
    }
  }

  const handleOpenRecent = async (filePath: string) => {
    setError(null)
    try {
      const meta = await platform.openProject(filePath)
      openProject(meta)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open project.')
    }
  }

  const handleOpenWebProject = async (project: WebProject) => {
    setError(null)
    if (project.isLocked) {
      setError(`This project is currently open by ${project.lockedBy}. Try again later.`)
      return
    }
    try {
      const meta = await platform.openProject(project.filePath)
      openProject(meta)
    } catch (e: unknown) {
      // Handle 423 LOCKED response from the server
      if (e instanceof Error && e.message.includes('LOCKED')) {
        await loadProjects()
        setError(e.message)
      } else {
        setError(e instanceof Error ? e.message : 'Failed to open project.')
      }
    }
  }

  const handleDownloadProject = async (project: WebProject, e: React.MouseEvent) => {
    e.stopPropagation()
    const url = `/api/project/download?uuid=${encodeURIComponent(project.projectUuid)}`
    const a = document.createElement('a')
    a.href = url
    a.download = project.fileName
    a.click()
  }

  const handleRemoveRecent = async (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation()
    await platform.removeRecentProject(filePath).catch(() => {})
    setRecents(prev => prev.filter(r => r.filePath !== filePath))
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
      {/* Top bar for web users */}
      {!isElectron && user && (
        <div className="absolute top-4 right-4 flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {user.username}
            {user.role === 'admin' && <span className="ml-1.5 text-purple-500 font-medium">admin</span>}
          </span>
          {user.role === 'admin' && (
            <button
              onClick={() => setCurrentView('admin')}
              className="text-xs text-gray-500 hover:text-gray-800 transition-colors px-2 py-1 rounded hover:bg-gray-100"
            >
              Admin Console
            </button>
          )}
          <button
            onClick={handleLogout}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}

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

        {/* Open project — Electron only (web uses the project list below) */}
        {isElectron && (
          <button
            onClick={handleOpenFile}
            className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm text-left hover:border-blue-300 hover:bg-blue-50 transition-colors group"
          >
            <p className="text-sm font-medium text-gray-700 group-hover:text-blue-700">Open Project</p>
            <p className="text-xs text-gray-400 mt-0.5">Browse for a .flux file</p>
          </button>
        )}
      </div>

      {/* Web: project list */}
      {!isElectron && webProjects.length > 0 && (
        <div className="mt-8 w-full max-w-lg">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Your Projects</p>
            <button onClick={loadProjects} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Refresh
            </button>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            {webProjects.map((p, i) => (
              <div
                key={p.projectUuid}
                className={`group flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${
                  i > 0 ? 'border-t border-gray-100' : ''
                } ${p.isLocked ? 'opacity-60' : ''}`}
              >
                <button
                  onClick={() => handleOpenWebProject(p)}
                  disabled={p.isLocked}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-800">{p.fileName.replace(/\.flux$/, '')}</span>
                    {/* Role badge */}
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      p.role === 'owner'  ? 'bg-blue-100 text-blue-700' :
                      p.role === 'editor' ? 'bg-green-100 text-green-700' :
                                            'bg-gray-100 text-gray-500'
                    }`}>
                      {p.role}
                    </span>
                    {/* Lock badge */}
                    {p.isLocked && (
                      <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">
                        locked by {p.lockedBy}
                      </span>
                    )}
                    {p.isOpenByMe && (
                      <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">
                        open
                      </span>
                    )}
                  </div>
                  {p.role !== 'owner' && (
                    <p className="text-xs text-gray-400 mt-0.5">by {p.ownerUsername}</p>
                  )}
                </button>
                {/* Download button */}
                <button
                  onClick={e => handleDownloadProject(p, e)}
                  title="Download .flux file"
                  className="shrink-0 text-xs text-gray-300 hover:text-blue-500 transition-colors px-2 py-1 rounded hover:bg-blue-50 opacity-0 group-hover:opacity-100"
                >
                  ↓
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Electron: recent projects */}
      {isElectron && recents.length > 0 && (
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

      <p className="text-xs text-gray-300 mt-10">v1.0.0</p>
    </div>
  )
}
