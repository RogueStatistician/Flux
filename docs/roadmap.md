# Flux — Implementation Roadmap

This document breaks the full Flux vision into phased milestones with granular tasks. The codebase is a **clean slate**: new Electron + React + Vite + SQLite project.

Each phase produces a usable increment of the product.

---

## Phase 0 — Project Scaffold

> Goal: Running Electron app with React, Tailwind, SQLite, React Flow wired up. No features, but the full technical stack is proven.

- [ ] Initialise new project: `npm create vite@latest flux -- --template react-ts`
- [ ] Add and configure Electron (electron, electron-builder, concurrently, wait-on)
- [ ] Configure Vite for Electron (base path, output dir)
- [ ] Add Tailwind CSS + PostCSS config
- [ ] Add better-sqlite3 + @types/better-sqlite3 (native module, needs electron-rebuild)
- [ ] Add React Flow (@xyflow/react)
- [ ] Add Zod, Zustand, nanoid, SheetJS (xlsx)
- [ ] Set up TypeScript path aliases (`@/` → `src/`)
- [ ] Set up contextBridge preload pattern (typed IPC bridge)
- [ ] Create `electron/db.ts` — opens/creates SQLite file, runs migrations, exposes typed query helpers
- [ ] Create `electron/schema.sql` — full DDL (see architecture §5)
- [ ] Create `electron/migrate.ts` — schema version table (`_meta`) + migration runner
- [ ] Wire up basic main/renderer communication: ping/pong IPC to verify stack
- [ ] Verify: `npm run dev` opens Electron window with React content
- [ ] Set up ESLint + Prettier
- [ ] Configure electron-builder for macOS, Windows, Linux targets

---

## Phase 1 — Project Management

> Goal: Users can create, open, and close projects. HomeScreen shows recent projects.

### IPC channels
- [ ] `project:create(name, description?, client?)` → creates `.flux` SQLite file at user-chosen path, inserts project row, returns `ProjectMeta`
- [ ] `project:open(filePath)` → opens existing `.flux` file, returns `ProjectMeta`
- [ ] `project:close()` → closes DB connection
- [ ] `project:update(fields)` → update project name/description/client
- [ ] `project:delete()` → delete the `.flux` file after close

### Store
- [ ] `projectStore` — `currentProject: ProjectMeta | null`, `openProject`, `closeProject`
- [ ] Persist recent files list in Electron `app.getPath('userData')/recents.json`

### UI
- [ ] `HomeScreen` — hero + two actions: "New Project", "Open Project"
- [ ] Recent projects list (last 10, sorted by last opened; click to re-open)
- [ ] New project flow: name input → save dialog → project opens
- [ ] Project title bar in workspace header (editable inline)
- [ ] Close project button → returns to HomeScreen
- [ ] Delete project confirmation dialog

---

## Phase 2 — Project Workspace Shell

> Goal: Empty project workspace with sidebar navigation. Each section shows an empty state placeholder.

- [ ] `ProjectWorkspace` layout: fixed sidebar + main content area
- [ ] Sidebar nav: Sources · Targets · Picklists · Picklist Mappings · Transformations · Runs
- [ ] Active section highlighted in sidebar
- [ ] Section views: `SourcesView`, `TargetsView`, `PicklistsView`, `PLMappingsView`, `TransformationsView`, `RunsView` — all show empty state placeholders for now
- [ ] Responsive layout (min-width: 1024px enforced)

---

## Phase 3 — Data Objects: Sources

> Goal: Users can upload Excel/CSV files, review inferred schema, and save source objects.

### Engine
- [ ] `electron/importer.ts` — reads Excel/CSV with SheetJS:
  - `parseFileHeaders(filePath)` → `string[]`
  - `parseFileRows(filePath, limit?)` → `Record<string, string>[]`
  - `inferSchema(rows, headers)` → `InferredField[]` (name, detectedType, sampleValues, picklistCandidate flag)
- [ ] Type inference logic (see architecture §9)
- [ ] `objects:import(objectId, filePath)` — stores rows into `source_rows` table; updates `row_count`

### IPC channels
- [ ] `objects:create(role, name, ...)` → insert into `data_objects`, return object
- [ ] `objects:list(role?)` → list objects for current project
- [ ] `objects:get(id)` → full object with fields
- [ ] `objects:update(id, fields)` → update metadata
- [ ] `objects:delete(id)` → cascade delete fields + rows
- [ ] `objects:import(id, filePath)` → parse + store rows, return row count
- [ ] `objects:getRows(id, offset, limit)` → paginated source data
- [ ] `fields:upsert(objectId, fields[])` → bulk replace schema fields
- [ ] `fields:reorder(objectId, orderedIds[])` → update position values

### UI
- [ ] `SourcesView` — card grid + "Upload file" + "Bulk upload" buttons
- [ ] `ObjectCard` — shows name, system badge, row count, field count, last updated
- [ ] Bulk upload drop zone (multiple file drag-and-drop)
- [ ] `ImportWizard` overlay:
  - Step 1: File selected → show inferred schema preview (editable table: name, display name, type, required toggle)
  - Step 2: Object metadata (name, description, system name)
  - Step 3: Confirm + import (progress indicator for large files)
- [ ] `ObjectDetailOverlay` — full-screen slide-over:
  - Schema editor: field table with inline type/name/required edits, drag-to-reorder, add/delete field
  - Data preview: paginated table (first 200 rows, virtual scroll for large sets)
  - Re-import button (keep schema, replace data)
  - Metadata edit section
- [ ] Delete object with inline confirmation on card

---

## Phase 4 — Data Objects: Targets

> Goal: Users can define target objects either by uploading a template Excel (headers only) or by building the schema manually.

*Most infrastructure is shared with Phase 3. Target objects have no data rows — schema only.*

### IPC channels
- [ ] `objects:importTemplate(id, filePath)` → read headers only, infer schema, return without storing rows

### UI
- [ ] `TargetsView` — same card structure as SourcesView
- [ ] `TargetImportWizard`:
  - Option A: Upload Excel template → extract header row → show schema editor
  - Option B: "Define manually" → start with empty schema editor
- [ ] `ObjectDetailOverlay` (shared with Phase 3, but hides data preview for targets)
- [ ] Output format selector per target (Excel / CSV) — stored on `data_objects`

---

## Phase 5 — Picklists

> Goal: Users can create and manage source and target picklists, and upload them from Excel.

### IPC channels
- [ ] `picklists:create(side, name, description?)` → insert, return picklist
- [ ] `picklists:list(side?)` → list for current project
- [ ] `picklists:get(id)` → picklist + values
- [ ] `picklists:update(id, fields)` → rename / redescribe
- [ ] `picklists:delete(id)` → cascade delete values
- [ ] `picklists:setValues(id, values[])` → bulk replace key-value pairs
- [ ] `picklists:importFromFile(id, filePath, keyCol, labelCol)` → parse Excel/CSV, store values

### UI
- [ ] `PicklistsView` — two columns: Source Picklists | Target Picklists
- [ ] `PicklistCard` — name, value count, side badge
- [ ] `PicklistDetailOverlay`:
  - Key-value table (inline editable)
  - Add row / delete row
  - Import from Excel button → column picker (which col is key, which is label)
  - Bulk upload drop zone
- [ ] New picklist dialog (name + side)

---

## Phase 6 — Picklist Mappings

> Goal: Users can map source picklist values to target picklist values.

### IPC channels
- [ ] `plmappings:create(name, sourcePLId, targetPLId)` → insert, return mapping
- [ ] `plmappings:list()` → list for current project
- [ ] `plmappings:get(id)` → mapping + entries
- [ ] `plmappings:update(id, fields)` → rename
- [ ] `plmappings:delete(id)` → cascade delete entries
- [ ] `plmappings:setEntries(id, entries[])` → bulk replace source→target key pairs
- [ ] `plmappings:importFromFile(id, filePath, sourceCol, targetCol)` → parse + store

### UI
- [ ] `PLMappingsView` — mapping cards
- [ ] `MappingCard` — name, source PL name ↔ target PL name, entry count
- [ ] `MappingEditorOverlay`:
  - Source picklist selector + target picklist selector (at top)
  - Two-column table: source key (with label) | target key (dropdown from target PL values)
  - Auto-fill: exact key match button
  - Import from Excel (source col + target col picker)
  - Unmapped source keys highlighted

---

## Phase 7 — Transformation Editor (Visual Canvas)

> Goal: Users can create transformation definitions and visually map fields between source and target objects using a React Flow canvas.

### IPC channels
- [ ] `transformations:create(name, description?)` → insert, return
- [ ] `transformations:list()` → list for current project
- [ ] `transformations:get(id)` → transformation + canvas state + field mappings
- [ ] `transformations:update(id, fields)` → rename / redescribe
- [ ] `transformations:saveCanvas(id, canvasState)` → persist React Flow JSON
- [ ] `transformations:delete(id)` → cascade
- [ ] `transformations:upsertFieldMapping(transformationId, targetObjectId, targetFieldId, ruleType, ruleConfig)` → insert or replace
- [ ] `transformations:deleteFieldMapping(id)` → delete one rule
- [ ] `transformations:getFieldMappings(transformationId)` → all rules

### React Flow custom nodes
- [ ] `SourceObjectNode` — header with object name/system, scrollable field list, right-side handles per field
- [ ] `TargetObjectNode` — header, scrollable field list with mapping status icons, left-side handles per field
- [ ] `JoinNode` — two input handles, join-type selector (inner/left), join-key field pickers, one output handle
- [ ] Custom edge renderer — solid (Direct) vs dashed (rule-configured)

### Rule Config Panel (slide-in sidebar when edge selected)
- [ ] Rule type selector (Direct, Constant, Concat, Split, Substring, DateFormat, Picklist Translate, Lookup, UUID, Incremental, Expression)
- [ ] Conditional form fields per rule type:
  - **Direct**: source field (auto-set from edge) — no config needed
  - **Constant**: value text input
  - **Concat**: list of parts (drag-reorder) — each part is source field or literal string
  - **Split**: source field, delimiter, index
  - **Substring**: source field, start index, optional length
  - **DateFormat**: source field, input format, output format (presets dropdown)
  - **Picklist Translate**: source field, picklist mapping selector, fallback value
  - **Lookup**: join object selector, join key (source + lookup), output field
  - **UUID**: no config
  - **Incremental**: start value, step
  - **Expression**: textarea with field name tokens, safe evaluator

### Canvas interactions
- [ ] Left dock: draggable source object tiles
- [ ] Right dock: draggable target object tiles
- [ ] Drag object from dock → creates node on canvas at drop position
- [ ] Draw edge: drag from source field handle → target field handle → auto-creates Direct rule
- [ ] Click edge → opens Rule Config panel
- [ ] Delete edge → removes rule
- [ ] "Auto-map" button → match source and target fields by name (exact then fuzzy) → create Direct rules for matched pairs
- [ ] Node collapse/expand toggle (show/hide field list)
- [ ] Mini-map + zoom controls (React Flow built-in)
- [ ] Canvas state auto-saved on change (debounced 500ms)

### UI
- [ ] `TransformationsView` — transformation cards
- [ ] `TransformationCard` — name, source→target object names, last run date + status
- [ ] `TransformationEditor` — full-screen layout:
  - Top bar: name, breadcrumb back, Run button
  - Left dock (200px): source objects list
  - Right dock (200px): target objects list
  - Canvas: React Flow instance
  - Rule Config panel: slides in from right (300px) on edge select

---

## Phase 8 — Run Engine & Output

> Goal: Execute a transformation, see live progress, download output files.

### Engine (`electron/engine.ts`)
- [ ] `executeTransformation(transformationId)`:
  - Load all field mappings for transformation
  - Group by target object
  - For each target object:
    - Fetch source rows (with join resolution if JoinNode present)
    - For each row: apply each rule → build output row
    - Validate against target schema (type coercion, required check)
    - Collect issues
  - Write output files (SheetJS for Excel, plain text for CSV)
  - Store run record + issues in DB
  - Emit progress events via IPC throughout

### Rule applicators (one function per rule type)
- [ ] `applyDirect`
- [ ] `applyConstant`
- [ ] `applyConcat`
- [ ] `applySplit`
- [ ] `applySubstring`
- [ ] `applyDateFormat`
- [ ] `applyPicklistTranslate` (loads picklist mapping into a Map at run start)
- [ ] `applyLookup` (loads lookup object rows into a Map keyed by join field at run start)
- [ ] `applyUUID`
- [ ] `applyIncremental`
- [ ] `applyExpression` (sandboxed via `new Function` or similar)

### IPC channels
- [ ] `run:start(transformationId)` → begins async execution, returns runId
- [ ] `run:getProgress(runId)` → `{ status, rowsDone, rowsTotal, currentTarget }`
- [ ] `run:cancel(runId)` → graceful abort
- [ ] `run:list(transformationId?)` → run history
- [ ] `run:get(runId)` → full run record with stats and issues
- [ ] `run:getIssues(runId, severity?)` → paginated issues
- [ ] `export:saveOutput(runId, targetObjectId, filePath)` → copy output file to user-chosen location

### UI
- [ ] `RunsView`:
  - Transformation selector dropdown
  - "Run" button with loading state
  - Live progress bar (row count + current target name)
  - Cancel button during run
  - Run history list: date, transformation name, status badge, stats summary
  - Run detail: issues table (row, field, severity, message); download buttons per target

---

## Phase 9 — Polish & Reliability

> Goal: Production-ready build, error boundaries, UX refinements.

- [ ] Global error boundary (catches React crashes, shows friendly error + report option)
- [ ] Empty state illustrations for all views
- [ ] Keyboard shortcuts: `Cmd/Ctrl+S` save, `Cmd/Ctrl+Z` undo (canvas), `Escape` close overlay
- [ ] Undo/redo for canvas changes (React Flow history)
- [ ] Search/filter on all list views (objects, picklists, mappings, transformations)
- [ ] Drag-and-drop reorder for fields in schema editor
- [ ] Tooltip explanations on rule types
- [ ] Accessible: ARIA labels, keyboard-navigable overlays
- [ ] electron-builder packaging for macOS (DMG), Windows (NSIS installer), Linux (AppImage)
- [ ] Auto-updater (electron-updater)
- [ ] Application menu (File, Edit, View, Help)
- [ ] Splash screen on load
- [ ] About dialog with version info

---

## Phase 10 — Aided Mapping (Future)

- [ ] Name-similarity auto-map (Jaro-Winkler or similar)
- [ ] Saved mapping templates: export/import transformation definitions as `.fluxtemplate` JSON
- [ ] Bundled starter templates for common system pairs (e.g. SAP SF EC → Workday EIB)
- [ ] "Suggest mapping" button powered by LLM (optional, user-configured API key)

---

## Summary: Phase Dependencies

```
Phase 0 (Scaffold)
    └─ Phase 1 (Projects)
           └─ Phase 2 (Workspace Shell)
                  ├─ Phase 3 (Sources)
                  ├─ Phase 4 (Targets)        ← depends on Phase 3 infrastructure
                  ├─ Phase 5 (Picklists)
                  │      └─ Phase 6 (PL Mappings)
                  └─ Phase 7 (Transformation Editor)  ← depends on Phase 3 + 4
                         └─ Phase 8 (Run Engine)       ← depends on Phase 5 + 6 + 7
                                └─ Phase 9 (Polish)
```

Phases 3 and 4 share the same `ObjectDetailOverlay` and schema editor — build them together.
Phases 5 and 6 are self-contained and can run in parallel with Phase 7.
