import { readFileSync, existsSync, mkdtempSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import MDBReader from "mdb-reader";
import type { Column } from "mdb-reader";

/**
 * EAP (JET3/MDB) → SQLite conversion.
 *
 * mdb-reader opens the .EAP file from a Buffer and provides table-level access
 * (getTable / getData) with no SQL engine. This converter reads every table
 * and writes it into a temporary SQLite database, which the rest of the server
 * then queries via node:sqlite as if it were a .qea file.
 */

/** Tables whose names differ between EAP and QEA. Key = EAP name, value = name the tools expect. */
const TABLE_NAME_MAP: Record<string, string> = {
  t_objectoperations: "t_operation",
  t_objectparams: "t_operationparams",
  t_objectefforts: "t_objecteffort",
  t_scenarios: "t_objectscenarios",
  t_secroles: "t_secgroup",
  t_secpolperms: "t_secpolicies",
};

/** MDB column type → SQLite column type. */
function mdbTypeToSqlite(col: Column): string {
  switch (col.type) {
    case "bigint":
      return "INTEGER";
    case "boolean":
      return "INTEGER";
    case "byte":
      return "INTEGER";
    case "integer":
      return "INTEGER";
    case "long":
      return "INTEGER";
    case "double":
      return "REAL";
    case "float":
      return "REAL";
    case "numeric":
      return "NUMERIC";
    case "text":
      return "TEXT";
    case "memo":
      return "TEXT";
    case "datetime":
      return "TEXT";  // store as ISO string
    case "datetimextended":
      return "TEXT";
    case "currency":
      return "TEXT";
    case "repid":
      return "TEXT";
    case "binary":
      return "BLOB";
    case "ole":
      return "BLOB";
    case "complex":
      return "TEXT";
    default:
      return "TEXT";
  }
}

/** Convert an MDB value to a SQLite-compatible value. */
function mdbValueToSqlite(value: unknown, colType: string): SQLInputValue {
  if (value === null || value === undefined) return null;
  switch (colType) {
    case "boolean":
      // mdb-reader returns boolean; SQLite stores 0/1
      return value ? 1 : 0;
    case "datetime":
      // mdb-reader returns Date; store as ISO string
      return value instanceof Date ? value.toISOString() : String(value);
    case "datetimextended":
      return value instanceof Date ? value.toISOString() : String(value);
    case "bigint":
      return Number(value);
    case "binary":
    case "ole":
      return value as Buffer;
    default:
      return value as SQLInputValue;
  }
}

/**
 * Converts an .EAP file to a temporary SQLite database and returns the open
 * DatabaseSync handle. The caller is responsible for closing the database;
 * the temp file is deleted when the database is closed.
 */
export function convertEapToSqlite(eapPath: string): { db: DatabaseSync; tempPath: string } {
  if (!existsSync(eapPath)) {
    throw new Error(`EAP file not found: "${eapPath}"`);
  }

  let reader: MDBReader;
  try {
    const buffer = readFileSync(eapPath);
    reader = new MDBReader(buffer);
  } catch (err) {
    throw new Error(
      `Failed to read EAP file: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Sanity check: verify it's an EA project
  const tableNames = reader.getTableNames();
  if (!tableNames.some((t) => t.toLowerCase() === "t_object")) {
    throw new Error(
      `File is not a valid Enterprise Architect project (missing t_object table): "${eapPath}"`
    );
  }

  // Create temp SQLite database
  const tempDir = mkdtempSync(join(tmpdir(), "eap-convert-"));
  const tempPath = join(tempDir, "converted.eap.sqlite");
  const db = new DatabaseSync(tempPath);

  try {
    db.exec("PRAGMA journal_mode = MEMORY");
    db.exec("PRAGMA synchronous = OFF");

    for (const eapTableName of tableNames) {
      const sqliteTableName = TABLE_NAME_MAP[eapTableName] ?? eapTableName;

      let table;
      try {
        table = reader.getTable(eapTableName);
      } catch {
        // Some system tables may fail to read; skip them
        continue;
      }

      const columns = table.getColumns();
      const columnNames = columns.map((c) => c.name);

      // Create table with SQLite types
      const columnDefs = columns
        .map((c) => `"${c.name}" ${mdbTypeToSqlite(c)}`)
        .join(", ");
      db.exec(`CREATE TABLE "${sqliteTableName}" (${columnDefs})`);

      // Insert all rows in batches
      const placeholders = columnNames.map(() => "?").join(", ");
      const insertSql = `INSERT INTO "${sqliteTableName}" (${columnNames.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`;
      const stmt = db.prepare(insertSql);

      const BATCH_SIZE = 500;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const rows = table.getData({ rowOffset: offset, rowLimit: BATCH_SIZE });
        if (rows.length === 0) {
          hasMore = false;
          break;
        }

        db.exec("BEGIN");
        for (const row of rows) {
          const values = columns.map((c) => mdbValueToSqlite(row[c.name], c.type));
          stmt.run(...values);
        }
        db.exec("COMMIT");

        offset += rows.length;
        if (rows.length < BATCH_SIZE) hasMore = false;
      }
    }

    // Performance: set cache after conversion
    db.exec("PRAGMA cache_size = -64000");
  } catch (err) {
    db.close();
    try {
      unlinkSync(tempPath);
    } catch { /* best effort */ }
    throw new Error(
      `Failed to convert EAP to SQLite: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return { db, tempPath };
}
