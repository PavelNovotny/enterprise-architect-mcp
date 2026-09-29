import { existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { listQeaPathCandidates, resolveQeaTarget } from "../src/resolve-qea-path";

jest.mock("node:fs");

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockStatSync = statSync as jest.MockedFunction<typeof statSync>;
const mockReaddirSync = readdirSync as jest.MockedFunction<typeof readdirSync>;
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

const originalEnv = process.env;

beforeEach(() => {
  jest.resetAllMocks();
  process.env = { ...originalEnv };
  delete process.env.EA_QEA_PATH;
});

afterAll(() => {
  process.env = originalEnv;
});

function mockFile(path: string) {
  mockExistsSync.mockImplementation((p) => p === path);
  mockStatSync.mockImplementation((p) => {
    if (p === path) return { isDirectory: () => false } as any;
    throw new Error(`ENOENT: ${p}`);
  });
}

function mockDir(dir: string, files: { name: string; mtime: number }[]) {
  mockExistsSync.mockImplementation((p) => {
    if (p === dir) return true;
    return files.some((f) => join(dir, f.name) === p);
  });
  mockStatSync.mockImplementation((p) => {
    if (p === dir) return { isDirectory: () => true } as any;
    const file = files.find((f) => join(dir, f.name) === String(p));
    if (file) return { isDirectory: () => false, mtimeMs: file.mtime } as any;
    throw new Error(`ENOENT: ${p}`);
  });
  mockReaddirSync.mockReturnValue(files.map((f) => f.name) as any);
}

/**
 * The chain is split in two: listing what is configured never touches the model,
 * and resolving a single value is what can fail. Tests follow that split, since
 * `ModelSession` walks the list itself and resolves one candidate at a time.
 */
function firstConfigured(cliArg?: string): string {
  const [first] = listQeaPathCandidates(cliArg);
  if (!first) throw new Error("No .qea path provided.");
  return first.configured;
}

/** The path the old single-shot resolver would have produced: first configured, then resolved. */
function resolveFirst(cliArg?: string): string {
  return resolveQeaTarget(firstConfigured(cliArg));
}

describe("listQeaPathCandidates", () => {
  it("uses CLI arg when provided (file)", () => {
    const abs = resolve("model.qea");
    mockFile(abs);
    expect(resolveFirst("model.qea")).toBe(abs);
  });

  it("falls back to EA_QEA_PATH env var", () => {
    const abs = resolve("/exports/model.qea");
    process.env.EA_QEA_PATH = "/exports/model.qea";
    mockFile(abs);
    expect(resolveFirst()).toBe(abs);
  });

  it("falls back to .env file", () => {
    const abs = resolve("/my/path/export.qea");
    const envPath = join(process.cwd(), ".env");
    mockExistsSync.mockImplementation((p) => p === envPath || p === abs);
    mockStatSync.mockImplementation((p) => {
      if (p === abs) return { isDirectory: () => false } as any;
      throw new Error(`ENOENT: ${p}`);
    });
    mockReadFileSync.mockReturnValue(
      '# comment\nOTHER=val\nEA_QEA_PATH="/my/path/export.qea"\n'
    );
    expect(resolveFirst()).toBe(abs);
  });

  it("lists every configured source, in priority order", () => {
    const envPath = join(process.cwd(), ".env");
    process.env.EA_QEA_PATH = "/env/path.qea";
    mockExistsSync.mockImplementation((p) => p === envPath);
    mockReadFileSync.mockReturnValue("EA_QEA_PATH=/dotenv/path.qea\n");

    expect(listQeaPathCandidates("cli.qea")).toEqual([
      { source: "argument", configured: "cli.qea" },
      { source: "environment", configured: "/env/path.qea" },
      { source: "dotenv", configured: "/dotenv/path.qea" },
    ]);
  });

  it("yields nothing when no source provides a path", () => {
    mockExistsSync.mockReturnValue(false);
    expect(listQeaPathCandidates()).toEqual([]);
    expect(() => resolveFirst()).toThrow("No .qea path provided");
  });

  it("treats an empty env var as unset and falls back to .env", () => {
    const abs = resolve("/my/path/export.qea");
    const envPath = join(process.cwd(), ".env");
    process.env.EA_QEA_PATH = "";
    mockExistsSync.mockImplementation((p) => p === envPath || p === abs);
    mockStatSync.mockImplementation((p) => {
      if (p === abs) return { isDirectory: () => false } as any;
      throw new Error(`ENOENT: ${p}`);
    });
    mockReadFileSync.mockReturnValue("EA_QEA_PATH=/my/path/export.qea\n");
    expect(resolveFirst()).toBe(abs);
  });

  it("CLI arg takes priority over env var", () => {
    const cliPath = resolve("cli.qea");
    process.env.EA_QEA_PATH = "/env/path.qea";
    mockFile(cliPath);
    expect(resolveFirst("cli.qea")).toBe(cliPath);
  });

  it("strips quotes from .env value", () => {
    const abs = resolve("/path/model.qea");
    const envPath = join(process.cwd(), ".env");
    mockExistsSync.mockImplementation((p) => p === envPath || p === abs);
    mockStatSync.mockImplementation((p) => {
      if (p === abs) return { isDirectory: () => false } as any;
      throw new Error(`ENOENT: ${p}`);
    });
    mockReadFileSync.mockReturnValue("EA_QEA_PATH='/path/model.qea'\n");
    expect(resolveFirst()).toBe(abs);
  });
});

describe("resolveQeaTarget", () => {
  it("keeps whitespace significant — a space is a legal filename character", () => {
    const abs = resolve("/exports/  spaced.qea");
    mockFile(abs);
    expect(resolveQeaTarget("/exports/  spaced.qea")).toBe(abs);
  });

  it("throws when resolved path does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(() => resolveQeaTarget("missing.qea")).toThrow("Path not found");
  });

  it("quotes the path so edge whitespace is visible", () => {
    mockExistsSync.mockReturnValue(false);
    expect(() => resolveQeaTarget("/exports/model.qea   ")).toThrow(
      `Path not found: "${resolve("/exports/model.qea   ")}"`
    );
  });

  it("picks newest .qea from directory", () => {
    const dir = resolve("/exports");
    mockDir(dir, [
      { name: "old.qea", mtime: 1000 },
      { name: "newest.qea", mtime: 3000 },
      { name: "mid.qea", mtime: 2000 },
    ]);
    expect(resolveQeaTarget("/exports")).toBe(join(dir, "newest.qea"));
  });

  it("throws when directory has no model files", () => {
    const dir = resolve("/empty");
    mockDir(dir, []);
    expect(() => resolveQeaTarget("/empty")).toThrow("No .qea or .eap files found");
  });

  it("ignores non-.qea files in directory", () => {
    const dir = resolve("/mixed");
    mockDir(dir, [
      { name: "notes.txt", mtime: 9000 },
      { name: "model.qea", mtime: 1000 },
    ]);
    expect(resolveQeaTarget("/mixed")).toBe(join(dir, "model.qea"));
  });
});
