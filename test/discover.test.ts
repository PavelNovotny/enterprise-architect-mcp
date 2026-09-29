import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configureAllTools } from "../src/tools";
import { createTestDb, staticModel, TestDb } from "./helpers/test-db";

let client: Client;
let testDb: TestDb;
let root: string;

beforeAll(async () => {
  testDb = createTestDb();

  const server = new McpServer({ name: "Discover Test", version: "0.0.0" });
  configureAllTools(server, staticModel(testDb.db));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  testDb.cleanup();
});

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as any[])[0]?.text;
  return { isError: (result as any).isError, json: () => JSON.parse(text) };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ea-discover-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("ea_find_models", () => {
  it("finds a model file at the root", async () => {
    writeFileSync(join(root, "top.qea"), "");
    const res = await callTool("ea_find_models", { root });
    const data = res.json();
    expect(data.totalMatched).toBe(1);
    expect(data.models[0].fileName).toBe("top.qea");
    expect(data.models[0].relativePath).toBe("top.qea");
    expect(data.models[0].extension).toBe(".qea");
  });

  it("finds model files nested at any depth", async () => {
    mkdirSync(join(root, "a", "b", "c"), { recursive: true });
    writeFileSync(join(root, "a", "b", "c", "deep.eap"), "");
    const res = await callTool("ea_find_models", { root });
    const data = res.json();
    expect(data.totalMatched).toBe(1);
    expect(data.models[0].relativePath).toBe("a/b/c/deep.eap");
  });

  it("matches .eap, .eapx and .qea case-insensitively, and ignores other extensions", async () => {
    writeFileSync(join(root, "one.EAP"), "");
    writeFileSync(join(root, "two.eapx"), "");
    writeFileSync(join(root, "three.QeA"), "");
    writeFileSync(join(root, "readme.txt"), "");
    const res = await callTool("ea_find_models", { root });
    const data = res.json();
    expect(data.totalMatched).toBe(3);
    expect(data.models.map((m: any) => m.fileName).sort()).toEqual(["one.EAP", "three.QeA", "two.eapx"]);
  });

  it("orders results by relativePath", async () => {
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "z.qea"), "");
    writeFileSync(join(root, "sub", "a.qea"), "");
    const res = await callTool("ea_find_models", { root });
    const data = res.json();
    expect(data.models.map((m: any) => m.relativePath)).toEqual(["sub/a.qea", "z.qea"]);
  });

  it("reports sizeBytes and lastModified", async () => {
    writeFileSync(join(root, "top.qea"), "hello");
    const res = await callTool("ea_find_models", { root });
    const data = res.json();
    expect(data.models[0].sizeBytes).toBe(5);
    expect(data.models[0].lastModified).toBeDefined();
    expect(new Date(data.models[0].lastModified).toString()).not.toBe("Invalid Date");
  });

  it("returns totalMatched:0 and an empty models array for a directory with no model files", async () => {
    writeFileSync(join(root, "readme.txt"), "");
    const res = await callTool("ea_find_models", { root });
    const data = res.json();
    expect(data.totalMatched).toBe(0);
    expect(data.models).toEqual([]);
  });

  it("returns a structured error when root does not exist", async () => {
    const res = await callTool("ea_find_models", { root: join(root, "does-not-exist") });
    expect(res.isError).toBe(true);
    expect(res.json().error).toBe("not_found");
  });

  it("returns a structured error when root is a file, not a directory", async () => {
    const filePath = join(root, "not-a-dir.qea");
    writeFileSync(filePath, "");
    const res = await callTool("ea_find_models", { root: filePath });
    expect(res.isError).toBe(true);
    expect(res.json().error).toBe("not_a_directory");
  });

  it("skips a directory it cannot read and reports it in unreadable", async () => {
    const locked = join(root, "locked");
    mkdirSync(locked);
    writeFileSync(join(root, "visible.qea"), "");
    chmodSync(locked, 0o000);
    try {
      const res = await callTool("ea_find_models", { root });
      const data = res.json();
      expect(data.totalMatched).toBe(1);
      expect(data.models[0].fileName).toBe("visible.qea");
      expect(data.unreadable).toHaveLength(1);
      expect(data.unreadable[0].path).toBe(locked);
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  it("does not follow a symlinked directory", async () => {
    const real = join(root, "real");
    mkdirSync(real);
    writeFileSync(join(real, "linked.qea"), "");
    symlinkSync(real, join(root, "link"));
    const res = await callTool("ea_find_models", { root });
    const data = res.json();
    expect(data.totalMatched).toBe(1);
    expect(data.models[0].relativePath).toBe("real/linked.qea");
  });

  it("windows results with offset/limit and reports continuation", async () => {
    for (let i = 0; i < 3; i++) writeFileSync(join(root, `m${i}.qea`), "");
    const first = await callTool("ea_find_models", { root, limit: 2 });
    const firstData = first.json();
    expect(firstData.returned).toBe(2);
    expect(firstData.totalMatched).toBe(3);
    expect(firstData.truncated).toBe(true);
    expect(firstData.continuation.tool).toBe("ea_find_models");
    expect(firstData.continuation.arguments.offset).toBe(2);

    const second = await callTool("ea_find_models", firstData.continuation.arguments);
    const secondData = second.json();
    expect(secondData.returned).toBe(1);
    expect(secondData.truncated).toBe(false);
    expect(secondData.continuation).toBeUndefined();
  });

  it("does not open or switch the currently open model", async () => {
    writeFileSync(join(root, "top.qea"), "");
    await callTool("ea_find_models", { root });
    const info = await callTool("ea_get_model_info", {});
    expect(info.json().fileName).toBe("test-model.qea");
  });
});
