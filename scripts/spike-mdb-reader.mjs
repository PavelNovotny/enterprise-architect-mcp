/**
 * ADR-0001 Spike: Can mdb-reader open and query a real .EAP file?
 *
 * Tests:
 * 1. File opens read-only
 * 2. Expected EA tables are present
 * 3. Representative queries return correct rows
 * 4. Read performance is acceptable for interactive agent use
 * 5. Table-level access can substitute for SQL where the tools need it
 */

import { readFileSync } from "node:fs";
import MDBReader from "mdb-reader";

const EAP_PATH = "/Users/pavelnovotny/Arch-DD/o2integration/DD/HC-ADAPTER/HC-ADAPTER_Detail-design.EAP";

const EXPECTED_TABLES = [
  "t_object",
  "t_package",
  "t_connector",
  "t_diagram",
  "t_diagramobjects",
  "t_diagramlinks",
  "t_objectconstraint",
  "t_objectproperties",
  "t_objectoperations",
  "t_objectparams",
  "t_objectproblems",
  "t_objectefforts",
  "t_objectfiles",
  "t_attribute",
  "t_operation",
  "t_operationparams",
  "t_scenarios",
  "t_secroles",
  "t_secuserpermission",
  "t_secpolperms",
];

function hr(label) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(label);
  console.log("─".repeat(60));
}

// ── 1. Open the file ──────────────────────────────────────────────
hr("1. Open file read-only");
let reader;
try {
  const buffer = readFileSync(EAP_PATH);
  console.log(`File size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
  reader = new MDBReader(buffer);
  console.log("Opened successfully.");
} catch (err) {
  console.error("FAILED to open:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// ── 2. List tables ────────────────────────────────────────────────
hr("2. List tables");
let allTables;
try {
  allTables = reader.getTableNames();
  console.log(`Total tables found: ${allTables.length}`);
  console.log("All tables:", allTables.join(", "));
} catch (err) {
  console.error("FAILED to list tables:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// ── 3. Check expected EA tables ───────────────────────────────────
hr("3. Check expected EA tables");
const found = [];
const missing = [];
for (const expected of EXPECTED_TABLES) {
  // mdb-reader table names are case-sensitive; EA uses lowercase
  const match = allTables.find((t) => t.toLowerCase() === expected.toLowerCase());
  if (match) {
    found.push(match);
  } else {
    missing.push(expected);
  }
}
console.log(`Found:   ${found.length}/${EXPECTED_TABLES.length}`);
console.log(`Missing: ${missing.length}`);
if (missing.length > 0) {
  console.log("Missing tables:", missing.join(", "));
}

// ── 4. Query representative tables ────────────────────────────────
hr("4. Query representative tables");

function safeGetTable(name) {
  try {
    return reader.getTable(name);
  } catch (err) {
    console.log(`  ${name}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// t_object — core element table
const tObject = safeGetTable("t_object");
if (tObject) {
  console.log(`\nt_object:`);
  console.log(`  rowCount: ${tObject.rowCount}`);
  const cols = tObject.getColumnNames();
  console.log(`  columns (${cols.length}): ${cols.join(", ")}`);
  const rows = tObject.getData({ rowLimit: 5 });
  console.log(`  first 5 rows:`);
  for (const row of rows) {
    console.log(
      `    Object_ID=${row.Object_ID}, Name=${row.Name}, Object_Type=${row.Object_Type}`
    );
  }
}

// t_package — package hierarchy
const tPackage = safeGetTable("t_package");
if (tPackage) {
  console.log(`\nt_package:`);
  console.log(`  rowCount: ${tPackage.rowCount}`);
  const cols = tPackage.getColumnNames();
  console.log(`  columns (${cols.length}): ${cols.join(", ")}`);
  const rows = tPackage.getData({ rowLimit: 5 });
  console.log(`  first 5 rows:`);
  for (const row of rows) {
    console.log(
      `    Package_ID=${row.Package_ID}, Name=${row.Name}, Parent_ID=${row.Parent_ID}`
    );
  }
}

// t_connector — relationships
const tConnector = safeGetTable("t_connector");
if (tConnector) {
  console.log(`\nt_connector:`);
  console.log(`  rowCount: ${tConnector.rowCount}`);
  const cols = tConnector.getColumnNames();
  console.log(`  columns (${cols.length}): ${cols.join(", ")}`);
  const rows = tConnector.getData({ rowLimit: 5 });
  console.log(`  first 5 rows:`);
  for (const row of rows) {
    console.log(
      `    Connector_ID=${row.Connector_ID}, Name=${row.Name}, Type=${row.Connector_Type}`
    );
  }
}

// t_diagram — diagrams
const tDiagram = safeGetTable("t_diagram");
if (tDiagram) {
  console.log(`\nt_diagram:`);
  console.log(`  rowCount: ${tDiagram.rowCount}`);
  const cols = tDiagram.getColumnNames();
  console.log(`  columns (${cols.length}): ${cols.join(", ")}`);
  const rows = tDiagram.getData({ rowLimit: 5 });
  console.log(`  first 5 rows:`);
  for (const row of rows) {
    console.log(
      `    Diagram_ID=${row.Diagram_ID}, Name=${row.Name}, Diagram_Type=${row.Diagram_Type}`
    );
  }
}

// ── 5. Performance — full table scan ──────────────────────────────
hr("5. Performance — full table read (t_object)");
if (tObject) {
  const start = performance.now();
  const allRows = tObject.getData();
  const elapsed = performance.now() - start;
  console.log(`Rows: ${allRows.length}`);
  console.log(`Time: ${elapsed.toFixed(1)} ms`);
  console.log(`Per row: ${(elapsed / allRows.length).toFixed(3)} ms`);
}

// ── 6. Simulate a filtered query (SQL WHERE equivalent) ───────────
hr("6. Simulate SQL WHERE via in-memory filter");
if (tObject) {
  // Current code: SELECT * FROM t_object WHERE Object_Type = 'UseCase' LIMIT 10
  const start = performance.now();
  const allRows = tObject.getData();
  const useCases = allRows
    .filter((r) => r.Object_Type === "UseCase")
    .slice(0, 10);
  const elapsed = performance.now() - start;
  console.log(`SELECT * FROM t_object WHERE Object_Type = 'UseCase' LIMIT 10`);
  console.log(`Results: ${useCases.length}`);
  console.log(`Time (full scan + filter): ${elapsed.toFixed(1)} ms`);
  if (useCases.length > 0) {
    console.log(`First:`, useCases[0]);
  }
}

// ── 7. Simulate a JOIN ────────────────────────────────────────────
hr("7. Simulate SQL JOIN (t_object → t_connector by Object_ID)");
if (tObject && tConnector) {
  const start = performance.now();
  const objects = tObject.getData();
  const connectors = tConnector.getData();
  const objectMap = new Map();
  for (const obj of objects) {
    objectMap.set(obj.Object_ID, obj);
  }
  // Find connectors where Start_Object_ID matches an object
  const joined = connectors
    .filter((c) => objectMap.has(c.Start_Object_ID))
    .slice(0, 5)
    .map((c) => ({
      connectorName: c.Name,
      connectorType: c.Connector_Type,
      startObject: objectMap.get(c.Start_Object_ID)?.Name,
      endObjectId: c.End_Object_ID,
    }));
  const elapsed = performance.now() - start;
  console.log(`JOIN t_object ON t_connector.Start_Object_ID = t_object.Object_ID`);
  console.log(`Results (first 5): ${joined.length}`);
  console.log(`Time: ${elapsed.toFixed(1)} ms`);
  if (joined.length > 0) {
    console.log(`First:`, joined[0]);
  }
}

// ── 8. Column type analysis ───────────────────────────────────────
hr("8. Column type analysis (t_object)");
if (tObject) {
  const columns = tObject.getColumns();
  for (const col of columns) {
    console.log(`  ${col.name}: type=${col.type}, size=${col.size}, nullable=${col.nullable}`);
  }
}

// ── Summary ───────────────────────────────────────────────────────
hr("SUMMARY");
console.log(`File opened:           YES`);
console.log(`Tables found:          ${found.length}/${EXPECTED_TABLES.length}`);
console.log(`Missing tables:        ${missing.length > 0 ? missing.join(", ") : "none"}`);
console.log(`SQL support:           NO — mdb-reader is table-only (getData)`);
console.log(`WHERE / JOIN / ORDER:  Must be done in-memory (JavaScript)`);
console.log(`PRAGMA cache:          N/A — no SQLite engine`);
