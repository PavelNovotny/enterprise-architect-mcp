Status: Done
Date: 2026-09-29

# Replace SQLite layer with JET3 (MDBReader) for direct .EAP file access

## Context

The server reads `.qea` files — Sparx EA's SQLite-based export format — through
Node.js's built-in `node:sqlite` module (`DatabaseSync`). This requires analysts
to export a `.qea` from their EA project every time the model changes. The
native EA project format is `.EAP`, a JET3 (Access 2000 / MDB) database file.

`node:sqlite` cannot open `.EAP` files — a JET3 reader is needed. `mdb-reader`
(v3.2.0) can: it opens the file from a `Buffer`, parses it in-memory, and
provides `getTable(name).getData()` access. No file locking, no native deps.

A spike against the live file `HC-ADAPTER_Detail-design.EAP` (2 MB) confirmed:

- File opens read-only — PASS
- Core tables present — PASS (98 tables, 6 with different names from QEA)
- Representative queries return correct rows — PASS
- Read performance — PASS (2.7 ms for 204 rows)
- **SQL support — FAIL**: `mdb-reader` has no SQL engine, only table-level reads

Without SQL, the 46 `db.prepare()` calls across 11 tool files cannot be
replaced directly. A hybrid approach (EAP → temp SQLite → existing SQL layer)
preserves all tool code unchanged.

## Decision

Implement a hybrid EAP→SQLite converter (`src/eap-converter.ts`): read the
`.EAP` with `mdb-reader`, write every table into a temporary SQLite database,
then query that temp DB with the existing `node:sqlite` code path.

`src/database.ts` detects `.eap`/`.eapx` extensions and routes through the
converter; `.qea` files open directly as today.

Six tables have different names between EAP and QEA — a `TABLE_NAME_MAP`
in the converter renames them during conversion.

The tool layer (`src/tools/`) stays unchanged.

## Consequences

- Analysts point the server at their `.EAP` project file directly — no export step.
- All 9 tool modules stay unchanged — zero regression risk in the tool layer.
- Conversion adds latency on first open (negligible for 2 MB; untested for 100 MB+).
- `mdb-reader` loads the entire file into a `Buffer`; peak memory ~2× file size.
- Temp SQLite file must be created, cleaned up on close, and handle concurrent sessions.
- Six table-name mappings are a maintenance burden if EA changes schema between versions.
- `.qea` support stays as a fast path — no breaking change.

Spike script: `scripts/spike-mdb-reader.mjs`.
