import { existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Which configuration source supplied the path. */
export type QeaPathSource = "argument" | "environment" | "dotenv" | "remembered" | "prompt";

export interface QeaPathCandidate {
  source: QeaPathSource;
  /** The value as configured, before resolution or directory scanning. */
  configured: string;
}

export interface RejectedCandidate extends QeaPathCandidate {
  reason: string;
}

export interface QeaPathOrigin extends QeaPathCandidate {
  /** Higher-priority sources that were tried and could not be opened. */
  ignored: RejectedCandidate[];
  /** Lower-priority sources carrying a different value — a forgotten setting shows up here. */
  shadowed: QeaPathCandidate[];
}

/**
 * The configured sources in priority order, without touching the filesystem
 * beyond reading .env.
 *
 * An empty source counts as unset, so a skipped ${input:...} in VS Code
 * (substituted as "") drops out here.
 */
export function listQeaPathCandidates(cliArg?: string): QeaPathCandidate[] {
  const candidates: { source: QeaPathSource; configured: string | undefined }[] = [
    { source: "argument", configured: cliArg || undefined },
    { source: "environment", configured: process.env.EA_QEA_PATH || undefined },
    { source: "dotenv", configured: loadFromDotEnv() },
  ];

  return candidates.filter(
    (c): c is QeaPathCandidate => c.configured !== undefined
  );
}

/** Turns a configured value into a concrete model file path (.qea or .eap). */
export function resolveQeaTarget(target: string): string {
  const resolved = resolve(target);

  if (!existsSync(resolved)) {
    // Quoted so leading/trailing whitespace in the path is visible.
    throw new Error(`Path not found: "${resolved}"`);
  }

  if (statSync(resolved).isDirectory()) {
    return findNewestModel(resolved);
  }

  return resolved;
}

function findNewestModel(dir: string): string {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".qea") || f.endsWith(".eap") || f.endsWith(".eapx"))
    .map((f) => {
      const fullPath = join(dir, f);
      return { path: fullPath, mtime: statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    throw new Error(`No .qea or .eap files found in directory: "${dir}"`);
  }

  return files[0].path;
}

function loadFromDotEnv(): string | undefined {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return undefined;

  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed) continue;
    const match = trimmed.match(/^EA_QEA_PATH\s*=\s*(.+)$/);
    if (match) {
      return match[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}
