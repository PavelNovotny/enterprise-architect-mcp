#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { ModelSession } from "./model-session.js";
import { configureAllTools } from "./tools.js";
import { packageVersion } from "./version.js";

const argv = yargs(hideBin(process.argv))
  .scriptName("mcp-server-ea")
  .usage("Usage: $0 [qea-path]")
  .version(packageVersion)
  .command(
    "$0 [qea-path]",
    "Enterprise Architect MCP Server",
    (yargs) => {
      yargs.positional("qea-path", {
        describe:
          "Path to .qea file or directory containing .qea files. " +
          "Falls back to EA_QEA_PATH env var, .env in CWD, a remembered answer, " +
          "then asking the client. If a directory is given, the newest .qea file is used.",
        type: "string",
      });
    }
  )
  .help()
  .parseSync();

const server = new McpServer(
  {
    name: "Enterprise Architect MCP Server",
    version: packageVersion,
  },
  {
    instructions: `This server provides read-only access to a Sparx Enterprise Architect analysis model (.qea export).

Response shape contract:
- Every response is structured JSON — no tool returns unstructured text, even for empty results.
- Every collection carries totalMatched, returned, truncated (always present, even when truncated: false).
- _meta.sourceTables lists which database tables the response draws from.
- ea_get_diagram_elements returns per-collection metadata in _meta.elements and _meta.connectors (not top-level) because it returns two independent collections.
- The enumeration tools (ea_search, ea_list_elements, ea_list_diagrams) return a window: they accept offset, echo it back, and order results deterministically. That order is stable but artificial — not alphabetical and not the analyst's tree order — so never infer meaning from adjacency.
- When truncated: true, a continuation object provides the exact call that returns the next window. Following it repeatedly visits every matching row once and terminates; do not raise limit to fetch a large set in one call.
- When far more rows match than one window holds, a breakdown object reports how they distribute. Every key in it is a parameter name and every value is an argument value, so a breakdown is an invitation to narrow the next call rather than page through the set. Each axis reports totalMatched/returned/truncated for its own list of distinct values, not for rows, and rows carrying no value on that axis are not counted — so the counts need not sum to the response's totalMatched.
- Not-found errors (non-existent element/package/diagram ID) return isError: true with structured JSON — distinct from a valid empty result.
- When reporting that something is absent from the model, cite totalMatched, truncated and _meta.sourceTables from the response that supports the claim. An empty result is not evidence of absence unless the subject is confirmed to exist.

Text fields (Note, Notes, notes) use EA's HTML dialect: lists (<ol>, <ul>, <li>), bold (<b>), anchors (<a href>). No div/span/script. Structural escapes (&lt; &gt; &amp;) are preserved. Embedded model links ($element://, $diagram://) appear as <a href> targets. Character entities (&#225; etc.) are decoded to characters.

Use ea_* tools when the user asks about:
- Business analysis, use cases, requirements, screens, classes, or domain model elements
- Application architecture, components, interfaces, or their relationships
- Use case scenarios / flows — all step attributes (trigger, uses, result, link) and scenario notes are returned
- How elements relate to each other — connectors include feature-link resolution showing which attribute or operation each end attaches to
- Package/module structure of the analysis model
- Diagram contents — elements AND connectors (including implied connectors with both ends on the diagram)
- Which diagrams an element appears on (returned by ea_get_element)
- Constraints and business rules on elements (pre-conditions, post-conditions, invariants, process rules)
- Resolving analyst references (GUIDs, names) to model nodes
- What database tables and columns the model export contains
- Which export file the server has open

Do NOT use ea_* tools for:
- Azure DevOps work items, bugs, tasks, PRs, or repositories (use ado server instead)
- Source code, builds, or deployments

Typical workflow: ea_search → ea_get_element → ea_get_connectors / ea_get_scenarios
Reference resolution: ea_resolve (GUID or name) → ea_get_element or ea_get_diagram_elements
Discovery: ea_list_diagrams to find diagrams, ea_get_schema to explore the model's tables, ea_find_models to locate .eap/.qea files under a directory
Provenance: ea_get_model_info to identify the export file`,
  }
);

const session = new ModelSession(server, argv["qea-path"] as string | undefined);
configureAllTools(server, session);

const transport = new StdioServerTransport();
await server.connect(transport);
session.reportConfiguration();