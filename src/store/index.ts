/**
 * SF2WD Application State — Zustand store.
 *
 * Slice-based architecture:
 *  - sourceSlice  : the loaded source file and its parsed rows
 *  - profileSlice : the active mapping profile
 *  - resultSlice  : the current transformation result
 *  - uiSlice      : UI state (current step, loading flags, error messages)
 */
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { ParseResult } from '../engine/types.js'
import type { TransformResult } from '../engine/types.js'
import type { Profile } from '../engine/schema.js'

// ── Source slice ──────────────────────────────────────────────────────────────

export interface SourceState {
  /** Path of the loaded source file (Electron only, null in web mode). */
  filePath: string | null
  /** Original filename (for display). */
  fileName: string | null
  /** Complete parse result including all rows and stats. */
  parseResult: ParseResult | null
  /** Whether the file is currently being parsed. */
  isParsing: boolean
  /** Error message from the last parse attempt. */
  parseError: string | null
}

// ── Profile slice ─────────────────────────────────────────────────────────────

export interface ProfileState {
  /** The active mapping profile. */
  profile: Profile | null
  /** Path on disk where the profile was loaded from. */
  profilePath: string | null
  /** Whether the profile has unsaved changes. */
  isDirty: boolean
  /** Error message from the last profile load/validation attempt. */
  profileError: string | null
}

// ── Result slice ──────────────────────────────────────────────────────────────

export interface ResultState {
  /** The result of the last transformation run. */
  transformResult: TransformResult | null
  /** Whether a transformation is currently running. */
  isTransforming: boolean
  /** Current transformation progress (0–100). */
  transformProgress: number
  /** Error message from the last transform attempt. */
  transformError: string | null
}

// ── UI slice ──────────────────────────────────────────────────────────────────

export type AppStep = 'load-source' | 'configure-mapping' | 'preview' | 'export'

export interface UiState {
  /** Current step in the multi-step workflow. */
  currentStep: AppStep
  /** Whether any global loading operation is in progress. */
  isLoading: boolean
  /** Global error message (for top-level error display). */
  globalError: string | null
  /** Row index currently selected in the preview grid (for detail panel). */
  selectedRowIndex: number | null
  /** Filter mode for the preview grid. */
  previewFilter: 'all' | 'errors' | 'warnings'
}

// ── Combined store ────────────────────────────────────────────────────────────

export interface AppStore {
  // Source
  source: SourceState
  setSourceFile: (filePath: string | null, fileName: string | null) => void
  setParseResult: (result: ParseResult) => void
  setParseError: (error: string | null) => void
  setIsParsing: (isParsing: boolean) => void
  clearSource: () => void

  // Profile
  profileState: ProfileState
  setProfile: (profile: Profile, profilePath: string | null) => void
  setProfileError: (error: string | null) => void
  markProfileDirty: () => void
  clearProfile: () => void

  // Result
  result: ResultState
  setTransformResult: (result: TransformResult) => void
  setIsTransforming: (isTransforming: boolean) => void
  setTransformProgress: (progress: number) => void
  setTransformError: (error: string | null) => void
  clearResult: () => void

  // UI
  ui: UiState
  setCurrentStep: (step: AppStep) => void
  setIsLoading: (isLoading: boolean) => void
  setGlobalError: (error: string | null) => void
  setSelectedRowIndex: (index: number | null) => void
  setPreviewFilter: (filter: UiState['previewFilter']) => void
}

const initialSource: SourceState = {
  filePath: null,
  fileName: null,
  parseResult: null,
  isParsing: false,
  parseError: null,
}

const initialProfileState: ProfileState = {
  profile: null,
  profilePath: null,
  isDirty: false,
  profileError: null,
}

const initialResult: ResultState = {
  transformResult: null,
  isTransforming: false,
  transformProgress: 0,
  transformError: null,
}

const initialUi: UiState = {
  currentStep: 'load-source',
  isLoading: false,
  globalError: null,
  selectedRowIndex: null,
  previewFilter: 'all',
}

export const useAppStore = create<AppStore>()(
  devtools(
    (set) => ({
      // ── Source ──────────────────────────────────────────────────────────────
      source: initialSource,

      setSourceFile: (filePath, fileName) =>
        set(state => ({
          source: { ...state.source, filePath, fileName, parseError: null },
        })),

      setParseResult: (result) =>
        set(state => ({
          source: { ...state.source, parseResult: result, isParsing: false, parseError: null },
        })),

      setParseError: (error) =>
        set(state => ({
          source: { ...state.source, parseError: error, isParsing: false },
        })),

      setIsParsing: (isParsing) =>
        set(state => ({
          source: { ...state.source, isParsing },
        })),

      clearSource: () =>
        set({ source: initialSource }),

      // ── Profile ─────────────────────────────────────────────────────────────
      profileState: initialProfileState,

      setProfile: (profile, profilePath) =>
        set({
          profileState: {
            profile,
            profilePath,
            isDirty: false,
            profileError: null,
          },
        }),

      setProfileError: (error) =>
        set(state => ({
          profileState: { ...state.profileState, profileError: error },
        })),

      markProfileDirty: () =>
        set(state => ({
          profileState: { ...state.profileState, isDirty: true },
        })),

      clearProfile: () =>
        set({ profileState: initialProfileState }),

      // ── Result ───────────────────────────────────────────────────────────────
      result: initialResult,

      setTransformResult: (result) =>
        set({
          result: {
            transformResult: result,
            isTransforming: false,
            transformProgress: 100,
            transformError: null,
          },
        }),

      setIsTransforming: (isTransforming) =>
        set(state => ({
          result: { ...state.result, isTransforming },
        })),

      setTransformProgress: (progress) =>
        set(state => ({
          result: { ...state.result, transformProgress: progress },
        })),

      setTransformError: (error) =>
        set(state => ({
          result: { ...state.result, transformError: error, isTransforming: false },
        })),

      clearResult: () =>
        set({ result: initialResult }),

      // ── UI ───────────────────────────────────────────────────────────────────
      ui: initialUi,

      setCurrentStep: (step) =>
        set(state => ({ ui: { ...state.ui, currentStep: step } })),

      setIsLoading: (isLoading) =>
        set(state => ({ ui: { ...state.ui, isLoading } })),

      setGlobalError: (error) =>
        set(state => ({ ui: { ...state.ui, globalError: error } })),

      setSelectedRowIndex: (index) =>
        set(state => ({ ui: { ...state.ui, selectedRowIndex: index } })),

      setPreviewFilter: (filter) =>
        set(state => ({ ui: { ...state.ui, previewFilter: filter } })),
    }),
    { name: 'SF2WD' },
  ),
)
