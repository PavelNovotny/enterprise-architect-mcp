Status: Done
Date: 2026-09-29

# Add ea_switch_model tool for runtime model switching

## Context

The MCP server opens one model on startup (CLI arg, env var, `.env`, or prompt)
and caches the `DatabaseSync` handle for the session. Switching to a different
`.eap`/`.qea` file requires restarting the server or changing the IDE MCP
configuration — not practical when working across multiple EA projects in one
session.

The server caches the DB in `ModelSession.db` (`src/model-session.ts:53`) and
the corpus in `WeakMap<Database, ...>` (`src/tools/search.ts:19`). Both are
keyed to the open database handle, so closing and reopening with a new path
would naturally invalidate the cache.

## Decision

Add a new `ea_switch_model` tool in `src/tools/overview.ts` (or a new
`src/tools/switch.ts`) that takes a `path` parameter (filepath to a `.eap`/
`.qea` file or a directory containing one) and:

1. Closes the current database (if open)
2. Opens the new model via `openDatabase(path)` (same path used at startup)
3. Resets `ModelSession.db` and `ModelSession.opened` to the new handle
4. Clears the search corpus `WeakMap` (happens automatically — old DB is
   dereferenced, new DB gets a fresh entry on next `buildCorpus`)
5. Returns the new model identity (fileName, fileSizeBytes, elementCount,
   packageTree) — same shape as `ea_get_model_overview` so the agent is
   oriented immediately after switching

The tool does not persist the path — it switches for the current session only.
The startup path (`.env`, CLI arg, etc.) remains the default for the next
server restart.

Register in `src/tools.ts`.

## Consequences

- The agent can switch between EA projects at runtime — no restart, no config
  change.
- The IDE MCP config can stay empty or point to a default; each conversation
  calls `ea_switch_model` with the path it needs.
- Search corpus is rebuilt on first `ea_search` after switching — one-time
  cost per switch.
- Closing the old DB before opening the new one prevents resource leaks.
- The `remembered-path.ts` config is not touched — switching is session-only,
  not persisted.
- `.env` and CLI arg remain the startup default for the next restart.
