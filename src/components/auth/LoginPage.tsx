import { useState, type FormEvent } from 'react'
import { useAuthStore } from '../../store/auth.js'
import type { AuthUser } from '../../store/auth.js'

type Mode = 'login' | 'register'

export function LoginPage() {
  const { setUser } = useAuthStore()

  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const endpoint = mode === 'login' ? '/auth/login' : '/auth/register'

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as Record<string, string>
        setError(data.message ?? (mode === 'login' ? 'Invalid username or password.' : 'Registration failed.'))
        return
      }

      const user = await res.json() as AuthUser
      // After register, immediately log in (the register response is the user object)
      if (mode === 'register') {
        // Auto-login after first-time registration
        const loginRes = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username: username.trim(), password }),
        })
        if (!loginRes.ok) { setError('Account created but login failed. Please log in.'); setMode('login'); return }
        const loggedInUser = await loginRes.json() as AuthUser
        setUser(loggedInUser)
      } else {
        setUser(user)
      }
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo / App name */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">Flux</h1>
          <p className="text-gray-400 mt-1 text-sm">Data transformation platform</p>
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-5">
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </h2>

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
                placeholder="Enter your username"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1.5" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'register' ? 8 : undefined}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder={mode === 'register' ? 'Minimum 8 characters' : 'Enter your password'}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2 text-sm transition-colors mt-2"
            >
              {loading
                ? (mode === 'login' ? 'Signing in…' : 'Creating account…')
                : (mode === 'login' ? 'Sign in' : 'Create account')}
            </button>
          </form>
        </div>

        {/* Toggle between login and register (only shown when no users exist yet) */}
        <p className="text-center text-gray-500 text-sm mt-4">
          {mode === 'login' ? (
            <>
              First time?{' '}
              <button
                onClick={() => { setMode('register'); setError(null) }}
                className="text-blue-400 hover:text-blue-300 underline"
              >
                Create the admin account
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                onClick={() => { setMode('login'); setError(null) }}
                className="text-blue-400 hover:text-blue-300 underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
