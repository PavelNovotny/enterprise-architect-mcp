Status: Done
Date: 2026-09-29

# Add ea_find_models tool for recursive model discovery under a root directory

## Context

Nothing in the server enumerates model files. The two places a `.eap`/`.qea`
path turns into a file are both single-directory and single-result:

- `resolveQeaTarget` (`src/resolve-qea-path.ts:44`) resolves a configured value;
  when it points at a directory, `findNewestModel` (`src/resolve-qea-path.ts:59`)
  does one non-recursive `readdirSync` and returns the newest match only.
- `ea_switch_model` (`src/tools/switch.ts:12`) takes a `path` and hands it to the
  same `resolveQeaTarget`, so it has the same one-level behaviour.

Neither reports what else was there. An agent that has a root directory but not
a concrete filename therefore has no tool-side way to see the candidates, and
falls back to shelling out to `find` — which depends on the agent having shell
access, getting the extension casing right (`-iname`, since `.EAP` is common),
and including `.eapx`.

`findNewestModel` already treats `.qea`, `.eap` and `.eapx` as model extensions,
but matches them case-sensitively via `endsWith`.

## Decision

Add a read-only `ea_find_models` tool in a new `src/tools/discover.ts`, registered
from `src/tools.ts`.

Parameter:

- `root` (string, required) — directory to scan. No default and no fallback to
  the configured/open model's directory: the caller names the root.

Behaviour:

1. Resolve `root` to an absolute path. If it does not exist, or is not a
   directory, return `isError: true` with structured JSON.
2. Walk it recursively, unlimited depth, collecting every file whose extension is
   `.eap`, `.eapx` or `.qea`, compared case-insensitively.
3. Do not follow symbolic links — a link loop would make the walk non-terminating.
4. A subdirectory that cannot be read (permissions) is not fatal: it is skipped and
   listed in `unreadable`, so an incomplete scan is visible rather than silent.

The tool does not open, switch or touch the current model, and must not call
`model.database()` — its purpose is to run when no model is open yet.

Response:

- `root` — the resolved absolute path that was scanned.
- `models` — one entry per file: `path` (absolute), `relativePath` (from `root`),
  `fileName`, `extension` (lower-cased), `sizeBytes`, `lastModified` (ISO).
- `unreadable` — directories skipped, as `{ path, reason }`.
- `totalMatched` / `returned` / `truncated`, plus `offset` and `continuation`,
  using the existing helpers in `src/tools/windowing.ts`. The whole tree is walked
  on every call, so `totalMatched` is exact and a window is a slice of it.
- `_meta.sourceTables: []` — the tool reads the filesystem, not the model database.

Ordering is by `relativePath`, ascending, so repeated calls window a stable list.

## Consequences

- `src/tools/discover.ts`: new file, `configureDiscoverTools(server, model)`.
- `src/tools.ts`: register it.
- An agent handed a root directory can enumerate candidates through a tool call and
  then pass a chosen `path` to `ea_switch_model`, without shell access.
- `findNewestModel` keeps its case-sensitive, single-level behaviour; this slug does
  not change startup path resolution.
- README's Available Tools table gains a row.
- The server instructions in `src/index.ts` gain the tool on the `Discovery:` line.
- The tool reports files by extension only; it does not open them, so a listed file
  is a candidate, not a verified model.
