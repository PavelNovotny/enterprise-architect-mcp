import { openDatabase, getOriginalPath, resetOriginalPath } from "../src/database";
import { convertEapToSqlite } from "../src/eap-converter";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

const EAP_PATH = "/Users/pavelnovotny/Arch-DD/o2integration/DD/HC-ADAPTER/HC-ADAPTER_Detail-design.EAP";
const EAP_EXISTS = existsSync(EAP_PATH);

describe("eap-converter", () => {
  describe("convertEapToSqlite", () => {
    // Only run if the real .EAP file is available on this machine
    const itOrSkip = EAP_EXISTS ? it : it.skip;

    itOrSkip("converts a real .EAP file to a SQLite database", () => {
      const { db, tempPath } = convertEapToSqlite(EAP_PATH);

      expect(db).toBeInstanceOf(DatabaseSync);
      expect(existsSync(tempPath)).toBe(true);

      // Core tables must be present
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain("t_object");
      expect(tableNames).toContain("t_package");
      expect(tableNames).toContain("t_connector");
      expect(tableNames).toContain("t_diagram");
    });

    itOrSkip("converts table data with correct row counts", () => {
      const { db } = convertEapToSqlite(EAP_PATH);

      const objCount = db.prepare("SELECT COUNT(*) as cnt FROM t_object").get() as { cnt: number };
      expect(objCount.cnt).toBeGreaterThan(0);

      const pkgCount = db.prepare("SELECT COUNT(*) as cnt FROM t_package").get() as { cnt: number };
      expect(pkgCount.cnt).toBeGreaterThan(0);

      const connCount = db.prepare("SELECT COUNT(*) as cnt FROM t_connector").get() as { cnt: number };
      expect(connCount.cnt).toBeGreaterThan(0);
    });

    itOrSkip("applies table name mapping (t_objectscenarios → t_scenarios)", () => {
      const { db } = convertEapToSqlite(EAP_PATH);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);

      // EAP name t_objectscenarios should be mapped to t_scenarios
      expect(tableNames).toContain("t_scenarios");
      expect(tableNames).not.toContain("t_objectscenarios");
    });

    itOrSkip("data is queryable with SQL", () => {
      const { db } = convertEapToSqlite(EAP_PATH);

      const rows = db
        .prepare("SELECT Object_ID, Name, Object_Type FROM t_object ORDER BY Object_ID LIMIT 5")
        .all() as { Object_ID: number; Name: string; Object_Type: string }[];

      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toHaveProperty("Object_ID");
      expect(rows[0]).toHaveProperty("Name");
      expect(rows[0]).toHaveProperty("Object_Type");
    });

    itOrSkip("JOINs work on converted data", () => {
      const { db } = convertEapToSqlite(EAP_PATH);

      const rows = db
        .prepare(
          `SELECT o.Name, o.Object_Type, p.Name as PackageName
           FROM t_object o
           LEFT JOIN t_package p ON o.Package_ID = p.Package_ID
           LIMIT 5`
        )
        .all() as { Name: string; Object_Type: string; PackageName: string | null }[];

      expect(rows.length).toBeGreaterThan(0);
    });

    itOrSkip("throws for non-existent file", () => {
      expect(() => convertEapToSqlite("/nonexistent/file.eap")).toThrow("EAP file not found");
    });
  });

  describe("openDatabase with EAP routing", () => {
    const itOrSkip = EAP_EXISTS ? it : it.skip;

    beforeEach(() => {
      resetOriginalPath();
    });

    itOrSkip("opens an .EAP file through the converter", () => {
      const db = openDatabase(EAP_PATH);

      expect(db).toBeInstanceOf(DatabaseSync);

      // The original path should be the .EAP file, not a temp SQLite file
      expect(getOriginalPath()).toBe(EAP_PATH);

      // Data must be accessible
      const row = db.prepare("SELECT COUNT(*) as cnt FROM t_object").get() as { cnt: number };
      expect(row.cnt).toBeGreaterThan(0);

      db.close();
      resetOriginalPath();
    });

    itOrSkip("openDatabase sets originalPath to .EAP path", () => {
      const db = openDatabase(EAP_PATH);
      expect(getOriginalPath()).toBe(EAP_PATH);
      db.close();
      resetOriginalPath();
    });
  });
});
