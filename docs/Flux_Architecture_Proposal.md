# Flux — Architecture Proposal
## Addressing the v0.3 Product Backlog

|||
|:----|:----|
|**Status:**| DRAFT — for discussion |
|**Date:** |February 2026 |
|**Context:**| This document addresses four architectural questions raised during v0.2 review. It assumes familiarity with the v0.2 design document. |

---

## 1. Profile Management UX — Hiding the JSON

**Goal:** A non-technical user should never need to see or touch a JSON file.

### Current state

`ConfigureMappingStep` asks the user to paste raw JSON or click "Load Built-In". The `PresetBuilder` visual editor already exists in the codebase but is a separate mode toggled from the header — it is not integrated into the main migration workflow.

### Proposed: Profile Selection screen

Replace the JSON-paste step with a three-option **Profile Selection** screen as the entry point to Step 2:

```
┌─────────────────────────────────────────────────────┐
│  Configure Mapping                                  │
│                                                     │
│  ┌─────────────────┐  ┌────────────────┐  ┌──────────────────┐
│  │  Built-in       │  │ Load from file │  │   Create new     │
│  │  profiles       │  │                │  │   profile        │
│  │                 │  │  Import a JSON │  │                  │
│  │  SF → Workday   │  │  profile       │  │  Opens visual    │
│  │  SF → ADP  ...  │  │  shared by a   │  │  editor          │
│  │                 │  │  colleague     │  │  (PresetBuilder) │
│  └─────────────────┘  └────────────────┘  └──────────────────┘
│
│  Recently used:
│  • acme-workers-v3.json  (SF→WD Workers, 14 Feb 2026)
│  • acme-org-units.json   (SF→WD Orgs, 11 Feb 2026)
└─────────────────────────────────────────────────────┘
```

**Implementation notes:**
- "Built-in profiles" shows the bundled profiles from the `profiles/` registry, grouped by migration direction. Selecting one loads it directly.
- "Load from file" opens the OS file picker filtered to `.json` files. The loaded JSON is still validated by Zod — the user just doesn't type or edit it.
- "Create new profile" launches the existing `PresetBuilder` component inside the workflow, instead of as a separate detached mode. On save, it returns the user to the workflow at Step 3.
- The JSON files remain the single source of truth on disk. Users who want to hand-edit them still can — JSON mode in the editor supports this. Non-technical users just never encounter that path.
- "Recently used" is persisted via `electron-store` (already a dependency). Costs two lines of code.

**What changes in the codebase:**
- `ConfigureMappingStep.tsx` — replace the textarea with the three-option card UI and recent profiles list
- `App.tsx` — `PresetBuilder` no longer needs its own top-level `appMode`; it becomes a sub-view within the mapping step
- No engine, schema, or store changes required

---

## 2. Generalization — Renaming to Flux

**Name:** **Flux** — *Field Level Universal EXchange*

### What this means architecturally

The engine, validation, and export layers contain **no knowledge of SAP SuccessFactors or Workday**. All system-specific knowledge already lives in two JSON artefact types: **Connectors** (renamed from Templates) and **Transformations** (renamed from Profiles). This was the intent of the v0.2 design. The rename is mostly a branding and UI text change.

### Changes required

| Location | Current | Proposed |
|---|---|---|
| `package.json` — name | `sf2wd` | `flux` |
| `package.json` — productName | `SF2WD` | `Flux` |
| `package.json` — appId | `com.sf2wd.app` | `com.flux.app` |
| App header title | `SF2WD` | `Flux` |
| App header subtitle | `SuccessFactors → Workday Migration Tool` | `Field Level Universal EXchange` |
| Export filenames | `SF2WD_Quality_Summary_...xlsx` | `Flux_Quality_Summary_...xlsx` |
| `__SF2WD_Errors` column | `__SF2WD_Errors` | `__FLUX_Errors` |
| `PresetBuilder` hardcoded field lists | `SF_FIELDS`, `WD_FIELDS` arrays | Load dynamically from Connector JSON files |

### Making the PresetBuilder truly generic

Currently `PresetBuilder/index.tsx` has `SF_FIELDS` and `WD_FIELDS` hardcoded as static arrays (lines 26–83). This is the one place that knows about SAP SF and Workday specifically.

**Fix:** Load the field list from the selected Connector's JSON file. When a user picks a source Connector and a target Connector during profile creation, the PresetBuilder reads the field schemas from those JSON files and builds the field lists dynamically. New Connectors (ADP, Oracle HCM, etc.) are then automatically supported in the visual editor with zero code changes.

```
User selects: Source = "SF SuccessFactors EC Export"
              Target = "Workday EIB Worker"

PresetBuilder reads:
  templates/sap-successfactors/ec-employee-export.json → source fields
  templates/workday/eib-worker.json → target fields

... then renders the visual field mapping UI exactly as today
```

### Adding custom Connectors

For truly generic use, allow users to register their own Connector JSON files:

- "New Connector" option in the profile creation flow
- User provides a JSON file matching the Connector schema (field name, type, required, picklist values)
- Connector stored in the user's app data directory alongside built-in ones
- Immediately available as a source or target in any new Transformation

This unlocks arbitrary source-to-target migrations without any application code changes.

---

## 3 & 4. Many-to-Many + Entity Model

These two questions are tightly coupled. The entity model determines how many-to-many is represented.

### Proposed Entity Model

Three entities, two of which already exist in the codebase:

```
Connector  (currently called Template)
│
│  describes a file format: its fields, types, constraints
│  stored as JSON in templates/ directory
│  examples: "SF EC Employee Export", "WD EIB Worker", "ADP Workforce Export"
│
Transformation  (currently called Profile)
│
│  maps one Connector (source) to one Connector (target)
│  contains: field mappings, lookup tables, settings
│  stored as a .json file — shareable, versionable
│  examples: "sf-ec-to-wd-eib-worker.json"
│
Project  ← NEW
│
│  groups multiple Transformations for one engagement
│  stored as a .flux project file (JSON container)
│  owns the "run state": which source file is loaded for each Transformation
│  examples: "acme-corp-phase1.flux"
```

### Why 1:1 Transformations are the right atomic unit

A Transformation maps **one source Connector to one target Connector**. This is deliberate:

- The transformation engine is a pure function: one source row array in, one output row array out. There is no merge or join step.
- Keeping Transformations atomic means they remain independently testable, shareable, and reusable across Projects.
- A complex migration (workers + org units + positions + cost centres) is represented as **four Transformations inside one Project**, not as one complex Transformation.

### The Project entity

```json
{
  "projectId":   "acme-corp-phase1",
  "name":        "ACME Corp — Migration Phase 1",
  "description": "Full initial load: workers, orgs, positions",
  "createdAt":   "2026-02-01",
  "updatedAt":   "2026-02-27",
  "client":      "ACME Corp",
  "transformations": [
    {
      "id":               "workers",
      "name":             "Workers",
      "transformationRef": "sf-ec-to-wd-eib-worker",
      "lastSourceFile":   "/exports/acme_ec_export_20260215.xlsx"
    },
    {
      "id":               "org-units",
      "name":             "Org Units",
      "transformationRef": "sf-ec-to-wd-eib-org",
      "lastSourceFile":   "/exports/acme_org_export_20260215.xlsx"
    },
    {
      "id":               "positions",
      "name":             "Positions",
      "transformationRef": "acme-positions-custom",
      "lastSourceFile":   null
    }
  ]
}
```

Key design decisions for the Project entity:

- `transformationRef` points to a Transformation JSON file. The Transformation can be a built-in starter profile or a custom client profile — the Project doesn't care.
- `lastSourceFile` is optional and convenience-only: remembers the last file path so the user doesn't have to re-browse every time. Not required for a run.
- The Project file is **not** required to use the app. Single-transformation users can still work exactly as today without ever creating a Project.

### Updated Workflow with Projects

```
[Home screen]
  ├── Open existing project (.flux file)  → Project Dashboard
  ├── New project                         → Project Dashboard (empty)
  └── Quick start (no project)            → existing 4-step wizard

[Project Dashboard]
  ┌─────────────────────────────────────────────────────────────┐
  │ ACME Corp — Phase 1                                         │
  │                                                             │
  │  Transformation      Source file        Status   Action     │
  │  ─────────────────   ────────────────   ──────   ──────     │
  │  Workers             acme_ec_...xlsx    ✓ Clean  Export     │
  │  Org Units           acme_org_...xlsx   ⚠ 3 warn Export     │
  │  Positions           (none loaded)      –        Load file  │
  │                                                             │
  │  [Run all]  [Export all]  [+ Add transformation]            │
  └─────────────────────────────────────────────────────────────┘
```

Clicking a Transformation in the dashboard opens the existing 4-step wizard for that Transformation in context. The dashboard shows aggregate status.

### Handling true many-to-many (cross-file enrichment)

A scenario like "enrich worker records with data from a separate payroll file" requires combining rows from two source files before transformation. This is the genuine many-to-many case.

**Recommended approach for now:** pre-merge files externally (VLOOKUP in Excel, Power Query) before loading into Flux. This is consistent with Flux's role as a *transformation and formatting* tool, not a data warehouse.

**Longer term (v1.x):** the design doc already flags DuckDB-WASM as the option for SQL-style JOINs across source files. If this becomes a common client requirement, the Ingestion Layer's named-slot architecture (§8.1 of v0.2 design doc — "primary", "secondary" source slots) accommodates it without changes to the Transformation engine.

### Summary: entity relationships

```
Connector ──< Transformation >── Connector
              (source side)      (target side)

Project ──< ProjectTransformation >── Transformation
```

- One Connector can be the source of many Transformations (e.g., "SF EC Export" used by the workers profile AND the manager hierarchy profile)
- One Connector can be the target of many Transformations (e.g., "WD EIB Worker" targeted by both an SF source and an ADP source)
- One Transformation can appear in many Projects (reuse across client engagements)
- One Project contains many ProjectTransformations (the many-to-many grouping unit)

---

## Implementation Sequencing

Rough ordering by value-to-effort:

| Priority | Change | Effort | Value |
|---|---|---|---|
| 1 | Profile Selection UX (three options) | Medium | High — removes the biggest usability barrier |
| 2 | Rebrand to Flux (text, package.json) | Low | Medium — aligns naming with product direction |
| 3 | PresetBuilder loads fields from Connector JSON | Medium | Medium — enables generic connector support |
| 4 | Project entity + Project Dashboard | High |  High — unlocks multi-transformation migrations |
| 5 | Custom Connector registration | Low | Medium — completes the generic platform story |
| 6 | "Run all" / "Export all" batch execution | Medium | Medium — quality-of-life for multi-transformation |

Items 1–3 can be done without any schema or store changes. Item 4 is the largest single addition and introduces new persistence (`electron-store` or a `.flux` project file).

---

*Flux Architecture Proposal | February 2026 | Draft for discussion*
