# Flux — Architecture & Design Specification

> **Field Level Universal EXchange**
> A standalone desktop ETL tool for non-technical HR consultants performing data migrations between enterprise systems (e.g. SAP SuccessFactors → Workday, and beyond).

---

## 1. Vision

Flux gives HR consultants a self-contained desktop application to:

1. Load source data (Excel / CSV exports from the source system)
2. Define or upload target templates (the shape the target system expects)
3. Manage picklists and map source codes to target codes
4. Visually define field-level transformation rules (drag-and-drop, Talend-inspired)
5. Run the transformation and download the resulting files, ready for upload into the target system

The tool is **not connected** to source or target systems — it operates purely on files. Future versions may add direct system connectors.

---

## 2. Core Concepts

### 2.1 Project
A project is the top-level container for a single client engagement. It holds all source objects, target objects, picklists, picklist mappings, and transformation definitions for that engagement.

A project is stored as a single **SQLite database file** with the `.flux` extension. Opening a project = opening the file. Everything is self-contained and portable (copy the file = back up the project).

### 2.2 Data Object
A **Data Object** represents one table / file from a system — either a source export or a target import template. It has:
- **Metadata**: name, description, which system it belongs to (e.g. "SAP SuccessFactors"), role (source / target)
- **Schema**: an ordered list of fields, each with a name, display name, data type, and constraints
- **Data**: the actual rows, imported from the uploaded Excel/CSV (source objects only; target objects store only the schema)

**Field data types:**

| Type | Notes |
|---|---|
| `string` | Free text; optional max length |
| `integer` | Whole number |
| `float` | Decimal number |
| `date` | Calendar date; stores the expected format (e.g. `YYYY-MM-DD`) |
| `datetime` | Date + time |
| `picklist` | References a Picklist object; stores one of the picklist's keys |

### 2.3 Picklist
A **Picklist** is a named set of `{ key → label }` pairs associated with either the source or target side of a project. Examples: employment status codes, country codes, cost centre IDs.

Picklists can be uploaded from Excel (key column + label column) or entered manually.

### 2.4 Picklist Mapping
A **Picklist Mapping** connects a source picklist to a target picklist, defining how source keys translate to target keys. Example: source `FT` → target `Full_Time`, source `PT` → target `Part_Time`.

Mappings can be built manually or bulk-imported from Excel.

### 2.5 Transformation Definition
A **Transformation Definition** specifies how one or more source objects are mapped to one or more target objects. It consists of:
- A **visual canvas** (React Flow graph) showing source nodes, target nodes, and the mapping connections between them
- Per-target-field **mapping rules** (see §3)
- **Join definitions** (for many:1 source relationships)

Multiple transformation definitions can exist per project (e.g. one for Workers, one for Org Structure).

### 2.6 Run
Executing a transformation reads source data from the database, applies all mapping rules, and writes output files (one Excel or CSV per target object). Each run is recorded with its results (rows processed, warnings, errors) and can be re-run at any time.

---

## 3. Transformation Rule Types

| Rule | Description |
|---|---|
| **Direct** | Copy the value of a source field as-is |
| **Constant** | Always output a fixed string value |
| **Concat** | Combine two or more source fields (and/or literals) into one string |
| **Split** | Extract a segment from a source field using a delimiter and an index |
| **Substring** | Extract characters by position (start, optional length) |
| **DateFormat** | Parse a source date string in one format and re-emit it in another |
| **Picklist Translate** | Look up the source value in a Picklist Mapping and return the target key |
| **Lookup** | Join against another source object on a key field and pull a value from it |
| **UUID** | Generate a new UUID v4 for each row |
| **Incremental** | Auto-incrementing integer starting at a given seed |
| **Expression** | A safe formula expression referencing source field names (power-user escape hatch) |

### Mapping Cardinalities

| Pattern | Description |
|---|---|
| **1 : 1** | One source object → one target object |
| **1 : many** | One source object split across multiple target objects |
| **many : 1** | Multiple source objects joined before mapping to one target |
| **many : many** | Combination of the above |

---

## 4. Technical Stack

| Layer | Technology | Rationale |
|---|---|---|
| Desktop shell | **Electron** | Cross-platform, Node.js access for file I/O and SQLite |
| Frontend | **React 18 + TypeScript** | Component model, strong typing |
| Build | **Vite** | Fast HMR in dev, clean Electron integration |
| Styling | **Tailwind CSS** | Utility-first, no CSS bloat |
| Database | **SQLite via better-sqlite3** | Embedded, zero-config, synchronous API, battle-tested |
| Visual editor | **React Flow** | Node-based graph canvas, supports custom node types and edges |
| Excel I/O | **SheetJS (xlsx)** | Read Excel/CSV uploads; write output files |
| Schema validation | **Zod** | Runtime type safety for IPC payloads and DB rows |
| State management | **Zustand** | Lightweight, minimal boilerplate |
| Unique IDs | **nanoid** | Compact, URL-safe IDs for DB rows |

---

## 5. Data Model (SQLite)

One `.flux` file = one SQLite database. Schema:

```sql
-- ── Projects ────────────────────────────────────────────────────────────────
CREATE TABLE projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  description TEXT,
  client     TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ── Data objects (sources and targets) ──────────────────────────────────────
CREATE TABLE data_objects (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK(role IN ('source','target')),
  name        TEXT NOT NULL,
  description TEXT,
  system_name TEXT,         -- e.g. "SAP SuccessFactors", "Workday"
  file_name   TEXT,         -- original uploaded filename (display only)
  row_count   INTEGER,      -- cached from last import
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ── Fields within a data object ─────────────────────────────────────────────
CREATE TABLE object_fields (
  id           TEXT PRIMARY KEY,
  object_id    TEXT NOT NULL REFERENCES data_objects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,       -- internal/column name
  display_name TEXT,
  data_type    TEXT NOT NULL CHECK(data_type IN ('string','integer','float','date','datetime','picklist')),
  is_required  INTEGER DEFAULT 0,
  is_nullable  INTEGER DEFAULT 1,
  picklist_id  TEXT REFERENCES picklists(id),
  date_format  TEXT,        -- e.g. "YYYY-MM-DD"
  max_length   INTEGER,
  position     INTEGER NOT NULL,
  notes        TEXT
);

-- ── Source data rows ─────────────────────────────────────────────────────────
CREATE TABLE source_rows (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id TEXT NOT NULL REFERENCES data_objects(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  data      TEXT NOT NULL   -- JSON: { "fieldName": "value", ... }
);
CREATE INDEX idx_source_rows_object ON source_rows(object_id);

-- ── Picklists ────────────────────────────────────────────────────────────────
CREATE TABLE picklists (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  side        TEXT NOT NULL CHECK(side IN ('source','target')),
  created_at  TEXT NOT NULL
);

CREATE TABLE picklist_values (
  id          TEXT PRIMARY KEY,
  picklist_id TEXT NOT NULL REFERENCES picklists(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  label       TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(picklist_id, key)
);

-- ── Picklist mappings ────────────────────────────────────────────────────────
CREATE TABLE picklist_mappings (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  source_picklist_id  TEXT REFERENCES picklists(id),
  target_picklist_id  TEXT REFERENCES picklists(id),
  created_at          TEXT NOT NULL
);

CREATE TABLE picklist_mapping_entries (
  id            TEXT PRIMARY KEY,
  mapping_id    TEXT NOT NULL REFERENCES picklist_mappings(id) ON DELETE CASCADE,
  source_key    TEXT NOT NULL,
  target_key    TEXT NOT NULL
);

-- ── Transformations ──────────────────────────────────────────────────────────
CREATE TABLE transformations (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  canvas_state TEXT,   -- JSON: React Flow nodes + edges layout
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- ── Field mappings (per target field within a transformation) ────────────────
CREATE TABLE field_mappings (
  id                TEXT PRIMARY KEY,
  transformation_id TEXT NOT NULL REFERENCES transformations(id) ON DELETE CASCADE,
  target_object_id  TEXT NOT NULL REFERENCES data_objects(id),
  target_field_id   TEXT NOT NULL REFERENCES object_fields(id),
  rule_type         TEXT NOT NULL,
  rule_config       TEXT NOT NULL,  -- JSON: rule-specific parameters
  notes             TEXT
);

-- ── Run history ──────────────────────────────────────────────────────────────
CREATE TABLE runs (
  id                TEXT PRIMARY KEY,
  transformation_id TEXT NOT NULL REFERENCES transformations(id),
  started_at        TEXT NOT NULL,
  completed_at      TEXT,
  status            TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  stats             TEXT,   -- JSON: { rowsProcessed, errorCount, warningCount }
  output_manifest   TEXT    -- JSON: [{ targetObjectId, fileName, format }]
);

CREATE TABLE run_issues (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  row_index  INTEGER,
  field_name TEXT,
  severity   TEXT NOT NULL CHECK(severity IN ('warning','error')),
  message    TEXT NOT NULL
);
```

---

## 6. IPC Architecture (Electron)

All database operations happen in the **main process** via synchronous `better-sqlite3` calls. The renderer communicates over typed IPC channels.

### Channel namespaces

| Namespace | Responsibility |
|---|---|
| `project:*` | Open / create / close / list / delete projects |
| `objects:*` | CRUD for data objects; import data from Excel/CSV |
| `fields:*` | CRUD for object fields; schema inference |
| `picklists:*` | CRUD for picklists and their values |
| `plmappings:*` | CRUD for picklist mappings and entries |
| `transformations:*` | CRUD for transformation definitions and field mappings |
| `run:*` | Execute a transformation; stream progress; fetch run history |
| `dialog:*` | Native file open/save dialogs |
| `export:*` | Write output files to user-chosen location |

### Project file lifecycle
```
dialog:openFile(.flux)   →  project:open(path)  →  returns ProjectMeta
                                                     DB connection held in main
dialog:saveFile(.flux)   →  project:saveAs(path)  →  copies DB to new path
project:create(name)     →  creates empty .flux at chosen path
project:close()          →  closes DB connection
```

---

## 7. UI Structure

```
App
├── HomeScreen
│   ├── Recent projects list (open .flux file)
│   ├── New project button
│   └── Open project button (file picker)
│
└── ProjectWorkspace  (sidebar layout)
    │
    ├── Sidebar nav
    │   ├── Sources
    │   ├── Targets
    │   ├── Picklists
    │   ├── Picklist Mappings
    │   ├── Transformations
    │   └── Runs
    │
    ├── Sources panel
    │   ├── Object cards grid
    │   │   └── Each card: name, row count, field count, status badge
    │   ├── Upload single file
    │   ├── Bulk upload (drop zone for multiple files)
    │   └── Object detail overlay
    │       ├── Schema editor (field list, type picker, reorder)
    │       ├── Data preview table (first N rows)
    │       └── Re-import / metadata edit
    │
    ├── Targets panel  (same card structure as Sources)
    │   └── Object detail overlay
    │       ├── Schema editor
    │       ├── Upload Excel template (infer schema from headers)
    │       └── Manual schema builder
    │
    ├── Picklists panel
    │   ├── Source picklists section
    │   ├── Target picklists section
    │   ├── Upload from Excel (key col + label col)
    │   └── Picklist detail overlay (view/edit key-value pairs)
    │
    ├── Picklist Mappings panel
    │   ├── Mapping cards (source PL ↔ target PL)
    │   ├── Mapping editor overlay
    │   │   ├── Source PL column / Target PL column
    │   │   ├── Row-by-row mapping UI
    │   │   └── Bulk upload from Excel
    │   └── New mapping button
    │
    ├── Transformations panel
    │   ├── Transformation cards (name, source→target summary, last run)
    │   ├── New transformation button
    │   └── Transformation editor (full-screen canvas)
    │       ├── Left dock: source object nodes (draggable onto canvas)
    │       ├── Right dock: target object nodes (draggable onto canvas)
    │       ├── Canvas: React Flow graph
    │       │   ├── SourceObjectNode — expandable field list
    │       │   ├── TargetObjectNode — expandable field list
    │       │   ├── JoinNode — define join key between two sources
    │       │   └── Edges — field-to-field connections
    │       └── Rule config panel (slide-in when edge selected)
    │           ├── Rule type picker
    │           └── Rule-specific form
    │
    └── Runs panel
        ├── Select transformation + run button
        ├── Live progress indicator
        ├── Run history list
        └── Run detail: stats, issues list, download output files
```

---

## 8. Visual Transformation Editor (React Flow)

### Node types

**SourceObjectNode**
- Header: object name + system badge
- Body: scrollable field list (field name + type icon)
- Each field has a right-side handle for outgoing connections

**TargetObjectNode**
- Header: object name + system badge
- Body: scrollable field list with status icons (mapped / required+unmapped / skipped)
- Each field has a left-side handle for incoming connections

**JoinNode**
- Inputs: two source object handles
- Configuration: join type (inner / left), join key fields
- Output: single merged data stream handle

### Edge types

**DirectEdge** — solid line, source field → target field (Direct rule, auto-created on drop)
**RuleEdge** — dashed line, indicates a non-trivial rule is configured (Concat, DateFormat, etc.)

### Interaction model
1. Drag a source object from the left dock onto the canvas → creates a SourceObjectNode
2. Drag a target object from the right dock onto the canvas → creates a TargetObjectNode
3. Draw a connection from a source field handle to a target field handle → creates a DirectEdge + Direct rule
4. Click an existing edge → opens the Rule Config panel → change rule type + configure parameters
5. Click "Auto-map" → AI-assisted name matching (exact name match + fuzzy), creates Direct rules for matches
6. Drag a JoinNode between two source nodes to define a many:1 merge

---

## 9. Schema Inference

When a user uploads an Excel or CSV file:

1. Read first row as column headers
2. Sample up to 200 rows to infer types:
   - All values parse as integer → `integer`
   - All values parse as float → `float`
   - All values match a common date pattern → `date` (record detected format)
   - Cardinality < 5% of total rows AND < 50 distinct values → candidate for `picklist`
   - Otherwise → `string`
3. Present the inferred schema to the user for review/edit before saving
4. User can: rename fields, change types, mark required, link picklist fields to existing picklists

---

## 10. Run Engine

The run engine executes entirely in the **main process** (Node.js) to avoid blocking the renderer.

### Execution flow

```
for each target object in transformation:
  output_rows = []

  for each source row:
    resolve joins (if any) → merged row context
    output_row = {}

    for each target field:
      rule = getFieldMapping(transformation, targetField)
      output_row[targetField.name] = applyRule(rule, mergedRowContext)

    validate output_row against target schema
    if valid: output_rows.push(output_row)
    else:     record issue (warning or error per field)

  writeOutputFile(targetObject, output_rows)   // Excel or CSV

emit progress events throughout → renderer shows live progress bar
```

### Output file format
- **Excel**: one sheet per target object, headers = field display names
- **CSV**: standard comma-delimited, UTF-8 BOM for Windows compatibility
- Format chosen per target object at run time (defaults to Excel)

---

## 11. Project File Format

A `.flux` file is a SQLite database. It is self-contained and can be:
- Opened from any machine with Flux installed
- Backed up by copying the file
- Version-controlled (though large source data makes this impractical for many rows)

On project open, Flux verifies the schema version stored in a `_meta` table and applies any needed migrations.

---

## 12. Out of Scope (Phase 1)

- Direct system connectivity (API calls to SAP SF, Workday, etc.)
- Collaborative / multi-user editing
- Cloud sync or project sharing
- Aided / AI-suggested mappings (future phase)
- Scheduled / automated runs
- Full audit log
