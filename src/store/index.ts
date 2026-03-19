import { create } from 'zustand'
import type { AppView, WorkspaceSection, ProjectMeta } from '../types/index.js'

interface AppState {
  // ── UI ──────────────────────────────────────────────────────────────────────
  currentView: AppView
  previousView: AppView
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
  previousView: 'home',
  workspaceSection: 'sources',
  project: null,

  setCurrentView: (view) =>
    set((state) => ({ previousView: state.currentView, currentView: view })),

  setWorkspaceSection: (section) => set({ workspaceSection: section }),

  openProject: (meta) =>
    set((state) => ({ project: meta, previousView: state.currentView, currentView: 'workspace' })),

  closeProject: () =>
    set({ project: null, currentView: 'home', previousView: 'home', workspaceSection: 'sources' }),

  updateProjectMeta: (fields) =>
    set((state) => ({
      project: state.project ? { ...state.project, ...fields } : null,
    })),
}))
