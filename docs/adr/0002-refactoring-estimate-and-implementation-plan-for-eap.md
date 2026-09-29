---
adr-id: "0002"
title: "Refactoring estimate and implementation plan for EAP support"
date: 2026-09-29
status: proposed
deciders: "pavelnovotny"
tags:
  - adr
  - database
  - jet3
  - mdbreader
  - eap
  - refactoring
  - architecture
---

# ADR-0002: Refactoring estimate and implementation plan for EAP support

## Status

**Proposed** — awaiting decision on approach.

## Context

ADR-0001 proposed replacing the SQLite layer with `mdb-reader` for direct
`.EAP` access. The spike confirmed `mdb-reader` can open and read `.EAP` files,
but revealed a critical gap: it has **no SQL engine** — only `getTable(name).getData()`.

A full audit of the codebase (see References) found:

### Current SQL footprint

| Metric | Count |
|--------|------:|
| Files importing `Database` type | 11 |
| `db.prepare()` calls | 46 |
| `JOIN` / `LEFT JOIN` uses | 13 |
| `ORDER BY` uses | 10 |
| `COLLATE NOCASE` uses | 7 |
| `PRAGMA` uses | 4 |
| `sqlite_master` queries | 3 |
| `GROUP BY` uses | 1 |
| `LIMIT` / `OFFSET` uses | 1 |
| Subqueries (`IN (SELECT ...)`) | 2 |
| `COUNT(*)` uses | 5 |
| Files with SQLite-specific syntax | 5 |
| Files using only standard SQL | 6 |

### SQLite-specific dependencies by file

| File | SQLite-specific | Refactoring impact |
|------|----------------|-------------------|
| `src/database.ts` | `DatabaseSync` constructor, `PRAGMA cache_size`, `db.close()` | **High** — core of the change |
| `src/tools/schema.ts` | `sqlite_master`, `PRAGMA table_info`, `PRAGMA index_list`, `PRAGMA index_info`, `(db as any).location()` | **High** — entire tool is SQLite introspection |
| `src/tools/connectors.ts` | `COLLATE NOCASE` (×2) | **Low** — replace with JS `toLowerCase()` |
| `src/tools/diagrams.ts` | `COLLATE NOCASE` (×2) | **Low** — same |
| `src/tools/resolve.ts` | `COLLATE NOCASE` (×3) | **Low** — same |
| `src/tools/elements.ts` | None | **None** — standard SQL only |
| `src/tools/packages.ts` | None | **None** |
| `src/tools/scenarios.ts` | None | **None** |
| `src/tools/search.ts` | None — text matching already in JS via `foldText()` | **None** |
| `src/package-path.ts` | None | **None** |
| `src/model-session.ts` | None (delegates to `database.ts`) | **Low** |

### Key insight

Only **2 files** have hard SQLite dependencies (`database.ts`, `schema.ts`).
Three more have soft dependencies (`COLLATE NOCASE` — trivially replaceable).
The remaining 6 files use standard SQL that any engine would support.

## Decision

**Recommend: Split ADR-0001 into two parts. Do not pursue a full in-memory
query layer.**

### Part 1 — Hybrid EAP→SQLite conversion (recommended)

Use `mdb-reader` to read the `.EAP` file, convert it to a temporary SQLite
database on first open, then use the existing `node:sqlite` code path unchanged.

**Scope of change:**

| What changes | File | Effort |
|-------------|------|--------|
| New: EAP→SQLite converter | `src/eap-converter.ts` (new) | ~300 lines |
| Detect `.EAP` vs `.qea`, route accordingly | `src/database.ts` | ~30 lines changed |
| Table-name mapping (6 renamed tables) | `src/eap-converter.ts` | ~15 lines |
| Type mapping (MDB types → SQLite types) | `src/eap-converter.ts` | ~40 lines |
| `ea_get_model_info` — report original `.EAP` path, not temp file | `src/tools/schema.ts` | ~10 lines |
| Tests | `test/eap-converter.test.ts` (new) | ~200 lines |

**What does NOT change:**
- `src/tools/elements.ts` — zero changes
- `src/tools/connectors.ts` — zero changes
- `src/tools/diagrams.ts` — zero changes
- `src/tools/packages.ts` — zero changes
- `src/tools/scenarios.ts` — zero changes
- `src/tools/resolve.ts` — zero changes
- `src/tools/search.ts` — zero changes
- `src/package-path.ts` — zero changes
- `src/model-session.ts` — zero changes (calls `openDatabase()` which handles routing)
- `src/tools/windowing.ts` — zero changes

**Total: 3 files touched, 1 new file, ~550 lines of new/changed code.**

### Part 2 — Drop `.qea` support (optional, future)

Once the hybrid path is proven on production-sized `.EAP` files, `.qea` support
can be dropped entirely. This simplifies `database.ts` to always convert. Or
`.qea` support stays as a fast path (open directly, no conversion needed).

### Rejected: Full in-memory query layer (Option A from ADR-0001)

Replacing all 46 `db.prepare()` calls with in-memory filter/join/sort would
touch **9+ files**, require implementing a query engine in JavaScript
(WHERE, JOIN, ORDER BY, GROUP BY, LIMIT/OFFSET, COUNT, IN, subqueries,
COLLATE NOCASE), and rewrite `schema.ts` entirely (no `sqlite_master`,
no `PRAGMA`). Estimated 1500–2500 lines of changes across the codebase,
with high regression risk and no user-visible benefit over the hybrid approach.

## Consequences

**Positive (Part 1):**

- All 9 tool modules stay unchanged — zero regression risk in the tool layer.
- `COLLATE NOCASE` keeps working (it's SQLite syntax, and the temp DB is SQLite).
- `PRAGMA` and `sqlite_master` in `schema.ts` keep working (temp DB is SQLite).
- The `foldText()` search architecture stays as-is.
- Conversion happens once on open; subsequent queries are native SQLite speed.
- `.qea` support stays as a fast path — no breaking change.

**Negative:**

- Conversion adds latency on first open. For the 2 MB spike file, this is
  negligible. For a 100 MB+ production file, it needs benchmarking.
- Temporary file management — the temp SQLite file must be created, cleaned
  up on close, and handle concurrent sessions.
- Memory: `mdb-reader` loads the entire `.EAP` into a `Buffer`, then the
  converter writes it into SQLite. Peak memory is ~2× file size during
  conversion.
- The 6 table-name mappings are a maintenance burden — if EA changes schema
  between versions, mappings need updating.

## Alternatives considered

**Full in-memory query layer (ADR-0001 Option A):** Replace all 46 SQL
queries with JavaScript filter/join/sort. Rejected — high effort (1500+
lines across 9 files), high regression risk, and the only benefit over
hybrid is avoiding a temp file.

**Dual-mode with abstract interface (ADR-0001 Option 2):** Define a
`Database` interface that both `node:sqlite` and `mdb-reader` implement.
Rejected — `mdb-reader` cannot implement `prepare/get/all`, so the
interface would degrade to `getTable(name).getData()`, which is Option A
in disguise.

## References

- ADR-0001: `docs/adr/0001-replace-sqlite-with-jet3-mdbreader-for-eap.md`
- Spike script: `scripts/spike-mdb-reader.mjs`
- Audit source: all files in `src/tools/`, `src/database.ts`, `src/model-session.ts`, `src/package-path.ts`
- `mdb-reader` API: https://github.com/andipaetzold/mdb-reader
