import { useState, useEffect, type FormEvent } from 'react'
import { useAuthStore } from '../../store/auth.js'
import type { AuthUser } from '../../store/auth.js'

interface Props {
  token: string
}

interface InviteInfo {
  role: 'admin' | 'user'
  expiresAt: string
}

export function InvitePage({ token }: Props) {
  const { setUser } = useAuthStore()

  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Validate the invite token on mount
  useEffect(() => {
    fetch(`/auth/invites/${encodeURIComponent(token)}/validate`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: InviteInfo) => setInvite(data))
      .catch((status) => {
        if (status === 404 || status === 410) {
          setInviteError('This invite link is invalid or has expired.')
        } else {
          setInviteError('Unable to validate invite. Please try again.')
        }
      })
  }, [token])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, username: username.trim(), password }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as Record<string, string>
        const code = data.code ?? ''
        if (code === 'USERNAME_TAKEN') {
          setError('That username is already taken. Please choose another.')
        } else if (code === 'INVITE_INVALID') {
          setError('This invite link is invalid or has expired.')
        } else {
          setError(data.message ?? 'Registration failed. Please try again.')
        }
        return
      }

      const user = await res.json() as AuthUser
      // Redirect away from the invite URL so the invite path isn't bookmarked
      window.history.replaceState(null, '', '/')
      setUser(user)
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">Flux</h1>
          <p className="text-gray-400 mt-1 text-sm">Data transformation platform</p>
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          {inviteError ? (
            <div className="text-center">
              <p className="text-red-400 text-sm">{inviteError}</p>
              <a
                href="/"
                className="mt-4 inline-block text-blue-400 hover:text-blue-300 text-sm underline"
              >
                Go to login
              </a>
            </div>
          ) : invite === null ? (
            <div className="flex justify-center py-4">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-white mb-1">Create your account</h2>
              <p className="text-gray-400 text-sm mb-5">
                You've been invited as a{invite.role === 'admin' ? 'n' : ''}{' '}
                <span className="text-white font-medium">{invite.role}</span>.
              </p>

              {error && (
                <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5" htmlFor="username">
                    Username
                  </label>
                  <input
                    id="username"
                    type="text"
                    autoComplete="username"
                    required
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    placeholder="Choose a username"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1.5" htmlFor="password">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    placeholder="Minimum 8 characters"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1.5" htmlFor="confirm-password">
                    Confirm password
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    placeholder="Re-enter your password"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2 text-sm transition-colors mt-2"
                >
                  {loading ? 'Creating account…' : 'Create account'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
