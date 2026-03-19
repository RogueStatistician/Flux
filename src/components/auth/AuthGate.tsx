import { type ReactNode, useEffect } from 'react'
import { useAuthStore } from '../../store/auth.js'
import { LoginPage } from './LoginPage.js'
import { InvitePage } from './InvitePage.js'
import type { AuthUser } from '../../store/auth.js'

// Detect Electron runtime (contextBridge exposes window.electronAPI)
export const isElectron = typeof window !== 'undefined' && 'electronAPI' in window

// Extract invite token from /invite/<token> paths
function getInviteToken(): string | null {
  const match = window.location.pathname.match(/^\/invite\/([^/]+)$/)
  return match ? match[1] : null
}

interface AuthGateProps {
  children: ReactNode
}

/**
 * AuthGate — wraps the entire app.
 * - In Electron: auth is skipped (no HTTP server, no cookies).
 * - /invite/<token> paths: show InvitePage regardless of auth state.
 * - In web mode: calls GET /auth/me on mount to check session validity.
 *   Shows a loading state, then either the app or the login page.
 */
export function AuthGate({ children }: AuthGateProps) {
  const { authStatus, setUser, clearUser } = useAuthStore()

  // Check for invite URL BEFORE checking auth — invite page is public
  const inviteToken = isElectron ? null : getInviteToken()
  if (inviteToken) {
    return <InvitePage token={inviteToken} />
  }

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
