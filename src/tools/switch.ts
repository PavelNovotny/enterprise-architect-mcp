import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ModelAccess } from "../model-session.js";
import { getOriginalPath } from "../database.js";
import { READ_ONLY } from "./annotations.js";
import { buildPackagePath } from "../package-path.js";
import { z } from "zod";
import { statSync } from "node:fs";

const MAX_PACKAGES = 200;
const MAX_DIAGRAMS = 100;

export function configureSwitchTools(server: McpServer, model: ModelAccess): void {
  server.tool(
    "ea_switch_model",
    "Switch the EA model to a different .eap or .qea file at runtime — no server restart needed. Closes the current database, opens the new file, and returns the new model's overview (fileName, elementCount, package tree, diagrams). The path can be a direct file path or a directory containing a model file (the newest is used). The switch is session-only — not persisted to .env or config.",
    {
      path: z.string().describe("Path to a .eap/.qea file or a directory containing one"),
    },
    READ_ONLY,
    async ({ path }) => {
      try {
        const db = await model.switchModel(path);
        const location = getOriginalPath() ?? (db as any).location() as string | null;
        const stat = location ? statSync(location) : null;
        const fileName = location ? location.replace(/\\/g, "/").split("/").pop() ?? location : null;

        // Total element count
        const elementCount = (db.prepare("SELECT COUNT(*) as cnt FROM t_object").get() as { cnt: number }).cnt;

        // Package tree (top 3 levels)
        let packageCount = 0;
        function getChildren(pid: number, currentDepth: number): any[] {
          if (currentDepth <= 0 || packageCount >= MAX_PACKAGES) return [];
          const packages = db.prepare(`
            SELECT p.Package_ID, p.Name, p.Parent_ID
            FROM t_package p
            WHERE p.Parent_ID = ?
            ORDER BY p.TPos, p.Name
          `).all(pid) as any[];

          const result: any[] = [];
          for (const pkg of packages) {
            if (packageCount >= MAX_PACKAGES) break;
            packageCount++;
            const countRow = db.prepare("SELECT COUNT(*) as cnt FROM t_object WHERE Package_ID = ?").get(pkg.Package_ID) as { cnt: number };
            const node: any = {
              id: pkg.Package_ID,
              name: pkg.Name,
              parentId: pkg.Parent_ID,
              elementCount: countRow.cnt,
            };
            const children = getChildren(pkg.Package_ID, currentDepth - 1);
            if (children.length > 0) node.children = children;
            result.push(node);
          }
          return result;
        }

        const packageTree = getChildren(0, 3);

        // Diagrams
        const diagramRows = db.prepare(`
          SELECT d.Diagram_ID, d.Name, d.Diagram_Type, d.Package_ID, d.ea_guid
          FROM t_diagram d
          ORDER BY d.Diagram_ID
          LIMIT ?
        `).all(MAX_DIAGRAMS + 1) as any[];

        const diagramsTruncated = diagramRows.length > MAX_DIAGRAMS;
        const diagrams = diagramRows.slice(0, MAX_DIAGRAMS).map((d) => ({
          diagramId: d.Diagram_ID,
          name: d.Name,
          type: d.Diagram_Type,
          packageId: d.Package_ID,
          packagePath: buildPackagePath(db, d.Package_ID),
          eaGuid: d.ea_guid,
        }));

        const result = {
          fileName,
          fileSizeBytes: stat?.size ?? null,
          lastModified: stat?.mtime.toISOString() ?? null,
          elementCount,
          packages: packageTree,
          packagesTruncated: packageCount >= MAX_PACKAGES,
          diagrams,
          diagramsTruncated,
          _meta: { sourceTables: ["t_object", "t_package", "t_diagram"] },
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error switching model: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
