# Flux — User Guide

## What is Flux?

Flux is a desktop application designed to help HR consultants migrate data between enterprise HR systems — for example, from SAP SuccessFactors to Workday. It gives you a structured, visual workspace to define exactly how data from one system maps to another, then execute that mapping to produce clean, ready-to-load output files.

Flux is self-contained: every project you create is a single portable file on your computer. You can copy it, share it, archive it, or open it on another machine with Flux installed.

---

## Core Concepts

### Projects

A project is the top-level container for a migration engagement. Each project is saved as a `.flux` file on your computer. You can have as many projects as you like — one per client, one per workstream, or however your work is organized.

When you open Flux, you see your recent projects and the option to create a new one or open an existing file.

### Data Objects

A data object represents a data set — either something you're migrating *from* (a **source**) or something you're migrating *to* (a **target**).

- **Sources** are typically exports from your current system — CSV or Excel files containing employee records, cost centers, job codes, etc.
- **Targets** are templates from your destination system — Excel files with specific column headers that the system expects on import.

Each data object has a **schema**: a list of fields with names and types. Flux infers this automatically when you upload a file, and you can edit it manually afterwards.

### Picklists

Picklists are named sets of coded values — for example, employment status codes, pay frequency codes, or country codes. Enterprise HR systems often use different internal codes for the same concepts, so you need a way to translate them.

Flux lets you define picklists separately for your source system and your target system, then create **picklist mappings** that say "when the source has value X, the target should receive value Y."

### Transformations

A transformation is the heart of the tool. It defines how source data is converted into target data.

You build a transformation visually: you place your source and target objects on a canvas, draw connections between them, and configure rules for each target field. Rules can do things like copy a field directly, combine multiple fields into one, reformat a date, translate a picklist code, or compute a value from a formula.

### Runs

Once your transformation is defined, you execute it. Flux reads all your source rows, applies every rule, and writes output files — one per target object — in Excel or CSV format. You can monitor progress in real time, review any issues or warnings, and download the output files.

---

## Navigating the Workspace

The workspace is divided into sections, accessible from the sidebar on the left:

- **Sources** — manage your source data files
- **Targets** — manage your target templates
- **Picklists** — manage your coded value sets
- **Picklist Mappings** — define source-to-target value translations
- **Transformations** — build and manage your field mapping logic
- **Runs** — execute transformations and download results

---

## Step-by-Step Workflow

### 1. Create a Project

From the home screen, click **New Project**. You'll be asked where to save the `.flux` file and what to call the project. Once created, you land in the workspace.

### 2. Upload Your Source Data

Go to **Sources** and click **New Source**. Flux opens an import wizard:

1. **Select a file** — choose the CSV or Excel export from your source system.
2. **Review the schema** — Flux infers field names and data types from the file. You can rename fields, change types, or remove fields you don't need.
3. **Confirm** — the data is saved into your project.

You can click on any source to preview its data and edit its schema at any time.

### 3. Set Up Your Target Template

Go to **Targets** and click **New Target**. You have two options:

- **Upload a template file** — if your destination system provides a blank Excel template with column headers, upload it here. Flux reads the headers as the target schema.
- **Manual schema** — define fields by hand if you don't have a template file.

Targets also support specifying which row the headers are on and where the data should start, to accommodate templates with cover sheets or pre-filled header rows.

### 4. Define Picklists (if needed)

Go to **Picklists**. You'll see separate sections for source picklists and target picklists.

Create a picklist for each set of coded values that appears in your data. You can upload values from an Excel file or enter them manually as key-label pairs.

Then go to **Picklist Mappings** and create a mapping that links a source picklist to a target picklist, row by row: for each source code, specify the corresponding target code.

### 5. Build a Transformation

Go to **Transformations** and click **New Transformation**. Give it a name and open the editor.

The transformation editor is a visual canvas:

- **Left panel** — lists your source objects and available operators
- **Canvas** — your working area
- **Right panel** — lists your target objects

Drag source and target objects onto the canvas. A **Map** operator automatically appears to connect them. You can also add **Join**, **Filter**, **Append**, and **Deduplicate** operators as needed.

For each target field, click to configure its rule:

| Rule | What it does |
|------|-------------|
| **Direct** | Copies a source field as-is |
| **Constant** | Sets a fixed value for every row |
| **Concat** | Combines multiple fields and/or text |
| **Split** | Extracts a piece of a delimited value |
| **Substring** | Extracts characters by position |
| **Date Format** | Parses and reformats a date |
| **Picklist Translate** | Looks up the value in a picklist mapping |
| **Lookup** | Retrieves a value from another object |
| **UUID** | Generates a unique identifier per row |
| **Incremental** | Auto-numbers rows |
| **Expression** | Computes a value using a formula |

Changes are saved automatically as you work.

### 6. Run the Transformation

Go to **Runs**. Select your transformation and click **Run**.

Flux processes every source row and shows you a live progress bar. When finished, you'll see:

- Total rows processed
- Number of warnings or errors
- An issues table listing any rows or fields that had problems

Click **Download** next to any target object to save the output file to your computer.

---

## Tips and Best Practices

- **Start with schema review**: Before building your transformation, spend time reviewing your source and target schemas side by side. Identify fields that need translation, reformatting, or splitting.
- **Use picklists early**: Define picklists and mappings before building your transformation. This makes the Picklist Translate rule much easier to configure.
- **Run early and often**: You don't have to finish all rules before running. Run with partial rules to check your output and catch issues early.
- **Check the issues table**: After each run, review warnings carefully. They often reveal data quality problems in the source — missing required values, unexpected formats, or unmapped picklist codes.
- **Projects are portable**: Your `.flux` file contains everything — data, schema, mappings, rules, and run history. You can move it to another machine, share it with a colleague, or archive it when the engagement is complete.
