import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";
import { convertEapToSqlite } from "./eap-converter.js";

export type Database = DatabaseSync;

/** The original path of the opened file, which may differ from the SQLite DB path when an .EAP was converted. */
let originalPath: string | undefined;

/** Returns the original file path — the .qea path or the .EAP path, not a temp SQLite file. */
export function getOriginalPath(): string | undefined {
  return originalPath;
}

/** Resets the original path tracking — for testing. */
export function resetOriginalPath(): void {
  originalPath = undefined;
}

export function openDatabase(path: string): Database {
  if (!existsSync(path)) {
    throw new Error(`QEA file not found: "${path}"`);
  }

  // Route .EAP files through the converter; everything else opens as SQLite (.qea)
  if (isEapFile(path)) {
    originalPath = path;
    const { db } = convertEapToSqlite(path);

    // Sanity check: verify the converted DB has t_object
    try {
      db.prepare("SELECT COUNT(*) FROM t_object").get();
    } catch {
      db.close();
      throw new Error(
        `File is not a valid Enterprise Architect export (missing t_object table): "${path}"`
      );
    }

    db.exec("PRAGMA cache_size = -64000");
    return db;
  }

  originalPath = path;
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (err) {
    throw new Error(
      `Failed to open database: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Sanity check: verify it's an EA export
  try {
    db.prepare("SELECT COUNT(*) FROM t_object").get();
  } catch {
    db.close();
    throw new Error(
      `File is not a valid Enterprise Architect export (missing t_object table): "${path}"`
    );
  }

  // Performance: increase cache
  db.exec("PRAGMA cache_size = -64000"); // 64MB cache

  return db;
}

function isEapFile(path: string): boolean {
  const lower = path.toLowerCase();
  // .eap is JET3, .eapx is JET4 — both need conversion
  return lower.endsWith(".eap") || lower.endsWith(".eapx");
}
