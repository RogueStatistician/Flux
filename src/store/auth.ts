import { create } from 'zustand'

export interface AuthUser {
  id: string
  username: string
  role: 'admin' | 'user'
}

interface AuthState {
  user: AuthUser | null
  authStatus: 'loading' | 'authenticated' | 'unauthenticated'
  setUser: (user: AuthUser) => void
  clearUser: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  authStatus: 'loading',

  setUser: (user) => set({ user, authStatus: 'authenticated' }),

  clearUser: () => set({ user: null, authStatus: 'unauthenticated' }),
}))
