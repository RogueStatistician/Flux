import { type ReactNode, useEffect } from 'react'
import { useAuthStore } from '../../store/auth.js'
import { LoginPage } from './LoginPage.js'
import type { AuthUser } from '../../store/auth.js'

// Detect Electron runtime (contextBridge exposes window.electronAPI)
const isElectron = typeof window !== 'undefined' && 'electronAPI' in window

interface AuthGateProps {
  children: ReactNode
}

/**
 * AuthGate — wraps the entire app.
 * - In Electron: auth is skipped (no HTTP server, no cookies).
 * - In web mode: calls GET /auth/me on mount to check session validity.
 *   Shows a loading state, then either the app or the login page.
 */
export function AuthGate({ children }: AuthGateProps) {
  const { authStatus, setUser, clearUser } = useAuthStore()

  useEffect(() => {
    if (isElectron) {
      // Desktop mode: no auth needed — mark as authenticated immediately
      setUser({ id: 'electron', username: 'local', role: 'admin' })
      return
    }

    fetch('/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((user: AuthUser) => setUser(user))
      .catch(() => clearUser())
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  if (authStatus === 'loading') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (authStatus === 'unauthenticated') {
    return <LoginPage />
  }

  return <>{children}</>
}
