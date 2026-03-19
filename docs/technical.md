# Flux — Technical Documentation

## Overview

Flux is an Electron desktop application (with an optional Express web server mode) for ETL data migrations. It is built with React + TypeScript on the renderer side, better-sqlite3 in the main process for persistence, React Flow for the visual transformation canvas, and SheetJS/ExcelJS for Excel I/O.

---

## Repository Structure

```
Flux/
├── core/                   # Platform-agnostic business logic
│   ├── db.ts               # SQLite schema, migrations, connection management
│   ├── engine.ts           # Transformation execution engine
│   ├── importer.ts         # File parsing and schema inference
│   └── services/           # Domain service layer
│       ├── project.ts
│       ├── objects.ts
│       ├── picklists.ts
│       ├── plmappings.ts
│       ├── transformations.ts
│       └── runs.ts
├── electron/               # Electron main process
│   ├── main.ts             # App entry point, window creation
│   ├── preload.ts          # contextBridge IPC exposure
│   ├── engine.ts           # Re-export of core/engine.ts
│   └── ipc/                # IPC handler registration (thin wrappers)
│       ├── project.ts
│       ├── objects.ts
│       ├── picklists.ts
│       ├── plmappings.ts
│       ├── transformations.ts
│       ├── runs.ts
│       └── dialog.ts
├── src/                    # React renderer
│   ├── main.tsx            # React root
│   ├── App.tsx             # Top-level view router
│   ├── electron.d.ts       # window.electronAPI type declarations
│   ├── types/              # Shared TypeScript interfaces
│   ├── store/              # Zustand state stores
│   ├── platform/           # IPlatform abstraction (Electron vs Web)
│   └── components/
│       ├── HomeScreen/
│       ├── ProjectWorkspace/
│       └── workspace/
│           ├── SourcesView/
│           ├── TargetsView/
│           ├── PicklistsView/
│           ├── PLMappingsView/
│           ├── TransformationsView/
│           ├── RunsView/
│           ├── TransformationEditor/
│           ├── ImportWizard.tsx
│           ├── ObjectDetailOverlay.tsx
│           ├── PicklistDetailOverlay.tsx
│           └── MappingEditorOverlay.tsx
├── web-server/             # Express alternative to Electron
│   ├── server.ts
│   ├── sse.ts              # Server-sent events for run progress
│   └── routes/
├── docs/
├── samples/
├── vite.config.ts
├── tsconfig.json
├── tsconfig.electron.json
└── package.json
```

---

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Desktop shell | Electron | 35.x |
| UI framework | React | 18.3 |
| Build tool | Vite + vite-plugin-electron | 6.x |
| Language | TypeScript | 5.5 |
| Styling | Tailwind CSS | 3.4 |
| Database | better-sqlite3 | 11.x |
| Visual editor | @xyflow/react | 12.3 |
| Excel I/O | ExcelJS | 4.4 |
| CSV parsing | csv-parse | 6.1 |
| State management | Zustand | 4.5 |
| Validation | Zod | 3.23 |
| Web server (alt) | Express | 5.x |

---

## Architecture

### Process Boundary

Flux follows strict Electron process separation:

- **Main process** (`electron/main.ts`, `core/`): Owns the SQLite database, filesystem access, and the run engine. All I/O goes through here.
- **Renderer process** (`src/`): React UI. Never touches the filesystem or database directly.
- **Preload** (`electron/preload.ts`): Compiled to CJS via esbuild (required for `contextBridge`). Exposes `window.electronAPI` as the sole communication channel.

```
Renderer (React)
  └─ window.electronAPI  (contextBridge, CJS preload)
        └─ ipcRenderer.invoke / ipcRenderer.on
              └─ ipcMain.handle  (electron/ipc/*.ts)
                    └─ core/services/*.ts
                          └─ core/db.ts  (better-sqlite3, synchronous)
```

### Platform Abstraction

`src/platform/` defines an `IPlatform` interface that the React components call. Two implementations exist:

- `ElectronPlatform.ts` — delegates to `window.electronAPI`
- `WebPlatform.ts` — delegates to the Express REST API via `fetch`

This allows the same React codebase to run in both Electron and a browser pointed at the web server.

### State Management

Zustand stores in `src/store/`:

- `appStore` — current view (`home` | `workspace`), current project metadata
- `workspaceStore` — active section, open overlays, selection state

Stores are thin; most data is fetched from the backend on demand and held in component state.

---

## Database

### Connection Management (`core/db.ts`)

One SQLite database per `.flux` project file. The connection is managed as a module-level singleton in `core/db.ts`. Functions:

- `openDatabase(filePath)` — opens (or creates) the file, runs migrations
- `closeDatabase()` — closes the connection
- `getDb()` — returns the active connection (throws if none open)

The migration system uses a `_meta` table with a single `schema_version` integer row. Each version bump runs a DDL block inside a transaction.

### Schema

#### `projects`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| name | TEXT | |
| description | TEXT | |
| created_at | TEXT | ISO-8601 |
| updated_at | TEXT | |

#### `data_objects`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| project_id | TEXT FK | |
| role | TEXT | `'source'` or `'target'` |
| name | TEXT | |
| description | TEXT | |
| file_path | TEXT | Original upload path |
| template_file_path | TEXT | For targets |
| template_header_row | INTEGER | 1-based |
| template_data_start_row | INTEGER | 1-based |
| template_skip_columns | INTEGER | Columns to skip from left |
| created_at / updated_at | TEXT | |

#### `object_fields`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| object_id | TEXT FK | |
| name | TEXT | |
| display_order | INTEGER | |
| field_type | TEXT | `'string'`, `'number'`, `'date'`, `'boolean'` |
| is_required | INTEGER | 0/1 |
| is_key | INTEGER | 0/1 |
| picklist_id | TEXT FK | Optional, links to a picklist |
| description | TEXT | Shown as tooltip in canvas |

#### `source_rows`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| object_id | TEXT FK | |
| row_index | INTEGER | 0-based |
| data | TEXT | JSON blob of the row |

#### `picklists`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| project_id | TEXT FK | |
| role | TEXT | `'source'` or `'target'` |
| name | TEXT | |

#### `picklist_values`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| picklist_id | TEXT FK | |
| key | TEXT | The coded value |
| label | TEXT | Human-readable label |
| display_order | INTEGER | |

#### `picklist_mappings`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| project_id | TEXT FK | |
| name | TEXT | |
| source_picklist_id | TEXT FK | |
| target_picklist_id | TEXT FK | |

#### `picklist_mapping_entries`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| mapping_id | TEXT FK | |
| source_key | TEXT | |
| target_key | TEXT | |

#### `transformations`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| project_id | TEXT FK | |
| name | TEXT | |
| canvas_state | TEXT | React Flow JSON blob |

#### `field_mappings`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| transformation_id | TEXT FK | |
| target_object_id | TEXT FK | |
| target_field_id | TEXT FK | |
| map_node_id | TEXT | React Flow node ID of the MapOperator |
| rule_type | TEXT | See rule types below |
| rule_config | TEXT | JSON blob, shape varies by rule_type |

#### `runs`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| transformation_id | TEXT FK | |
| status | TEXT | `'running'`, `'complete'`, `'error'`, `'cancelled'` |
| started_at / finished_at | TEXT | |
| total_rows | INTEGER | |
| rows_done | INTEGER | |
| error_count / warning_count | INTEGER | |
| output_manifest | TEXT | JSON: `{ targetObjectId: filePath }` |

#### `run_issues`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| run_id | TEXT FK | |
| row_index | INTEGER | |
| target_object_id | TEXT FK | |
| field_name | TEXT | |
| severity | TEXT | `'warning'` or `'error'` |
| message | TEXT | |

### Schema Migrations

Migrations run at `openDatabase()` time. Each migration is a function that receives the `db` instance and executes DDL inside a transaction. The `_meta.schema_version` integer is incremented after each successful migration.

Current version history:
- **v0 → v1**: Initial full schema
- **v1 → v2**: Add `description` column to `object_fields`
- **v2 → v3**: Add `template_header_row`, `template_skip_columns`, `template_file_path` to `data_objects`
- **v3 → v4**: Add `template_data_start_row` to `data_objects`
- **v4 → v5**: Add `map_node_id` to `field_mappings`

---

## IPC Layer

### Registration

Each IPC module in `electron/ipc/` exports a `register(ipcMain)` function. `electron/main.ts` calls all of them on `app.ready`.

### Channel Naming

Channels follow the pattern `domain:action`, e.g. `objects:create`, `run:start`.

### Full Channel Reference

#### `project:*`
| Channel | Args | Returns |
|---------|------|---------|
| `project:create` | `{ filePath, name, description }` | `Project` |
| `project:open` | `filePath: string` | `Project` |
| `project:get` | — | `Project` |
| `project:update` | `Partial<Project>` | `Project` |
| `project:close` | — | void |
| `project:listRecent` | — | `RecentProject[]` |
| `project:delete` | `filePath: string` | void |

#### `objects:*`
| Channel | Args | Returns |
|---------|------|---------|
| `objects:list` | `{ role? }` | `DataObject[]` |
| `objects:get` | `id: string` | `DataObject` |
| `objects:create` | `{ role, name, description, filePath?, ... }` | `DataObject` |
| `objects:update` | `{ id, ...fields }` | `DataObject` |
| `objects:delete` | `id: string` | void |
| `objects:inferSchema` | `{ filePath, options? }` | `InferredField[]` |
| `objects:importRows` | `{ id, filePath, options? }` | `{ count: number }` |
| `objects:getRows` | `{ id, offset, limit }` | `{ rows, total }` |

#### `fields:*`
| Channel | Args | Returns |
|---------|------|---------|
| `fields:list` | `objectId: string` | `ObjectField[]` |
| `fields:upsertBulk` | `{ objectId, fields }` | `ObjectField[]` |
| `fields:delete` | `id: string` | void |

#### `picklists:*`
| Channel | Args | Returns |
|---------|------|---------|
| `picklists:list` | `{ role? }` | `Picklist[]` |
| `picklists:get` | `id: string` | `Picklist` |
| `picklists:create` | `{ role, name }` | `Picklist` |
| `picklists:update` | `{ id, name }` | `Picklist` |
| `picklists:delete` | `id: string` | void |
| `picklists:listValues` | `id: string` | `PicklistValue[]` |
| `picklists:upsertValues` | `{ picklistId, values }` | `PicklistValue[]` |
| `picklists:importValues` | `{ id, filePath }` | `{ count: number }` |

#### `plmappings:*`
| Channel | Args | Returns |
|---------|------|---------|
| `plmappings:list` | — | `PicklistMapping[]` |
| `plmappings:get` | `id: string` | `PicklistMapping` |
| `plmappings:create` | `{ name, sourcePicklistId, targetPicklistId }` | `PicklistMapping` |
| `plmappings:update` | `{ id, ...fields }` | `PicklistMapping` |
| `plmappings:delete` | `id: string` | void |
| `plmappings:listEntries` | `id: string` | `MappingEntry[]` |
| `plmappings:upsertEntries` | `{ mappingId, entries }` | `MappingEntry[]` |

#### `transformations:*`
| Channel | Args | Returns |
|---------|------|---------|
| `transformations:list` | — | `Transformation[]` |
| `transformations:get` | `id: string` | `Transformation` |
| `transformations:create` | `{ name }` | `Transformation` |
| `transformations:update` | `{ id, name }` | `Transformation` |
| `transformations:delete` | `id: string` | void |
| `transformations:saveCanvas` | `{ id, canvasState }` | void |
| `transformations:listMappings` | `transformationId: string` | `FieldMapping[]` |
| `transformations:upsertMapping` | `FieldMapping` | `FieldMapping` |
| `transformations:deleteMapping` | `id: string` | void |

#### `run:*`
| Channel | Args | Returns |
|---------|------|---------|
| `run:start` | `{ transformationId, format? }` | `{ runId: string }` |
| `run:cancel` | `runId: string` | void |
| `run:get` | `runId: string` | `Run` |
| `run:list` | `transformationId: string` | `Run[]` |
| `run:listIssues` | `runId: string` | `RunIssue[]` |
| `run:previewOutput` | `{ runId, targetObjectId }` | `{ rows, fields }` |

#### `export:*`
| Channel | Args | Returns |
|---------|------|---------|
| `export:saveOutput` | `{ runId, targetObjectId, destPath }` | void |

#### `dialog:*`
| Channel | Args | Returns |
|---------|------|---------|
| `dialog:openFile` | `{ filters?, properties? }` | `string \| null` |
| `dialog:saveFile` | `{ defaultName?, filters? }` | `string \| null` |

#### Progress events (main → renderer, one-way)
| Event | Payload |
|-------|---------|
| `run:progress` | `{ runId, rowsDone, totalRows, currentTarget, status }` |

---

## Core Services

### `core/services/objects.ts`

Key functions:
- `insertObject(db, payload)` — creates `data_objects` row + calls `upsertFields`
- `upsertFields(db, objectId, fields)` — replaces all fields for an object in a transaction
- `storeSourceRows(db, objectId, rows)` — deletes existing rows, inserts new batch in a transaction
- `getRows(db, objectId, offset, limit)` — returns paginated rows with JSON-parsed `data`

### `core/importer.ts`

- `parseFile(filePath, options)` — dispatches to `parseExcel` or `parseCsv` based on extension; returns `string[][]` (array of rows as string arrays)
- `inferSchema(rows, headerRow?)` — samples up to 200 data rows; detects field type, flags likely picklist fields by cardinality (≤20 distinct values across ≥10 rows)
- `parseExcel(filePath, options)` — uses ExcelJS; respects `headerRow` and `dataStartRow` offsets, `skipColumns`
- `parseCsv(filePath, options)` — uses csv-parse sync; respects `separator` and `skipHeaderRows`

### `core/engine.ts`

The run engine. Entry point: `executeTransformation(config, onProgress)`.

**Config shape:**
```typescript
{
  db: Database,
  transformationId: string,
  format: 'xlsx' | 'csv',
  outputDir: string,           // temp dir for output files
  cancelToken: { cancelled: boolean }
}
```

**Execution flow:**

1. Load transformation + all field mappings from DB
2. Group field mappings by `(targetObjectId, mapNodeId)` — each group is one output pass
3. For each group:
   a. Determine the upstream source object from canvas state
   b. Load all source rows (resolving any Join operator)
   c. Load all picklist mappings referenced by rules in this group
   d. For each source row:
      - Apply each field rule → collect `outputRow`
      - Validate required fields
      - Record issues
      - `onProgress()` callback after each row
   e. Write output file (Excel or CSV)
4. Persist `runs` record with stats + `output_manifest`
5. Persist `run_issues` in bulk

**Rule applicator functions:**

| Rule type | Function | Config shape |
|-----------|----------|-------------|
| `direct` | `applyDirect` | `{ sourceFieldName: string }` |
| `constant` | `applyConstant` | `{ value: string }` |
| `concat` | `applyConcat` | `{ parts: Array<{ type: 'field'\|'literal', value: string }> }` |
| `split` | `applySplit` | `{ sourceFieldName, delimiter, index: number }` |
| `substring` | `applySubstring` | `{ sourceFieldName, start: number, end?: number }` |
| `dateFormat` | `applyDateFormat` | `{ sourceFieldName, inputFormat, outputFormat }` |
| `picklistTranslate` | `applyPicklistTranslate` | `{ sourceFieldName, mappingId }` |
| `lookup` | `applyLookup` | `{ lookupObjectId, lookupKeyField, lookupValueField, sourceKeyField }` |
| `uuid` | `applyUUID` | `{}` |
| `incremental` | `applyIncremental` | `{ start: number, step: number }` |
| `expression` | `applyExpression` | `{ expression: string }` — evaluated with `new Function('row', 'index', expr)` |

---

## Transformation Editor

### File: `src/components/workspace/TransformationEditor/index.tsx`

The main canvas component. Uses `@xyflow/react`'s `ReactFlow` component with custom node and edge types. Canvas state is serialized to JSON and persisted to the DB via `transformations:saveCanvas` with a 600ms debounce.

### Custom Node Types

| Node type key | Component | Purpose |
|---------------|-----------|---------|
| `sourceObject` | `SourceObjectNode.tsx` | Represents a source data object; field handles on the right |
| `targetObject` | `TargetObjectNode.tsx` | Represents a target data object; field handles on the left |
| `mapOperator` | `MapOperatorNode.tsx` | Hub for field mapping rules; connects sources to one target |
| `joinOperator` | `JoinOperatorNode.tsx` | Joins two sources by key |
| `filterOperator` | `FilterOperatorNode.tsx` | Filters rows by condition |
| `appendOperator` | `AppendOperatorNode.tsx` | Appends / unions row sets |
| `dedupOperator` | `DeduplicateOperatorNode.tsx` | Removes duplicate rows |

Custom node data types must extend `Record<string, unknown>` per `@xyflow/react` v12 requirements. Cast via `data as unknown as YourType` in node components.

### Edge Types

| Edge type | Component | Notes |
|-----------|-----------|-------|
| `pipeline` | `PipelineEdge.tsx` | Purple dashed arrow; used for operator-to-operator connections |
| `fieldMap` | Default React Flow edge | Used for field-level source→rule connections |

### Panels

- `MapPanel.tsx` — Opens when a MapOperator node is selected. Lists all target fields for the connected target object and lets you configure a rule per field. Calls `transformations:upsertMapping` on each rule save.
- `JoinPanel.tsx` — Opens when a JoinOperator node is selected. Configure join type (inner/left) and the key fields from each upstream source.
- `FilterPanel.tsx` — Opens when a FilterOperator node is selected. Configure filter conditions (field, operator, value).
- `DeduplicatePanel.tsx` — Opens when a DeduplicateOperator node is selected. Configure dedup key fields.

### `shared.tsx`

Utility functions used across editor components:
- `getUpstreamSourceFields(nodes, edges, nodeId)` — traverses the graph backwards from a given node to collect available source fields
- `FieldPicker` — reusable dropdown populated with upstream fields

### `context.ts`

`EditorContext` React context holds:
- `transformationId`
- `nodes`, `edges`, `setNodes`, `setEdges` (React Flow state)
- `selectedNodeId`, `setSelectedNodeId`
- All source/target objects available to the transformation

---

## File Import Pipeline

### Flow

```
User selects file
  → dialog:openFile (native dialog)
  → objects:inferSchema(filePath, options)
      → importer.parseFile → importer.inferSchema
      → returns InferredField[]
  → ImportWizard shows schema for review/edit
  → User confirms
  → objects:create(role, name, ..., fields)
  → objects:importRows(id, filePath, options)
      → importer.parseFile → storeSourceRows
```

### Schema Inference

`inferSchema` in `core/importer.ts`:
1. Takes first row as headers
2. Samples up to 200 data rows
3. For each column:
   - Tries to parse as number → `number`
   - Tries to parse as date (ISO, US, European patterns) → `date`
   - Otherwise → `string`
4. Flags `is_key` if all values are unique
5. Flags likely picklist if distinct value count ≤ 20 and sample size ≥ 10

### ImportWizard Component

Multi-step modal (`src/components/workspace/ImportWizard.tsx`):
1. **File selection** — file path display + browse button
2. **Schema review** — editable table of inferred fields (rename, change type, reorder, delete)
3. **Metadata** — name, description, and (for targets) template layout options

For targets with no file (manual schema), the wizard starts at step 1 but skips schema inference and starts with an empty field list.

---

## Build System

### Scripts (`package.json`)

| Script | What it does |
|--------|-------------|
| `dev` | Starts Vite dev server + Electron (via vite-plugin-electron) |
| `build:preload` | Compiles `electron/preload.ts` → `dist-electron/preload.cjs` with esbuild (CJS required) |
| `build:renderer` | Vite build for React renderer → `dist/` |
| `build:electron` | `tsc -p tsconfig.electron.json` → compiles main process TS |
| `build` | Full production build: renderer + electron + electron-builder packaging |
| `rebuild-native` | Runs `electron-rebuild` to recompile `better-sqlite3` against the installed Electron headers |

### Key Configuration Notes

- `package.json` has `"type": "module"`. Vite and the renderer use ESM. The main process TS is compiled to ESM by `tsc`.
- **Preload exception**: Must be CJS for `contextBridge` to work. Compiled separately with `esbuild --format=cjs`.
- `vite.config.ts` has `server: { open: false }` — prevents Vite from opening a browser window (important in WSL).
- `better-sqlite3` is a native Node addon. It must be listed in Rollup's `external` array and must be rebuilt with `npm run rebuild-native` after fresh installs or Electron version changes.

### `tsconfig` files

- `tsconfig.json` — renderer (targets ESNext, DOM lib)
- `tsconfig.electron.json` — main process (targets Node, no DOM, `module: ESNext`, `moduleResolution: Bundler`)

---

## Web Server Mode

`web-server/server.ts` provides a REST API equivalent to the Electron IPC channels. Run progress is streamed via Server-Sent Events (`web-server/sse.ts`).

`WebPlatform.ts` in `src/platform/` implements `IPlatform` using `fetch`. The React app detects which platform is active at startup and injects the appropriate implementation into a React context consumed by all views.

Web server projects are stored in `~/flux-projects/` by default, configurable via `FLUX_PROJECTS_DIR` environment variable.

---

## Known Issues and Gotchas

- **`window.electronAPI` guard**: All `useEffect` hooks that call IPC must guard with `if (!window.electronAPI) return` to avoid errors during Vite hot-reload in non-Electron dev contexts.
- **SheetJS vs ExcelJS**: The run engine uses ExcelJS for output (streaming writes). The importer uses ExcelJS for reading. Do not use `XLSX.readFile()` (SheetJS) — it fails in the bundled Electron context. Use `fs.readFileSync` + `XLSX.read(buffer)`.
- **React Flow node data types**: `@xyflow/react` v12 requires node data types to extend `Record<string, unknown>`. Cast via `data as unknown as YourType` in node components rather than changing the interface.
- **Canvas state size**: The canvas JSON blob includes all node positions and edge data. For very large transformations this can grow. Currently no pruning is applied.
- **Expression rule security**: The `expression` rule type uses `new Function()` to evaluate user-provided JS. This runs in the Node.js main process (sandboxed by Electron, not a browser sandbox). Treat as a power-user feature.
