# Enterprise Architect MCP Server

[![npm version](https://img.shields.io/npm/v/enterprise-architect-mcp.svg)](https://www.npmjs.com/package/enterprise-architect-mcp)
[![Node.js](https://img.shields.io/node/v/enterprise-architect-mcp.svg)](https://nodejs.org)
[![License: EUPL-1.2](https://img.shields.io/badge/license-EUPL--1.2-blue.svg)](LICENSE)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_server-0098FF?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522enterprise-architect%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522enterprise-architect-mcp%2522%255D%257D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_server-24bfa5?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522enterprise-architect%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522enterprise-architect-mcp%2522%255D%257D)
[![Compound Engineering](https://img.shields.io/badge/Built_with-Compound_Engineering-6366f1)](https://github.com/EveryInc/compound-engineering-plugin)

A read-only [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for Sparx Enterprise Architect `.qea` exports. Gives AI agents access to EA analysis models — search elements, navigate packages, read use case scenarios, and traverse connectors — without a running EA instance.

Works with any MCP client (VS Code / GitHub Copilot, Claude Desktop, Cursor, Windsurf). Reads the `.qea` SQLite export directly, never writes to it, and every response carries completeness metadata so an agent can tell a truncated answer from a complete one.

**Keywords:** MCP server · Sparx Enterprise Architect · `.qea` · UML · use case scenarios · package tree · connectors · diagrams · model search · AI agent tooling

## Prerequisites

- **Node.js 22+** (uses the built-in `node:sqlite` module)
- A `.qea` file exported from Sparx Enterprise Architect

## Installation

### VS Code / GitHub Copilot

The quickest route is the **Install in VS Code** badge at the top of this page. There is nothing to
fill in: the server asks for your `.qea` path the first time an agent queries the model, and
remembers the answer for next time.

To register it from a terminal instead, which is handier for scripting or a shared setup, use one
CLI call:

```powershell
code --add-mcp '{\"name\":\"enterprise-architect\",\"command\":\"npx\",\"args\":[\"-y\",\"enterprise-architect-mcp\"]}'
```

The `\"` sequences are for the `code` shim, which re-parses the argument after PowerShell has
already handed it over — escaping with PowerShell's own backtick, or using `--%`, still arrives with
the quotes stripped. The single quotes stop PowerShell from touching the string. On bash or zsh the
plain form works instead:

```bash
code --add-mcp '{"name":"enterprise-architect","command":"npx","args":["-y","enterprise-architect-mcp"]}'
```

To configure it by hand instead, add to your project's `.vscode/mcp.json`:

```json
{
  "servers": {
    "enterprise-architect": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "enterprise-architect-mcp"]
    }
  }
}
```

Nothing personal is in that file, so it can be committed as-is and each developer answers the prompt
once on their own machine. If you would rather not be asked at all, name the path up front — as a
trailing argument, in an `env` block, or in a gitignored `.env` in your workspace root:

```ini
EA_QEA_PATH=C:\EA\exports\model.qea
```

### Claude Desktop

The same path-less configuration goes in `claude_desktop_config.json` (`%APPDATA%\Claude\` on
Windows, `~/Library/Application Support/Claude/` on macOS):

```json
{
  "mcpServers": {
    "enterprise-architect": {
      "command": "npx",
      "args": ["-y", "enterprise-architect-mcp"]
    }
  }
}
```

Claude Desktop does not run the server from a workspace folder, so a `.env` there is not reliable.
If the client cannot show the path prompt at all, the server says so instead of failing silently, and
you can name the path in an `env` block:

```json
"env": { "EA_QEA_PATH": "C:\\EA\\exports\\model.qea" }
```

To run straight from source instead of npm, use `"args": ["-y", "github:mm6502/enterprise-architect-mcp"]`.

## Example Prompts

Once connected, try prompts like:

- "Search for elements related to 'legal entity'"
- "Show me the package structure under the root"
- "What are the use case scenarios for UC_SUBMIT_APPLICATION?"
- "What elements and connectors are on diagram 0103 Application Processing?"
- "Resolve the reference {3F2A7C10-5B4D-4e8a-9C1F-27D6E8B0A4F3}"
- "What columns does t_connector have?"
- "Which diagrams does element a7680 appear on?"

## Configuration

The server does not need a path to start. It looks for one when an agent first queries the model, and
takes the first source that actually opens:

1. **CLI argument** — `mcp-server-ea C:\path\to\model.qea`
2. **Environment variable** — `EA_QEA_PATH` (set in an `env` block or system env)
3. **`.env` file** — `EA_QEA_PATH=...` in a `.env` file in the working directory
4. **A remembered answer** — whatever you last told the prompt
5. **The prompt** — the client asks, and a working answer is remembered for next time

If you would rather never see the prompt — a CI job, a shared image, or simply a preference — put
the path in a gitignored `.env` in the working directory. Copy the template:

```powershell
Copy-Item .env.example .env
```

Then set your local path in `.env`:

```ini
EA_QEA_PATH=C:\EA\exports\model.qea
```

If the path points to a **directory** instead of a file, the server automatically picks the newest
`.qea` file in it by modification time — point it at your export folder and new exports are picked up
without reconfiguring anything:

```ini
EA_QEA_PATH=C:\EA\exports\
```

The `.env` file is gitignored — each developer sets their own path without affecting the shared
config. It is also never committed, which is why it is the one route every new user has to set up by
hand; answering the prompt once is what makes that unnecessary.

A source naming a path that cannot be opened is **skipped** rather than fatal, so the next source gets
its turn. The reason goes to the server log, and once some later source opens, `ea_get_model_info`
lists it under `skipped`. That is deliberate — a sample value left in an `env` block would otherwise
outrank every answer you could give, and answering the prompt would never help. The cost is that a
genuine typo is demoted quietly, so check `ea_get_model_info` if the server opens a different model
than you expected.

Skipping is only worth it when an answer can take the skipped source's place, so two cases stay
fatal: a path you passed **on the command line** (that is this run's explicit instruction, not a
stale default), and any broken source in a client that **cannot show a prompt** — falling through
there would quietly open some other model instead of telling you.

Answers are remembered per machine, in `%APPDATA%\enterprise-architect-mcp\` on Windows,
`~/Library/Application Support/enterprise-architect-mcp/` on macOS, and `$XDG_CONFIG_HOME` (or
`~/.config`) elsewhere; set `EA_MCP_CONFIG_DIR` to keep that file somewhere else. A path that does
not open is never remembered, so asking again is enough to correct a mistyped answer.

## Available Tools

| Tool | Description |
|------|-------------|
| `ea_search` | Full-text search across elements, attributes, operations, and constraints. Takes `requiredTerms`, a list of terms every one of which must occur somewhere in an element's searchable text (conjunction) — terms need not share a field, but sharing one ranks higher. `boostAnyOf` is an optional list of further terms that promote a result's rank without ever excluding on that basis. Case- and diacritic-insensitive across European Latin alphabets, decodes entity-encoded text. Each result carries the evidence for its match — the field, the attribute or operation it came from, and a snippet of the author's own text. Accepts a `packageScope` (package id or name) to restrict results to a package and its descendants, and reports a package breakdown axis when unscoped. |
| `ea_search_and_any_of` | Same matching as `ea_search`, plus `andAnyOf`: an optional list of terms where a result must satisfy `requiredTerms` **and** at least one `andAnyOf` term — narrowing rather than reordering. Use this instead of `ea_search` when an alternative term should exclude, not just promote. |
| `ea_get_element` | Full element detail — attributes, operations, diagrams it appears on, constraints (pre/post/invariant/process). Flags whether attribute multiplicity is contrastive. |
| `ea_list_elements` | List elements in a package, optionally filtered by type. Windowed: reports the total and pages with `offset`. |
| `ea_get_connectors` | Relationships for an element — includes feature-link resolution (which attribute/operation each end attaches to). `Generalization` connectors carry a `role` (`child`/`parent`) on each end; filter `connectorType: "Generalization"` with `direction: "incoming"`/`"outgoing"` to list an element's direct children/parent(s) without a diagram. |
| `ea_get_diagram_elements` | Elements and connectors on a diagram, including implied connectors and feature links. `elements` includes free-text `Note` diagram objects, which often carry a legend or abbreviation definitions. |
| `ea_get_scenarios` | Use case scenario steps with all attributes (trigger, uses, result, link, state) and scenario notes. A step's `uses` may name a business rule or constraint by code — that code isn't independently searchable, it's retrieved via `ea_get_element` on the same element. |
| `ea_get_package_tree` | Navigate the package hierarchy with recursive depth. |
| `ea_list_diagrams` | Search diagrams by name, type and package. Windowed like the tools above. |
| `ea_resolve` | Resolve analyst references (braced GUID or plain name) to model candidates with full package path. Falls back to name-prefix matching for analyst codes; every candidate carries a `match` of `guid`, `exact`, or `prefix`. |
| `ea_get_schema` | Introspect the model's database schema — tables, columns, indexes, rowid alias. |
| `ea_get_model_info` | Identity of the open export — file name, size, modification date, server version, and which configuration source the path came from. |
| `ea_find_models` | Recursively scan a directory for `.eap`/`.eapx`/`.qea` files at any depth, matched case-insensitively. Use to enumerate candidates before `ea_switch_model` when a root directory is known but the specific file is not. Does not open or touch the current model. |

### Response contract

Every tool returns structured JSON with:

- `_meta.sourceTables` — which database tables were consulted
- `totalMatched` / `returned` / `truncated` — completeness metadata on every collection
- `continuation` — exact call to retrieve the full set when truncated
- `isError: true` + `{ error: "not_found" }` for non-existent subjects (distinct from empty results)

Two fields exist to stop an inexact answer from being read as a confirmed one:

- `ea_resolve` — `match` is always present; only `prefix` is an inexact match
- `ea_get_element` — `_meta.attributes.multiplicityIsUniform: true` means the element's attributes show no multiplicity contrast, so `1..1` is not evidence of requiredness

## How Results Are Ordered, Paged, and Narrowed

### Name ordering

Matching is locale-independent — search folds case and diacritics across European Latin alphabets,
so `Straße`, `Łódź` and `Győr` are found however they are typed or entity-encoded.

The enumeration tools — `ea_search`, `ea_list_elements`, `ea_list_diagrams` — do not order by name
at all. They order by the model's internal identity: stable and repeatable, but artificial, so
nothing should be read into which row follows which. That is a deliberate trade. Alphabetical
ordering under SQLite's binary collation sorts every accented initial after `Z`, and since these
tools return a window rather than the whole set, it does not merely reorder the list — it pushes
accented names out of the window entirely. Measured on a real export, names with an accented
initial filled 1.3% of visible slots under binary ordering against 3.0% under identity order, in a
model where they make up 3.9% of all names.

Only `ea_get_scenarios` still orders names by locale, where the whole set is always returned and no
name can be cut off. `EA_LOCALE` pins that ordering to a BCP 47 tag (`sk`, `pl`, `hu`, `de`, …) in
an `env` block or system env; unset, the host default applies. It does not affect matching.

### Paging and narrowing

The enumeration tools return a window, not a sample. Each response carries `totalMatched`,
`returned`, `offset` and `truncated`, and when rows remain, a `continuation` naming the next call —
following it repeatedly visits every match once and terminates. Raising `limit` is not the way to
read a large set; advancing `offset` is.

When far more rows match than one window could hold, the response also carries a `breakdown` of how
they distribute. Its keys are parameter names and its values are argument values, so a breakdown is
a prompt to narrow — by `objectType`, `stereotype`, `diagramType`, or, for `ea_search` when the
result isn't already scoped, by `packageScope` (reported as the matching package's id, which the
next call can pass straight back) — rather than to page through thousands of rows.

## License

Copyright (c) 2026 Michal Mracka

Licensed under the EUPL — see [LICENSE](LICENSE) for the full text.
