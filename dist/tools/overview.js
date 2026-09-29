import { getOriginalPath } from "../database.js";
import { READ_ONLY } from "./annotations.js";
import { buildPackagePath } from "../package-path.js";
import { statSync } from "node:fs";
import { packageVersion } from "../version.js";
const MAX_PACKAGES = 200;
const MAX_DIAGRAMS = 100;
export function configureOverviewTools(server, model) {
    server.tool("ea_get_model_overview", "One-call model orientation: returns model identity (fileName, fileSizeBytes, lastModified, serverVersion), the full package tree with element counts (capped at 200 packages), all diagrams with their package paths (capped at 100), and the total element count. Use this first when opening a new model — then drill into specific packages or diagrams with the individual tools.", {}, READ_ONLY, async () => {
        const db = await model.database();
        try {
            // Model identity
            const location = getOriginalPath() ?? db.location();
            const stat = location ? statSync(location) : null;
            const fileName = location ? location.replace(/\\/g, "/").split("/").pop() ?? location : null;
            // Total element count
            const elementCount = db.prepare("SELECT COUNT(*) as cnt FROM t_object").get().cnt;
            // Package tree (recursive)
            let packageCount = 0;
            function getChildren(pid, currentDepth) {
                if (currentDepth <= 0 || packageCount >= MAX_PACKAGES)
                    return [];
                const packages = db.prepare(`
            SELECT p.Package_ID, p.Name, p.Parent_ID
            FROM t_package p
            WHERE p.Parent_ID = ?
            ORDER BY p.TPos, p.Name
          `).all(pid);
                const result = [];
                for (const pkg of packages) {
                    if (packageCount >= MAX_PACKAGES)
                        break;
                    packageCount++;
                    const countRow = db.prepare("SELECT COUNT(*) as cnt FROM t_object WHERE Package_ID = ?").get(pkg.Package_ID);
                    const node = {
                        id: pkg.Package_ID,
                        name: pkg.Name,
                        parentId: pkg.Parent_ID,
                        elementCount: countRow.cnt,
                    };
                    const children = getChildren(pkg.Package_ID, currentDepth - 1);
                    if (children.length > 0)
                        node.children = children;
                    result.push(node);
                }
                return result;
            }
            const packagesTruncated = packageCount >= MAX_PACKAGES;
            const packageTree = getChildren(0, 3);
            // Diagrams (capped)
            const diagramRows = db.prepare(`
          SELECT d.Diagram_ID, d.Name, d.Diagram_Type, d.Package_ID, d.ea_guid
          FROM t_diagram d
          ORDER BY d.Diagram_ID
          LIMIT ?
        `).all(MAX_DIAGRAMS + 1);
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
                serverVersion: packageVersion,
                elementCount,
                packages: packageTree,
                packagesTruncated,
                diagrams,
                diagramsTruncated,
                ...(packagesTruncated && { message: `Package tree truncated at ${MAX_PACKAGES} packages. Use ea_get_package_tree with a specific packageId to drill deeper.` }),
                ...(diagramsTruncated && { diagramsMessage: `Diagram list truncated at ${MAX_DIAGRAMS}. Use ea_list_diagrams with filters to page.` }),
                _meta: { sourceTables: ["t_object", "t_package", "t_diagram"] },
            };
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `Error generating model overview: ${msg}` }],
                isError: true,
            };
        }
    });
}
