/**
 * Contract test: a tool's description is the API surface an MCP client programs
 * against. The client reads it once at load and never sees the source, so a
 * description that drifts from behaviour is a wrong spec shipped to production —
 * not stale documentation. These tests bind every description to what its tool
 * actually returns, in both directions.
 *
 * Direction A — every tool-specific top-level field in a real response is named
 * in that tool's description. This is what catches a new field shipping silently.
 *
 * Direction B — every identifier a description promises exists as a response
 * field or a declared parameter. This is what catches a description naming a
 * field the tool never returns.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configureAllTools } from "../src/tools";
import { createTestDb, staticModel, TestDb } from "./helpers/test-db";

/**
 * A root with a model file at two depths and one unreadable directory, so
 * ea_find_models has something to walk and something to report as skipped.
 */
const FIND_MODELS_ROOT = mkdtempSync(join(tmpdir(), "ea-find-models-"));
mkdirSync(join(FIND_MODELS_ROOT, "sub"), { recursive: true });
writeFileSync(join(FIND_MODELS_ROOT, "top.qea"), "");
writeFileSync(join(FIND_MODELS_ROOT, "sub", "nested.EAP"), "");
const FIND_MODELS_LOCKED = join(FIND_MODELS_ROOT, "locked");
mkdirSync(FIND_MODELS_LOCKED);
chmodSync(FIND_MODELS_LOCKED, 0o000);

let server: McpServer;
let client: Client;
let testDb: TestDb;
let toolIndex: Map<string, { description: string; params: Set<string> }>;

/**
 * Documented once in the server instructions (src/index.ts), not per tool, so an
 * individual description is not required to restate them.
 */
const CONTRACT_FIELDS = new Set([
  "totalMatched",
  "returned",
  "truncated",
  "offset",
  "breakdown",
  "_meta",
  "sourceTables",
]);

/**
 * EA columns are passed through verbatim and always start uppercase (Object_ID,
 * PackageName); fields the server invented start lowercase. Only the invented
 * ones carry semantics a client has to be told about, so only they are required
 * to appear in a description.
 */
const isServerDefined = (field: string) => /^[a-z]/.test(field);

/** Calls returning a success payload; a tool whose shape branches on its arguments gets one per branch. */
const SAMPLE_CALLS: [string, Record<string, unknown>][] = [
  ["ea_search", { requiredTerms: ["zmlúv"] }],
  // A window that truncates, so the continuation and breakdown branches are inspected too.
  ["ea_search", { requiredTerms: ["a"], limit: 1 }],
  // No match, so the per-term termMatches diagnostic (R6) is inspected too.
  ["ea_search", { requiredTerms: ["zzznoexistterm123", "zmlúv"] }],
  ["ea_search_and_any_of", { requiredTerms: ["zmlúv"] }],
  // A narrowing call, so andAnyOf's exclusion is exercised too.
  ["ea_search_and_any_of", { requiredTerms: ["osoba"], andAnyOf: ["architektúre"] }],
  // No match and a truncated window, so termMatches and continuation are inspected too.
  ["ea_search_and_any_of", { requiredTerms: ["zzznoexistterm123"] }],
  ["ea_search_and_any_of", { requiredTerms: ["a"], limit: 1 }],
  ["ea_get_element", { elementId: 1 }],
  ["ea_list_elements", { packageId: 3 }],
  ["ea_list_elements", { packageId: 3, limit: 1 }],
  ["ea_get_connectors", { elementId: 1 }],
  // Surfaces the Generalization child/parent `role` branch.
  ["ea_get_connectors", { elementId: 5, connectorType: "Generalization" }],
  ["ea_get_diagram_elements", { diagramId: 1 }],
  ["ea_get_scenarios", { elementId: 1 }],
  ["ea_get_package_tree", {}],
  ["ea_list_diagrams", {}],
  ["ea_list_diagrams", { limit: 1 }],
  ["ea_resolve", { reference: "{OBJ-0001}" }],
  ["ea_get_schema", {}],
  ["ea_get_schema", { tableName: "t_object" }],
  ["ea_get_model_info", {}],
  ["ea_find_models", { root: FIND_MODELS_ROOT }],
  // A truncated window, so the continuation branch is inspected too.
  ["ea_find_models", { root: FIND_MODELS_ROOT, limit: 1 }],
];

beforeAll(async () => {
  testDb = createTestDb();

  server = new McpServer({ name: "Description Contract", version: "0.0.0" });
  configureAllTools(server, staticModel(testDb.db));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);

  const { tools } = await client.listTools();
  toolIndex = new Map(
    tools.map((t) => [
      t.name,
      {
        description: t.description ?? "",
        params: new Set(Object.keys((t.inputSchema as any)?.properties ?? {})),
      },
    ]),
  );
});

afterAll(async () => {
  await client.close();
  await server.close();
  testDb.cleanup();
  chmodSync(FIND_MODELS_LOCKED, 0o755);
  rmSync(FIND_MODELS_ROOT, { recursive: true, force: true });
});

async function responseOf(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as any[])[0]?.text;
  return JSON.parse(text);
}

/** Every key at any depth, so a promised field counts as present wherever it lives. */
function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 5)) collectKeys(item, into);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      collectKeys(child, into);
    }
  }
  return into;
}

/**
 * Backticks mark a literal name in a description; values stay in double quotes and
 * everything else is prose. Reading only what is backticked is what lets an ordinary
 * word like "type" or "results" be checked at all, instead of matching by accident.
 */
function documentedNames(description: string): string[] {
  return [...new Set([...description.matchAll(/`([^`]+)`/g)].map((m) => m[1]))];
}

/** A dotted name is verified at its leaf, since paths may cross arrays. */
const leafOf = (name: string) => name.split(".").pop()!;

const TOOLS_UNDER_TEST: [string, Record<string, unknown>[]][] = [
  ...new Set(SAMPLE_CALLS.map(([name]) => name)),
].map((name) => [name, SAMPLE_CALLS.filter(([n]) => n === name).map(([, args]) => args)]);

describe("tool descriptions are bound to behaviour", () => {
  it("registers a description for every tool", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.description ?? "").not.toHaveLength(0);
    }
  });

  it("covers every registered tool with a sample call", async () => {
    const { tools } = await client.listTools();
    const sampled = new Set(SAMPLE_CALLS.map(([name]) => name));
    const unsampled = tools.map((t) => t.name).filter((name) => !sampled.has(name));
    expect(unsampled).toEqual([]);
  });

  describe.each(TOOLS_UNDER_TEST)("%s", (name, argSets) => {
    it("names every server-defined top-level response field in its description", async () => {
      const { description } = toolIndex.get(name)!;
      const documented = new Set(documentedNames(description).map(leafOf));
      const undocumented: string[] = [];

      for (const args of argSets) {
        const body = await responseOf(name, args);
        undocumented.push(
          ...Object.keys(body)
            .filter(isServerDefined)
            .filter((field) => !CONTRACT_FIELDS.has(field))
            .filter((field) => !documented.has(field)),
        );
      }

      expect([...new Set(undocumented)]).toEqual([]);
    });

    // The union across branches, so a name documented for one form of the call counts.
    it("promises no identifier that is neither a response field nor a parameter", async () => {
      const { description, params } = toolIndex.get(name)!;
      const actual = new Set<string>();
      // A description may cite the EA tables it read, but only the ones it owns up to.
      const sourceTables = new Set<string>();

      for (const args of argSets) {
        const body = await responseOf(name, args);
        collectKeys(body, actual);
        for (const table of body?._meta?.sourceTables ?? []) sourceTables.add(table);
      }

      const phantom = documentedNames(description).filter((id) => {
        const leaf = leafOf(id);
        return (
          !actual.has(leaf) &&
          !params.has(leaf) &&
          !CONTRACT_FIELDS.has(leaf) &&
          !sourceTables.has(leaf) &&
          !toolIndex.has(id)
        );
      });

      expect(phantom).toEqual([]);
    });
  });
});
