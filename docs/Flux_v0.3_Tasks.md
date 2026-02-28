# Flux v0.3 — Task Breakdown

|||
|:----|:----|
|**Status:**| DRAFT |
|**Date:**| February 2026 |
|**Ref:**| Flux_Architecture_Proposal.md |

This document breaks down the v0.3 scope into concrete development tasks. Tasks are grouped by theme and ordered within each group by dependency. Effort is rough (S = half-day, M = 1–2 days, L = 3–5 days).

---

## Theme 1 — Rebrand to Flux

Low effort, no logic changes. Do this first so everything downstream uses the new name.

| # | Task | Files | Effort |
|---|---|---|---|
| 1.1 | Update `package.json`: set `name`, `productName`, `appId`, `description` | `package.json` | S |
| 1.2 | Update app header title and subtitle in the UI | `src/App.tsx` | S |
| 1.3 | Rename `__SF2WD_Errors` column to `__FLUX_Errors` in export | `src/export/eib.ts` | S |
| 1.4 | Rename exported file prefixes (`Flux_Quality_Summary_...`, `Flux_EIB_...`) | `src/export/eib.ts` | S |
| 1.5 | Update Electron `appId` and window title in main process | `electron/main.ts` | S |
| 1.6 | Update all in-code comments and strings that reference "SF2WD" | all `src/` files | S |

---

## Theme 2 — Profile Management UX

Replace the JSON-paste `ConfigureMappingStep` with a proper profile selection screen. The `PresetBuilder` already exists — it just needs to be integrated into the workflow.

| # | Task | Files | Effort |
|---|---|---|---|
| 2.1 | Create `ProfileSelectionScreen` component with three option cards (Built-in / Load file / Create new) | `src/components/steps/ProfileSelectionScreen.tsx` *(new)* | M |
| 2.2 | Replace `ConfigureMappingStep` content with `ProfileSelectionScreen` | `src/components/steps/ConfigureMappingStep.tsx` | S |
| 2.3 | Wire "Load from file" card to OS file picker (JSON only); reuse existing Zod validation | `ConfigureMappingStep.tsx`, `electron/main.ts` | S |
| 2.4 | Wire "Built-in profiles" card to list bundled profiles from `profiles/` directory grouped by direction | `ConfigureMappingStep.tsx`, `electron/main.ts` | M |
| 2.5 | Wire "Create new profile" card to open `PresetBuilder` as a sub-view within the step (not a separate app mode) | `src/App.tsx`, `ConfigureMappingStep.tsx` | M |
| 2.6 | Remove the `appMode` toggle from the app header (PresetBuilder is no longer a top-level mode) | `src/App.tsx`, `src/components/StepNav.tsx` | S |
| 2.7 | Persist recently used profiles list via `electron-store`; show in Profile Selection screen | `src/store/index.ts`, `ProfileSelectionScreen.tsx` | S |
| 2.8 | Update Zustand `UiState`: remove `appMode` slice, add `profileSelectionVisible` flag if needed | `src/store/index.ts` | S |

---

## Theme 3 — Generic Connectors (make PresetBuilder system-agnostic)

Remove the hardcoded `SF_FIELDS` / `WD_FIELDS` arrays from `PresetBuilder`. Field lists come from Connector (template) JSON files instead.

| # | Task | Files | Effort |
|---|---|---|---|
| 3.1 | Define `ConnectorSchema` (Zod): `id`, `name`, `system`, `direction`, `fields[]` (name, type, required, description, picklist) | `src/engine/schema.ts` | S |
| 3.2 | Write a `loadConnector(system, template)` utility that reads the matching JSON file from `templates/` | `src/engine/connectorLoader.ts` *(new)* | S |
| 3.3 | Update `PresetBuilder` to accept `sourceConnector` and `targetConnector` props instead of using hardcoded arrays | `src/components/PresetBuilder/index.tsx` | M |
| 3.4 | Add a Connector picker at the top of `PresetBuilder` (select source system/template, select target system/template) | `src/components/PresetBuilder/index.tsx` | M |
| 3.5 | Add IPC handler in main process to enumerate all JSON files under `templates/` at runtime | `electron/main.ts`, `src/electron.d.ts` | S |
| 3.6 | Update existing template JSON files (`ec-employee-export.json`, `eib-worker.json`) to conform to the new `ConnectorSchema` if not already compatible | `templates/**/*.json` | S |
| 3.7 | *(Optional v0.3)* Allow users to register a custom Connector by importing a JSON file; store in user's app data directory | `electron/main.ts`, `ProfileSelectionScreen.tsx` | M |

---

## Theme 4 — Project Entity

Introduce the `Project` entity that groups multiple Transformations for one client engagement.

| # | Task | Files | Effort |
|---|---|---|---|
| 4.1 | Define `ProjectSchema` (Zod): `projectId`, `name`, `description`, `client`, `createdAt`, `updatedAt`, `transformations[]` (`id`, `name`, `transformationRef`, `lastSourceFile?`) | `src/engine/schema.ts` | S |
| 4.2 | Add `ProjectState` slice to Zustand store: `currentProject`, `setProject`, `addTransformation`, `updateTransformationStatus` | `src/store/index.ts` | M |
| 4.3 | Create `ProjectDashboard` component: table of Transformations with status column, source file column, and action buttons (Load file / Run / Export) | `src/components/ProjectDashboard/index.tsx` *(new)* | L |
| 4.4 | Add IPC handlers for project file I/O: `openProject` (reads `.flux` JSON), `saveProject`, `saveProjectAs` | `electron/main.ts`, `src/electron.d.ts` | M |
| 4.5 | Create `HomeScreen` component: entry point with three options — Open Project, New Project, Quick Start (no project) | `src/components/HomeScreen.tsx` *(new)* | M |
| 4.6 | Update app routing in `App.tsx` to handle Home → Project Dashboard → per-transformation wizard flow | `src/App.tsx` | M |
| 4.7 | Add "Back to project" navigation in `StepNav` when a transformation is opened from within a Project | `src/components/StepNav.tsx` | S |
| 4.8 | Persist `lastSourceFile` per transformation in the project file after each successful load | `src/store/index.ts`, `ProjectDashboard` | S |
| 4.9 | *(Optional v0.3)* "Run all" button: execute all transformations in the project sequentially, collect aggregate status | `ProjectDashboard`, `src/store/index.ts` | L |
| 4.10 | *(Optional v0.3)* "Export all" button: export all transformations with completed results to a chosen output folder | `ProjectDashboard`, `src/export/eib.ts` | M |

---

## Theme 5 — Testing & Cleanup

| # | Task | Files | Effort |
|---|---|---|---|
| 5.1 | Update unit tests: rename all `SF2WD` references, update export column name assertions | `src/__tests__/engine.test.ts` | S |
| 5.2 | Add unit tests for `ConnectorSchema` and `loadConnector` utility | `src/__tests__/connector.test.ts` *(new)* | S |
| 5.3 | Add unit tests for `ProjectSchema` | `src/__tests__/project.test.ts` *(new)* | S |
| 5.4 | Component tests for `ProfileSelectionScreen` (all three cards render, file load path, built-in list) | `src/__tests__/ProfileSelectionScreen.test.tsx` *(new)* | M |
| 5.5 | Component tests for `ProjectDashboard` (transformation list, status display, action buttons) | `src/__tests__/ProjectDashboard.test.tsx` *(new)* | M |
| 5.6 | Update CI workflow: update any hardcoded `SF2WD` references in workflow files | `.github/workflows/**` | S |

---

## Dependency Graph

```
1.x Rebrand
  └─→ (unblocks) 2.x, 3.x, 4.x (clean naming throughout)

2.1 ProfileSelectionScreen
  ├─→ 2.2 Replace ConfigureMappingStep content
  ├─→ 2.3 Load from file
  ├─→ 2.4 Built-in profiles list
  ├─→ 2.5 Open PresetBuilder as sub-view
  └─→ 2.6 Remove appMode toggle

3.1 ConnectorSchema
  └─→ 3.2 loadConnector utility
        └─→ 3.3 PresetBuilder accepts connector props
              └─→ 3.4 Connector picker in PresetBuilder

4.1 ProjectSchema
  └─→ 4.2 ProjectState in Zustand
        ├─→ 4.3 ProjectDashboard component
        ├─→ 4.4 Project file I/O (IPC)
        └─→ 4.5 HomeScreen
              └─→ 4.6 App routing update
                    └─→ 4.7 StepNav back navigation
```

---

## Suggested Sprint Order

| Sprint | Themes | Goal |
|---|---|---|
| Sprint 1 | 1.x + 2.1–2.6 | App runs under Flux name; non-technical users can load profiles without touching JSON |
| Sprint 2 | 3.1–3.6 + 2.7–2.8 | PresetBuilder is fully generic; built-in profile list and recent profiles work |
| Sprint 3 | 4.1–4.8 | Project entity exists; Project Dashboard functional; single-transformation flow works within a project |
| Sprint 4 | 4.9–4.10 + 5.x | Batch run/export; full test coverage; CI updated |

---

*Flux v0.3 Task Breakdown | February 2026 | Draft*
