/**
 * Contract test: iterates all tools and verifies the response shape contract.
 * - Every response is valid JSON (never unstructured text)
 * - Every response has _meta.sourceTables
 * - Every collection has totalMatched/returned/truncated
 * - Not-found returns isError:true with structured JSON error
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configureAllTools } from "../src/tools";
import { createTestDb, staticModel, TestDb } from "./helpers/test-db";

let client: Client;
let testDb: TestDb;

/** A root ea_find_models can walk — one model file is enough for this contract. */
const FIND_MODELS_ROOT = mkdtempSync(join(tmpdir(), "ea-find-models-contract-"));
writeFileSync(join(FIND_MODELS_ROOT, "model.qea"), "");

beforeAll(async () => {
  testDb = createTestDb();

  const server = new McpServer({ name: "Contract Test", version: "0.0.0" });
  configureAllTools(server, staticModel(testDb.db));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterAll(() => {
  testDb.cleanup();
  rmSync(FIND_MODELS_ROOT, { recursive: true, force: true });
});

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as any[])[0]?.text;
  return { isError: (result as any).isError, text, json: () => JSON.parse(text) };
}

// Valid calls that should return structured JSON with _meta
const validCalls: [string, Record<string, unknown>][] = [
  ["ea_search", { requiredTerms: ["zmlúv"] }],
  ["ea_search_and_any_of", { requiredTerms: ["zmlúv"] }],
  ["ea_get_element", { elementId: 1 }],
  ["ea_list_elements", { packageId: 3 }],
  ["ea_get_connectors", { elementId: 1 }],
  ["ea_get_diagram_elements", { diagramId: 1 }],
  ["ea_get_scenarios", { elementId: 1 }],
  ["ea_get_package_tree", {}],
  ["ea_list_diagrams", {}],
  ["ea_resolve", { reference: "{OBJ-0001}" }],
  ["ea_get_schema", {}],
  ["ea_get_schema", { tableName: "t_object" }],
  ["ea_get_model_info", {}],
  ["ea_find_models", { root: FIND_MODELS_ROOT }],
];

// Calls with non-existent subjects that should return isError:true
const notFoundCalls: [string, Record<string, unknown>][] = [
  ["ea_get_element", { elementId: 999999 }],
  ["ea_get_diagram_elements", { diagramId: 999999 }],
  ["ea_list_elements", { packageId: 999999 }],
  ["ea_get_connectors", { elementId: 999999 }],
  ["ea_get_scenarios", { elementId: 999999 }],
  ["ea_list_diagrams", { packageId: 999999 }],
  ["ea_get_package_tree", { packageId: 999999 }],
  ["ea_get_schema", { tableName: "t_nonexistent" }],
];

// Calls with valid subject that has empty results
const emptyCalls: [string, Record<string, unknown>][] = [
  ["ea_get_connectors", { elementId: 4 }], // element exists, no connectors
  ["ea_get_scenarios", { elementId: 2 }], // element exists, no scenarios
  ["ea_search", { requiredTerms: ["xyzzy_nonexistent_term_12345"] }],
];

describe("Response shape contract — valid calls", () => {
  test.each(validCalls)("%s(%j) returns valid JSON with _meta.sourceTables", async (tool, args) => {
    const res = await callTool(tool, args);
    expect(res.isError).toBeFalsy();
    const data = res.json();
    expect(data).toBeDefined();
    expect(data._meta).toBeDefined();
    expect(Array.isArray(data._meta.sourceTables)).toBe(true);
  });
});

describe("Response shape contract — not-found returns structured error", () => {
  test.each(notFoundCalls)("%s(%j) returns isError:true with JSON error field", async (tool, args) => {
    const res = await callTool(tool, args);
    expect(res.isError).toBe(true);
    const data = res.json();
    expect(data.error).toBe("not_found");
  });
});

describe("Response shape contract — empty results are structured, not text", () => {
  test.each(emptyCalls)("%s(%j) returns structured JSON with totalMatched:0", async (tool, args) => {
    const res = await callTool(tool, args);
    expect(res.isError).toBeFalsy();
    const data = res.json();
    expect(data._meta).toBeDefined();
    // Find the totalMatched — either top-level or via first collection key
    const hasTotalTopLevel = typeof data.totalMatched === "number";
    const hasTotalInMeta = data._meta && Object.values(data._meta).some(
      (v: any) => v && typeof v === "object" && typeof v.totalMatched === "number"
    );
    expect(hasTotalTopLevel || hasTotalInMeta).toBe(true);
  });
});

/**
 * Paging was drawn deliberately narrow: only the three enumeration tools window their
 * results, because every other tool returns a set small enough to hand over whole.
 * Driven off validCalls so a tool added later is covered the day it appears.
 */
const PAGED_TOOLS = new Set(["ea_search", "ea_search_and_any_of", "ea_list_elements", "ea_list_diagrams", "ea_find_models"]);

describe("Response shape contract — the window stays with the enumeration tools", () => {
  test.each(validCalls.filter(([tool]) => !PAGED_TOOLS.has(tool)))(
    "%s(%j) returns no offset, breakdown or continuation",
    async (tool, args) => {
      const data = (await callTool(tool, args)).json();
      expect(data.offset).toBeUndefined();
      expect(data.breakdown).toBeUndefined();
      expect(data.continuation).toBeUndefined();
    },
  );

  test.each(validCalls.filter(([tool]) => PAGED_TOOLS.has(tool)))(
    "%s(%j) echoes offset and agrees with its own truncation flag",
    async (tool, args) => {
      const data = (await callTool(tool, args)).json();
      expect(typeof data.offset).toBe("number");
      expect(data.truncated).toBe(data.offset + data.returned < data.totalMatched);
    },
  );
});

/**
 * The server never writes, so a client that asks for confirmation only on writes
 * must be told that. An unannotated tool is indistinguishable from a destructive one.
 */
describe("Every tool is advertised as read-only", () => {
  test("listTools reports readOnlyHint on all of them", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    const unannotated = tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);
    expect(unannotated).toEqual([]);
  });
});
