---
adr-id: "0001"
title: "Replace SQLite layer with JET3 (MDBReader) for direct .EAP file access"
date: 2026-09-29
status: proposed
deciders: "pavelnovotny"
tags:
  - adr
  - database
  - jet3
  - mdbreader
  - eap
  - sqlite
  - architecture
---

# ADR-0001: Replace SQLite layer with JET3 (MDBReader) for direct .EAP file access

## Status

**Proposed** — spike completed successfully (see Spike Results below); awaiting
decision on acceptance.

## Context

The server currently reads `.qea` files — Sparx EA's SQLite-based export format —
through Node.js's built-in `node:sqlite` module (`DatabaseSync`). This works but
requires analysts to export a `.qea` from their EA project every time the model
changes. The native EA project format is `.EAP`, a JET3 (Access 2000 / MDB)
database file. If the server could read `.EAP` directly, analysts would point the
MCP server at their live project file with no export step.

The current SQL layer is tightly coupled to SQLite specifics:

- `src/database.ts` — `DatabaseSync` constructor with `{ readOnly: true }`, SQLite
  `PRAGMA cache_size` tuning, and `db.prepare()` / `.get()` / `.all()` call patterns.
- `docs/solutions/tooling-decisions/node-sqlite-over-better-sqlite3.md` — documents
  the choice of `node:sqlite` over `better-sqlite3`, a decision that only applies
  to the SQLite path.
- `docs/solutions/architecture-patterns/mcp-server-readonly-sqlite-architecture.md` —
  the overall architecture assumes SQLite throughout.

JET3 is a different database engine. The table structure (`t_object`, `t_package`,
`t_connector`, `t_diagram`, etc.) is the same EA schema, but the access driver,
query dialect details, and connection model differ. `node:sqlite` cannot open
`.EAP` files — a JET3 reader (MDBReader or equivalent) is needed.

### Options considered

1. **JET3 via MDBReader** — replace the SQLite layer entirely with a JET3/MDB
   reader that opens `.EAP` files directly. Eliminates the export step.
2. **Dual-mode** — keep SQLite for `.qea`, add JET3 for `.EAP`, detect by file
   extension. More flexible but doubles the database abstraction surface.
3. **External conversion** — keep `node:sqlite`, convert `.EAP` to `.qea`
   out-of-band (EA export or a script). No server change, but doesn't eliminate
   the export friction.

## Decision

**Proposed: Option 1 — replace the SQLite layer with JET3 (MDBReader).**

The server's database access would be reworked to use a JET3/MDB reader instead
of `node:sqlite`. The tool layer (`src/tools/`) stays unchanged — it already
operates on table names and SQL strings, not on `DatabaseSync` directly. The
change is concentrated in `src/database.ts` and `src/model-session.ts`.

The first step before committing to the full replacement is a **spike**: verify
that MDBReader can open and query a real `.EAP` file —

```
/Users/pavelnovotny/Arch-DD/o2integration/DD/HC-ADAPTER/HC-ADAPTER_Detail-design.EAP
```

The spike checks:

- Can the file be opened read-only?
- Are the expected EA tables present (`t_object`, `t_package`, `t_connector`,
  `t_diagram`, `t_diagramobjects`, `t_diagramlinks`, `t_objectconstraint`,
  `t_objectproperties`, `t_objectoperations`, `t_objectparams`)?
- Can a representative query return correct rows (e.g.
  `SELECT Object_ID, Name, Object_Type FROM t_object LIMIT 10`)?
- Is read performance acceptable for interactive agent use?

If the spike passes, the full migration proceeds. If it fails, the decision is
revised (dual-mode or external conversion).

## Spike Results

**Spike script:** `scripts/spike-mdb-reader.mjs`
**Target file:** `/Users/pavelnovotny/Arch-DD/o2integration/DD/HC-ADAPTER/HC-ADAPTER_Detail-design.EAP`
**Date:** 2026-09-29

### 1. File opens read-only — PASS

The 2.02 MB `.EAP` file opened with `mdb-reader` (v3.2.0) without error. The
library reads the file into a `Buffer` and parses it in-memory — no file
locking, no native dependencies.

### 2. Expected EA tables present — PASS (14/20 exact, 6 renamed)

98 tables found. All core EA tables are present. Six tables from the QEA
schema have different names in EAP:

| QEA name (expected)     | EAP name (found)         |
|------------------------|--------------------------|
| `t_objectoperations`   | `t_operation`            |
| `t_objectparams`       | `t_operationparams`     |
| `t_objectefforts`      | `t_objecteffort`        |
| `t_scenarios`          | `t_objectscenarios`     |
| `t_secroles`           | `t_secgroup`             |
| `t_secpolperms`        | `t_secpolicies`          |

These are naming differences, not missing functionality. A table-name mapping
resolves them.

### 3. Representative queries return correct rows — PASS

All four core tables returned data with the expected EA schema:

- **t_object** — 204 rows, 57 columns (Object_ID, Name, Object_Type, Note,
  Package_ID, ea_guid, StyleEx, etc.)
- **t_package** — 27 rows, 23 columns (Package_ID, Name, Parent_ID, ea_guid,
  XMLPath, etc.)
- **t_connector** — 223 rows, 79 columns (Connector_ID, Connector_Type,
  Start_Object_ID, End_Object_ID, StyleEx, etc.)
- **t_diagram** — 17 rows, 29 columns (Diagram_ID, Package_ID, Diagram_Type,
  Name, etc.)

### 4. Read performance — PASS (small file)

- Full `t_object` read (204 rows): **2.7 ms** (0.013 ms/row)
- In-memory WHERE filter on `t_object`: **2.2 ms**
- In-memory JOIN `t_object` × `t_connector`: **8.6 ms** (223 connectors
  matched against 204 objects)

Performance on this 2 MB file is excellent. Scaling to production-sized files
(100 MB+) is untested — see Open Questions below.

### 5. Table-only access (no SQL) — KEY FINDING

**`mdb-reader` has no SQL engine.** It provides `getTable(name).getData()` —
full table reads with optional column selection and row offset/limit. There
is no `WHERE`, `JOIN`, `ORDER BY`, `GROUP BY`, or prepared statements.

The current codebase is built entirely on `db.prepare(SQL).get/all()` — every
tool module constructs SQL strings with parameterized queries. A migration to
`mdb-reader` requires one of:

- **A. In-memory query layer** — read full tables into JS arrays, filter/join/
  sort with JavaScript. Simple but memory-intensive on large tables, and
  every query becomes a full table scan.
- **B. Hybrid approach** — use `mdb-reader` to open the file, but export
  to a temporary SQLite database on first open, then query with `node:sqlite`
  as today. Best of both worlds, but adds conversion latency on open.
- **C. Different library** — find a JET3 reader with SQL support (none found
  in the npm ecosystem; `mdb-reader` is the only maintained option).

### Summary

| Check                     | Result |
|--------------------------|--------|
| File opens               | PASS   |
| Core tables present      | PASS   |
| Data returns correctly   | PASS   |
| Performance (2 MB file)  | PASS   |
| SQL support              | FAIL — no SQL engine, table-only access |

**Verdict:** `mdb-reader` can read `.EAP` files, but it is not a drop-in
replacement for `node:sqlite`. The SQL-to-table-only gap is the primary
architectural risk. Option B (hybrid: EAP → temp SQLite → existing SQL layer)
may be the most pragmatic path — it preserves all existing tool code and
only changes `database.ts` to detect `.EAP` and convert on open.

## Consequences

**Positive:**

- Analysts point the server at their `.EAP` project file directly — no export step.
- The server can reflect model changes immediately, since it reads the live file.
- Removes the dependency on `node:sqlite` and its Node version constraints.

**Negative:**

- `mdb-reader` has **no SQL engine** — it reads tables, not queries. The entire
  tool layer (`src/tools/`) is built on `db.prepare(SQL).get/all()` with
  parameterized queries, joins, and WHERE clauses. A migration requires either
  an in-memory query layer (Option A) or a hybrid EAP→SQLite conversion
  (Option B — recommended, see Decision section update below).
- Introduces a new dependency (`mdb-reader`) — compatible with Node 25, pure
  JS (no native compilation), actively maintained, MIT licensed.
- Read performance on production-sized files (100 MB+) is untested — the spike
  used a 2 MB file. `mdb-reader` loads the entire file into a `Buffer`, so
  memory usage scales with file size.
- `node:sqlite`'s synchronous API model (`DatabaseSync`) has no direct
  `mdb-reader` equivalent — `getData()` is synchronous but returns all rows
  at once, not a prepared statement cursor.
- The solution doc `docs/solutions/tooling-decisions/node-sqlite-over-better-sqlite3.md`
  becomes historical context only; a new solution doc for the JET3 driver choice
  would be needed.
- Six table names differ between EAP and QEA (see Spike Results table mapping).
- `.qea` (SQLite) support is dropped if Option 1 is taken. If any workflow
  depends on `.qea` files, that path breaks.

**Follow-up work:**

- ~~Spike on the `.EAP` file above~~ — DONE, see Spike Results.
- Decide between Option A (in-memory query layer) and Option B (hybrid
  EAP→temp SQLite conversion). Option B is recommended: it preserves all
  existing tool code unchanged and confines the change to `database.ts`.
- Implement the chosen approach in `src/database.ts`.
- Create a table-name mapping for the 6 renamed tables (EAP → QEA names).
- Benchmark on a production-sized `.EAP` file (100 MB+).
- Update `docs/solutions/architecture-patterns/mcp-server-readonly-sqlite-architecture.md`
  or write a successor for the JET3 architecture.
- Update `README.md` and `CONCEPTS.md` to reflect `.EAP` as the primary format.

## Alternatives considered

**Option 2 — Dual-mode (SQLite + JET3):** Detect by extension and route to the
appropriate driver. More flexible and non-breaking, but doubles the testing
surface, requires two database drivers to maintain, and the abstraction layer
must handle dialect differences. Worth keeping as a fallback if the JET3 spike
reveals performance or compatibility problems that make a full replacement
risky.

**Option 3 — External conversion:** No server change; analysts or a script
convert `.EAP` to `.qea` out-of-band. Simplest from the server's perspective,
but it does not solve the core problem — the export step is the friction we
want to eliminate. It also introduces a conversion tool as a new dependency.
Only viable if the JET3 spike fails entirely.

## References

- Current architecture: `docs/solutions/architecture-patterns/mcp-server-readonly-sqlite-architecture.md`
- Current DB driver decision: `docs/solutions/tooling-decisions/node-sqlite-over-better-sqlite3.md`
- Database module: `src/database.ts`
- Session / path resolution: `src/model-session.ts`
- Spike script: `scripts/spike-mdb-reader.mjs`
- Spike target file: `/Users/pavelnovotny/Arch-DD/o2integration/DD/HC-ADAPTER/HC-ADAPTER_Detail-design.EAP`
- `mdb-reader` on npm: https://www.npmjs.com/package/mdb-reader
- `mdb-reader` on GitHub: https://github.com/andipaetzold/mdb-reader
- ADR template: `docs/adr/0000-template.md`
