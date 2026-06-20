# Flux — Field Level Universal EXchange

A standalone desktop ETL tool built for HR consultants performing data migrations between enterprise systems (e.g. SAP SuccessFactors → Workday). Flux is designed for non-technical users: no SQL, no scripting, no direct system access — just files in, transformed files out.

---

## What it does

HR data migrations involve taking exports from a source system, cleaning and reshaping them field by field, translating picklist codes, joining data from multiple tables, and producing files ready to load into the target system. Flux gives consultants a self-contained application to manage all of that in one place.

**Core workflow:**

1. **Load source data** — upload Excel or CSV exports from the source system; Flux infers schema automatically
2. **Define target templates** — upload target system templates or build schemas manually
3. **Map picklists** — translate source codes to target codes (e.g. `FT` → `Full_Time`)
4. **Build a transformation** — drag source and target objects onto a visual canvas, draw field-to-field connections, configure rules per field
5. **Run and download** — execute the transformation and download one Excel/CSV file per target object, ready for import

Each project is a single self-contained `.flux` file (a SQLite database) — portable, no server required.

---

## Features

### Data objects
- Import Excel (`.xlsx`, `.xls`) and CSV files with configurable header row, data start row, and separator
- Automatic schema inference (string, integer, float, date, datetime, picklist) sampled across 200 rows
- Editable schema: rename fields, change types, add descriptions, link picklist columns
- Data preview and in-app query tool (column picker, filters, distinct rows)
- Replace or re-link source files without losing transformation rules

### Picklists
- Named key → label sets for source and target sides
- Upload from Excel or enter manually
- Picklist mapping editor to translate source codes to target codes; bulk import via Excel

### Transformation editor
- Visual canvas powered by [React Flow](https://reactflow.dev/)
- Node types: Source, Target, Join (inner / left / right / full), Filter, Deduplicate, Append, and Note (free-text annotations)
- Field-level mapping rules:

| Rule | Description |
|---|---|
| Direct | Copy source field value as-is |
| Constant | Always output a fixed value |
| Concat | Combine fields and/or literals |
| Split | Extract a segment using a delimiter and index |
| Substring | Extract by character position |
| DateFormat | Parse and reformat date strings |
| Picklist Translate | Look up source value in a picklist mapping |
| Lookup | Join against another object to pull a value |
| UUID | Generate a UUID v4 per row |
| Incremental | Auto-incrementing integer from a seed |
| Expression | Formula referencing source fields (power-user escape hatch) |

- Canvas state autosaved; rules stored per field in SQLite

### Run engine
- Executes in the Electron main process (non-blocking)
- Streams live progress events to the UI
- Outputs one Excel (`.xlsx`) or CSV file per target object
- Run history with per-row issue log (warnings and errors)
- Download buttons per output file

---

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | [Electron](https://electronjs.org/) |
| Frontend | React 18 + TypeScript |
| Build | Vite + vite-plugin-electron |
| Styling | Tailwind CSS |
| Database | SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| Visual editor | [@xyflow/react](https://reactflow.dev/) (React Flow v12) |
| Excel I/O | [SheetJS (xlsx)](https://sheetjs.com/) |
| Schema validation | [Zod](https://zod.dev/) |
| State management | [Zustand](https://zustand-demo.pmnd.rs/) |

All database operations run synchronously in the main process via `better-sqlite3`. The renderer communicates over typed IPC channels namespaced by domain (`project:*`, `objects:*`, `transformations:*`, `run:*`, etc.).

---

## Project structure

```
electron/          Main process entry, IPC handlers, preload script
core/
  services/        Domain services (objects, fields, picklists, transformations, runs)
  engine.ts        Run engine (rule applicators, output writing)
  importer.ts      Excel/CSV import and schema inference
  db.ts            SQLite connection and migrations
src/
  components/
    workspace/
      SourcesView/           Source object list + import wizard
      TargetsView/           Target object list
      PicklistsView/         Picklist management
      PLMappingsView/        Picklist mapping editor
      TransformationsView/   Transformation list
      TransformationEditor/  React Flow canvas + rule config panel
      RunsView/              Run history + progress + downloads
      ObjectDetailOverlay.tsx   Schema editor, data preview, query tool
  platform/        IPC abstraction layer (Electron vs web dev)
  types/           Shared TypeScript interfaces
docs/              Architecture, roadmap, and design notes
```

---

## Getting started

### Prerequisites

- Node.js ≥ 20
- Python (required by `node-gyp` to build `better-sqlite3`)
- On Windows: Visual Studio Build Tools with "Desktop development with C++"

### Install

```bash
npm install
npm run rebuild-native   # compiles better-sqlite3 against the local Electron binary
```

### Development

```bash
npm run electron:dev
```

This starts Vite (renderer hot-reload) and compiles the preload script in watch mode, then launches Electron.

> **WSL note:** `server: { open: false }` is set in `vite.config.ts` to prevent Vite from opening a Windows browser window on start.

### Build (distributable)

```bash
npm run build
```

Outputs a portable executable under `release/`. The native `better-sqlite3` module is unpacked from the asar archive automatically.

---

## Architecture notes

- **`.flux` file = SQLite DB.** One file per project. Open it = open the project. Copy it = back up the project.
- **Preload is CJS.** Electron's `contextBridge` requires CommonJS. The preload is compiled separately via `esbuild` to `dist-electron/preload.cjs`; Vite does not handle it.
- **`better-sqlite3` is a native module.** Must be listed in Rollup's `external` and rebuilt with `npm run rebuild-native` after fresh installs or Electron version changes.
- **React Flow v12:** Custom node `data` types must extend `Record<string, unknown>`. Cast `data` inside node components: `data as unknown as YourType`.
- **SheetJS in Electron:** Use `fs.readFileSync(path)` + `XLSX.read(buf, opts)` — `XLSX.readFile()` fails in bundled Electron.

---

## Docs

- [docs/architecture.md](docs/architecture.md) — full data model, IPC channels, UI structure, run engine design
- [docs/roadmap.md](docs/roadmap.md) — implementation phases and status
- [docs/Flux.md](docs/Flux.md) — original product specification
