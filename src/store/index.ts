import { create } from 'zustand'
import type { AppView, WorkspaceSection, ProjectMeta } from '../types/index.js'

interface AppState {
  // ── UI ──────────────────────────────────────────────────────────────────────
  currentView: AppView
  workspaceSection: WorkspaceSection

  // ── Project ─────────────────────────────────────────────────────────────────
  project: ProjectMeta | null

  // ── Actions ─────────────────────────────────────────────────────────────────
  setCurrentView: (view: AppView) => void
  setWorkspaceSection: (section: WorkspaceSection) => void
  openProject: (meta: ProjectMeta) => void
  closeProject: () => void
  updateProjectMeta: (fields: Partial<ProjectMeta>) => void
}

export const useAppStore = create<AppState>((set) => ({
  currentView: 'home',
  workspaceSection: 'sources',
  project: null,

  setCurrentView: (view) => set({ currentView: view }),

  setWorkspaceSection: (section) => set({ workspaceSection: section }),

  openProject: (meta) => set({ project: meta, currentView: 'workspace' }),

  closeProject: () =>
    set({ project: null, currentView: 'home', workspaceSection: 'sources' }),

  updateProjectMeta: (fields) =>
    set((state) => ({
      project: state.project ? { ...state.project, ...fields } : null,
    })),
}))
