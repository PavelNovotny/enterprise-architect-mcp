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

**Proposed** — awaiting spike results on `.EAP` file before acceptance.

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

## Consequences

**Positive:**

- Analysts point the server at their `.EAP` project file directly — no export step.
- The server can reflect model changes immediately, since it reads the live file.
- Removes the dependency on `node:sqlite` and its Node version constraints.

**Negative:**

- Introduces a new dependency (MDBReader or equivalent JET3 driver) — needs
  evaluation for Node 25 compatibility, maintenance status, and packaging.
- JET3 SQL dialect may differ from SQLite in subtle ways (string functions,
  date handling, `LIKE` behavior) — existing queries in `src/tools/` may need
  adjustment.
- Read performance characteristics change — JET3 over MDB is not the same as
  SQLite with a 64 MB page cache. The current `PRAGMA cache_size` tuning is
  SQLite-specific and has no JET3 equivalent.
- `node:sqlite`'s synchronous API model (`DatabaseSync`) may not have a direct
  JET3 equivalent — the access pattern may need to become async, affecting every
  tool handler.
- The solution doc `docs/solutions/tooling-decisions/node-sqlite-over-better-sqlite3.md`
  becomes historical context only; a new solution doc for the JET3 driver choice
  would be needed.
- `.qea` (SQLite) support is dropped. If any workflow depends on `.qea` files,
  that path breaks.

**Follow-up work:**

- Spike on the `.EAP` file above (gate for the rest).
- Abstract the database interface so `src/database.ts` returns a common query
  API regardless of the underlying engine — protects against future format
  changes and makes a dual-mode fallback possible if needed later.
- Audit all SQL queries in `src/tools/` for SQLite-specific syntax.
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
- Spike target file: `/Users/pavelnovotny/Arch-DD/o2integration/DD/HC-ADAPTER/HC-ADAPTER_Detail-design.EAP`
- ADR template: `docs/adr/0000-template.md`
