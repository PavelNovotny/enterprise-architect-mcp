Status: Done
Date: 2026-09-29

# Refactoring estimate and implementation plan for EAP support

## Context

ADR 0001 confirmed `mdb-reader` can read `.EAP` files but has no SQL engine.
A full audit of the codebase found:

- 46 `db.prepare()` calls across 11 files
- Only 2 files have hard SQLite dependencies (`database.ts`, `schema.ts`)
- 3 more have soft dependencies (`COLLATE NOCASE` — trivially replaceable)
- The remaining 6 files use standard SQL

A full in-memory query layer (replacing all 46 SQL calls with JS filter/join/sort)
would touch 9+ files, require ~1500–2500 lines of changes, and carry high
regression risk — for no user-visible benefit over the hybrid approach.

## Decision

Implement the hybrid EAP→SQLite conversion (Part 1 of ADR 0001). Do not
pursue a full in-memory query layer.

Scope of change:

| What changes | File |
|-------------|------|
| New: EAP→SQLite converter | `src/eap-converter.ts` |
| Detect `.EAP` vs `.qea`, route accordingly | `src/database.ts` |
| Table-name mapping (6 renamed tables) | `src/eap-converter.ts` |
| Type mapping (MDB types → SQLite types) | `src/eap-converter.ts` |
| `ea_get_model_info` — report original `.EAP` path | `src/tools/schema.ts` |
| Tests | `test/eap-converter.test.ts` |

All 9 tool modules, `src/package-path.ts`, `src/model-session.ts`, and
`src/tools/windowing.ts` stay unchanged.

## Consequences

- All 9 tool modules unchanged — zero regression risk in the tool layer.
- `COLLATE NOCASE`, `PRAGMA`, and `sqlite_master` keep working (temp DB is SQLite).
- The `foldText()` search architecture stays as-is.
- `.qea` support stays as a fast path — no breaking change.
- Conversion latency on first open; untested on production-sized files (100 MB+).
- Memory peak ~2× file size during conversion.
- The 6 table-name mappings need updating if EA schema changes between versions.
