/**
 * AdminConsole — server management view for admin users.
 * Accessible only in web mode (not Electron).
 * Tabs: Users | Projects
 */
import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { useAuthStore } from '../../store/auth.js'
import { useAppStore } from '../../store/index.js'

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserRecord {
  id: string
  username: string
  role: 'admin' | 'user'
  createdAt: string
  lastLogin: string | null
}

interface InviteToken {
  token: string
  createdBy: string
  role: 'admin' | 'user'
  createdAt: string
  expiresAt: string
}

interface ProjectFile {
  projectUuid: string
  filePath: string
  fileName: string
  ownerUsername: string
  ownerId: string
  sizeBytes: number
  modifiedAt: string
  exists: boolean
  isLocked: boolean
  lockedBy: string | null
  lockedAt: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab() {
  const currentUser = useAuthStore(s => s.user)

  const [users, setUsers] = useState<UserRecord[]>([])
  const [invites, setInvites] = useState<InviteToken[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Invite dialog state
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user')
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)

  // Change password dialog
  const [changePwUserId, setChangePwUserId] = useState<string | null>(null)
  const [newPw, setNewPw] = useState('')
  const [changePwLoading, setChangePwLoading] = useState(false)
  const [changePwError, setChangePwError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [usersRes, invitesRes] = await Promise.all([
        fetch('/auth/users', { credentials: 'include' }),
        fetch('/auth/invites', { credentials: 'include' }),
      ])
      if (!usersRes.ok) throw new Error('Failed to load users.')
      if (!invitesRes.ok) throw new Error('Failed to load invites.')
      setUsers(await usersRes.json())
      setInvites(await invitesRes.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleRoleToggle = async (user: UserRecord) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin'
    const res = await fetch(`/auth/users/${user.id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ role: newRole }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as Record<string, string>
      setError(data.code === 'LAST_ADMIN'
        ? 'Cannot demote the last admin.'
        : (data.message ?? 'Role update failed.'))
      return
    }
    setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: newRole } : u))
  }

  const handleDelete = async (user: UserRecord) => {
    if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return
    const res = await fetch(`/auth/users/${user.id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as Record<string, string>
      setError(data.code === 'LAST_ADMIN'
        ? 'Cannot delete the last admin.'
        : (data.message ?? 'Delete failed.'))
      return
    }
    setUsers(prev => prev.filter(u => u.id !== user.id))
  }

  const handleCreateInvite = async (e: FormEvent) => {
    e.preventDefault()
    setInviteLoading(true)
    setInviteUrl(null)
    try {
      const res = await fetch('/auth/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role: inviteRole }),
      })
      if (!res.ok) throw new Error('Failed to create invite.')
      const data = await res.json() as { token: string }
      setInviteUrl(`${window.location.origin}/invite/${data.token}`)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create invite.')
    } finally {
      setInviteLoading(false)
    }
  }

  const handleRevokeInvite = async (token: string) => {
    const res = await fetch(`/auth/invites/${encodeURIComponent(token)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) setInvites(prev => prev.filter(i => i.token !== token))
  }

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault()
    if (!changePwUserId || newPw.length < 8) return
    setChangePwLoading(true)
    setChangePwError(null)
    try {
      const res = await fetch(`/auth/users/${changePwUserId}/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newPassword: newPw }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as Record<string, string>
        setChangePwError(data.message ?? 'Failed to update password.')
        return
      }
      setChangePwUserId(null)
      setNewPw('')
    } catch {
      setChangePwError('Connection error.')
    } finally {
      setChangePwLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      {/* Users list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Users ({users.length})</h2>
          <button
            onClick={() => { setShowInviteForm(true); setInviteUrl(null) }}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
          >
            Invite user
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          {users.map((user, i) => (
            <div
              key={user.id}
              className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-gray-100' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800">{user.username}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    user.role === 'admin'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {user.role}
                  </span>
                  {user.id === currentUser?.id && (
                    <span className="text-xs text-blue-500">(you)</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  Joined {formatDate(user.createdAt)}
                  {user.lastLogin && ` · Last login ${formatDate(user.lastLogin)}`}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleRoleToggle(user)}
                  disabled={user.id === currentUser?.id}
                  title={user.id === currentUser?.id ? 'Cannot change your own role' : `Make ${user.role === 'admin' ? 'regular user' : 'admin'}`}
                  className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-2 py-1 rounded hover:bg-gray-100"
                >
                  {user.role === 'admin' ? 'Demote' : 'Promote'}
                </button>
                <button
                  onClick={() => { setChangePwUserId(user.id); setNewPw(''); setChangePwError(null) }}
                  title="Set password"
                  className="text-xs text-gray-400 hover:text-gray-700 transition-colors px-2 py-1 rounded hover:bg-gray-100"
                >
                  Password
                </button>
                <button
                  onClick={() => handleDelete(user)}
                  disabled={user.id === currentUser?.id}
                  title={user.id === currentUser?.id ? 'Cannot delete yourself' : 'Delete user'}
                  className="text-xs text-red-300 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-2 py-1 rounded hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Pending Invites ({invites.length})</h2>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            {invites.map((invite, i) => (
              <div
                key={invite.token}
                className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-gray-100' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      invite.role === 'admin'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {invite.role}
                    </span>
                    <span className="text-xs text-gray-400 font-mono truncate max-w-xs">
                      {invite.token}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Expires {formatDate(invite.expiresAt)}
                  </p>
                </div>
                <button
                  onClick={() => handleRevokeInvite(invite.token)}
                  className="text-xs text-red-300 hover:text-red-600 transition-colors px-2 py-1 rounded hover:bg-red-50 shrink-0"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite form modal */}
      {showInviteForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Invite a user</h3>

            {inviteUrl ? (
              <div>
                <p className="text-sm text-gray-600 mb-3">
                  Share this link with the new user. It expires in 7 days and can only be used once.
                </p>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                  <p className="text-xs text-gray-500 font-mono break-all">{inviteUrl}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText(inviteUrl)}
                    className="flex-1 text-sm bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition-colors font-medium"
                  >
                    Copy link
                  </button>
                  <button
                    onClick={() => { setShowInviteForm(false); setInviteUrl(null) }}
                    className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateInvite} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-2">Role</label>
                  <div className="flex gap-3">
                    {(['user', 'admin'] as const).map(r => (
                      <label key={r} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="role"
                          value={r}
                          checked={inviteRole === r}
                          onChange={() => setInviteRole(r)}
                          className="accent-blue-600"
                        />
                        <span className="text-sm text-gray-700 capitalize">{r}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={inviteLoading}
                    className="flex-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg transition-colors font-medium"
                  >
                    {inviteLoading ? 'Generating…' : 'Generate invite link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowInviteForm(false)}
                    className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Change password modal */}
      {changePwUserId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">
              Set password for {users.find(u => u.id === changePwUserId)?.username}
            </h3>
            {changePwError && (
              <p className="text-sm text-red-600 mb-3">{changePwError}</p>
            )}
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1.5">New password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Minimum 8 characters"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={changePwLoading || newPw.length < 8}
                  className="flex-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg transition-colors font-medium"
                >
                  {changePwLoading ? 'Saving…' : 'Update password'}
                </button>
                <button
                  type="button"
                  onClick={() => { setChangePwUserId(null); setNewPw('') }}
                  className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Projects tab ──────────────────────────────────────────────────────────────

function ProjectsTab() {
  const [projects, setProjects] = useState<ProjectFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingUuid, setDeletingUuid] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/projects', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load projects.')
      setProjects(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (project: ProjectFile) => {
    const lockWarning = project.isLocked ? ` It is currently locked by ${project.lockedBy} and will be force-released.` : ''
    if (!confirm(`Delete "${project.fileName}"?${lockWarning} This cannot be undone.`)) return

    setDeletingUuid(project.projectUuid)
    setError(null)
    try {
      const res = await fetch('/api/admin/projects', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ projectUuid: project.projectUuid }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as Record<string, string>
        setError(data.message ?? 'Delete failed.')
        return
      }
      setProjects(prev => prev.filter(p => p.projectUuid !== project.projectUuid))
    } catch {
      setError('Connection error.')
    } finally {
      setDeletingUuid(null)
    }
  }

  const handleDownload = (project: ProjectFile) => {
    const url = `/api/admin/projects/download?filePath=${encodeURIComponent(project.filePath)}`
    const a = document.createElement('a')
    a.href = url
    a.download = project.fileName
    a.click()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm flex items-center justify-between mb-4">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700">
          Projects ({projects.length})
        </h2>
        <button
          onClick={load}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Refresh
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center shadow-sm">
          <p className="text-sm text-gray-400">No projects registered yet.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          {projects.map((project, i) => (
            <div
              key={project.projectUuid}
              className={`group flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-gray-100' : ''} ${
                deletingUuid === project.projectUuid ? 'opacity-50' : ''
              } ${!project.exists ? 'opacity-60' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-800 truncate">
                    {project.fileName.replace(/\.flux$/, '')}
                  </span>
                  {/* Owner badge */}
                  <span className="text-xs text-gray-400 shrink-0">
                    by {project.ownerUsername}
                  </span>
                  {/* Lock badge */}
                  {project.isLocked && (
                    <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium shrink-0">
                      locked by {project.lockedBy}
                    </span>
                  )}
                  {/* Missing file badge */}
                  {!project.exists && (
                    <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium shrink-0">
                      file missing
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 font-mono truncate mt-0.5">
                  {project.filePath}
                </p>
                {project.exists && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatBytes(project.sizeBytes)} · Modified {formatDate(project.modifiedAt)}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {project.exists && (
                  <button
                    onClick={() => handleDownload(project)}
                    title="Download .flux file"
                    className="text-xs text-gray-300 hover:text-blue-500 transition-colors px-2 py-1 rounded hover:bg-blue-50 opacity-0 group-hover:opacity-100"
                  >
                    ↓
                  </button>
                )}
                <button
                  onClick={() => handleDelete(project)}
                  disabled={deletingUuid === project.projectUuid}
                  className="text-xs text-red-300 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-2 py-1 rounded hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Admin Console (shell) ─────────────────────────────────────────────────────

type Tab = 'users' | 'projects'

export function AdminConsole() {
  const setCurrentView = useAppStore(s => s.setCurrentView)
  const previousView = useAppStore(s => s.previousView)
  const clearUser = useAuthStore(s => s.clearUser)
  const [tab, setTab] = useState<Tab>('users')

  const handleLogout = useCallback(async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    clearUser()
  }, [clearUser])

  const handleBack = useCallback(() => {
    // Go back to previous view, or home if there's no meaningful previous view
    setCurrentView(previousView === 'admin' ? 'home' : previousView)
  }, [previousView, setCurrentView])

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className="w-52 bg-gray-900 flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-gray-700">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-xs">F</span>
            </div>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Flux</span>
          </div>
          <p className="text-sm font-semibold text-white mt-1">Admin Console</p>
        </div>

        <nav className="flex-1 py-2">
          {([
            { id: 'users', label: 'Users', icon: '👤' },
            { id: 'projects', label: 'Projects', icon: '📁' },
          ] as { id: Tab; label: string; icon: string }[]).map(item => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={[
                'w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors',
                tab === item.id
                  ? 'bg-blue-600 text-white font-medium'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white',
              ].join(' ')}
            >
              <span className="text-base leading-none w-4 text-center">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-700 flex flex-col gap-1">
          <button
            onClick={handleBack}
            className="w-full text-left text-xs text-gray-500 hover:text-gray-200 transition-colors py-1"
          >
            ← Back
          </button>
          <button
            onClick={handleLogout}
            className="w-full text-left text-xs text-gray-600 hover:text-gray-300 transition-colors py-1 mt-1 border-t border-gray-800 pt-2"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="px-6 py-4 border-b bg-white shrink-0 flex items-center">
          <h1 className="text-sm font-semibold text-gray-800">
            {tab === 'users' ? 'Users' : 'Projects'}
          </h1>
        </div>
        <div className="p-6 max-w-3xl">
          {tab === 'users' ? <UsersTab /> : <ProjectsTab />}
        </div>
      </main>
    </div>
  )
}
