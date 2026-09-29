import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "../database.js";
import { getOriginalPath } from "../database.js";
import { describeSource, type ModelAccess } from "../model-session.js";
import { READ_ONLY } from "./annotations.js";
import { z } from "zod";
import { statSync } from "node:fs";
import { packageVersion } from "../version.js";

export function configureSchemaTools(server: McpServer, model: ModelAccess): void {
  server.tool(
    "ea_get_schema",
    "List the model's database tables in `tables`, or pass a `tableName` to get that table's `columns` and `indexes` instead. That form echoes the `table` name and adds `rowidAlias` — the INTEGER PRIMARY KEY aliasing SQLite's rowid, so the fastest lookup path, or null when the table has none — with `rowidNote` saying which case applies. Use this to discover what data the model holds beyond what the typed ea_* tools return. See ea_get_model_info for the export's identity.",
    {
      tableName: z
        .string()
        .optional()
        .describe("Table name to inspect. Omit to list all tables with row counts."),
    },
    READ_ONLY,
    async ({ tableName }) => {
      const db = await model.database();
      try {
        if (!tableName) {
          const tables = db
            .prepare(
              `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
            )
            .all() as { name: string }[];

          const result = tables.map((t) => {
            const row = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get() as { cnt: number };
            return { table: t.name, rowCount: row.cnt };
          });

          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              tables: result,
              totalMatched: result.length,
              returned: result.length,
              truncated: false,
              _meta: { sourceTables: ["sqlite_master"] },
            }, null, 2) }],
          };
        }

        // Verify table exists
        const exists = db
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
          .get(tableName) as { name: string } | undefined;
        if (!exists) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found", message: `Table '${tableName}' not found`, tableName }, null, 2) }],
            isError: true,
          };
        }

        // Columns — tableName is validated against sqlite_master above
        const safeTableName = exists.name;
        const columns = db.prepare(`PRAGMA table_info("${safeTableName}")`).all() as {
          cid: number;
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
        }[];

        // Rowid alias detection: exactly one column with pk > 0 and declared type INTEGER (case-insensitive)
        const pkColumns = columns.filter((c) => c.pk > 0);
        const rowidAlias =
          pkColumns.length === 1 && pkColumns[0].type.toUpperCase() === "INTEGER"
            ? pkColumns[0].name
            : null;

        // Indexes
        const indexList = db.prepare(`PRAGMA index_list("${safeTableName}")`).all() as {
          seq: number;
          name: string;
          unique: number;
          origin: string;
        }[];

        const indexes = indexList.map((idx) => {
          const indexCols = db.prepare(`PRAGMA index_info("${idx.name}")`).all() as {
            seqno: number;
            cid: number;
            name: string;
          }[];
          return {
            name: idx.name,
            unique: idx.unique === 1,
            columns: indexCols.map((c) => c.name),
          };
        });

        const result: Record<string, unknown> = {
          table: tableName,
          columns: columns.map((c) => ({
            name: c.name,
            type: c.type,
            notNull: c.notnull === 1,
            primaryKey: c.pk > 0,
            defaultValue: c.dflt_value,
          })),
          indexes,
          _meta: {
            sourceTables: ["sqlite_master"],
            columns: { totalMatched: columns.length, returned: columns.length, truncated: false },
            indexes: { totalMatched: indexes.length, returned: indexes.length, truncated: false },
          },
        };

        if (rowidAlias) {
          result.rowidAlias = rowidAlias;
          result.rowidNote =
            "This column is an INTEGER PRIMARY KEY that aliases SQLite's internal rowid. Lookups by this column are the fastest access path.";
        } else {
          result.rowidAlias = null;
          result.rowidNote = "This table has no single-column INTEGER PRIMARY KEY rowid alias.";
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error reading schema: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "ea_get_model_info",
    "Report which .qea export file the server has open: `fileName` is the citable identity, alongside `fileSizeBytes`, `lastModified`, and the `serverVersion` that produced the answer. The full local path is also returned as `resolvedPath`, with `resolvedPathNote` explaining why it is environment detail rather than something to cite. `configuration` says where that path came from — `source` in words, `sourceId` as one of argument/environment/dotenv/remembered/prompt, and the `configured` value behind it — plus any `skipped` settings, each with the `reason` it could not be opened, and `shadowed` ones a higher-priority source outranked; `configurationNote` says how much of that is safe to repeat.",
    {},
    READ_ONLY,
    async () => {
      const db = await model.database();
      try {
        // For .eap files, the database is a temp SQLite file — report the original path instead.
        const location = getOriginalPath() ?? (db as any).location() as string | null;
        if (!location) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Model info unavailable: database has no file location (in-memory database).",
              },
            ],
            isError: true,
          };
        }

        const stat = statSync(location);
        const fileName = location.replace(/\\/g, "/").split("/").pop() ?? location;
        const origin = model.origin();

        const result = {
          fileName,
          fileSizeBytes: stat.size,
          lastModified: stat.mtime.toISOString(),
          serverVersion: packageVersion,
          resolvedPath: location,
          resolvedPathNote:
            "The resolved path is local detail — it may contain user-specific directories. Use fileName, size, and lastModified as the citable identity.",
          ...(origin && {
            configuration: {
              source: describeSource(origin.source),
              sourceId: origin.source,
              configured: origin.configured,
              skipped: origin.ignored.map((entry) => ({
                source: describeSource(entry.source),
                sourceId: entry.source,
                configured: entry.configured,
                reason: entry.reason,
              })),
              shadowed: origin.shadowed.map((entry) => ({
                source: describeSource(entry.source),
                sourceId: entry.source,
                configured: entry.configured,
              })),
            },
            configurationNote:
              "Everything under configuration is local environment detail: configured values are filesystem paths and each skipped reason quotes one in full. Repeat them only when explaining a configuration problem to the user who owns the machine, never as model identity.",
          }),
          _meta: { sourceTables: [] as string[] },
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error reading model info: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
