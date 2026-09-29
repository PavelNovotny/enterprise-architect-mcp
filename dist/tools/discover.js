import { READ_ONLY } from "./annotations.js";
import { z } from "zod";
import { existsSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { buildContinuation, isTruncated, limitParam, offsetParam } from "./windowing.js";
const MODEL_EXTENSIONS = new Set([".eap", ".eapx", ".qea"]);
/** Recursive, unlimited-depth walk. Symlinks are not followed, so a link loop cannot hang it. */
function walk(root, dir, models, unreadable) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    }
    catch (err) {
        unreadable.push({ path: dir, reason: err instanceof Error ? err.message : String(err) });
        return;
    }
    for (const entry of entries) {
        if (entry.isSymbolicLink())
            continue;
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            walk(root, fullPath, models, unreadable);
            continue;
        }
        if (!entry.isFile())
            continue;
        const dotIndex = entry.name.lastIndexOf(".");
        if (dotIndex === -1)
            continue;
        const extension = entry.name.slice(dotIndex).toLowerCase();
        if (!MODEL_EXTENSIONS.has(extension))
            continue;
        const stat = statSync(fullPath);
        models.push({
            path: fullPath,
            relativePath: relative(root, fullPath).split("\\").join("/"),
            fileName: entry.name,
            extension,
            sizeBytes: stat.size,
            lastModified: stat.mtime.toISOString(),
        });
    }
}
export function configureDiscoverTools(server, model) {
    server.tool("ea_find_models", "Recursively scan a directory for Enterprise Architect model files (.eap, .eapx, .qea, matched case-insensitively) at any depth. Use this to enumerate candidates before calling `ea_switch_model` when a root directory is known but the specific file is not. Does not open or touch the currently open model. Returns `root` (the resolved directory scanned) and `models` (each with `path`, `relativePath`, `fileName`, `extension`, `sizeBytes`, `lastModified`), ordered by `relativePath`. Walk a large tree with `offset` rather than a larger `limit`; while rows remain, `continuation` names the next call. `unreadable` lists directories skipped because they could not be read, each with `path` and `reason`. A listed file is a candidate by extension only, not a verified model.", {
        root: z.string().describe("Directory to scan recursively for model files"),
        limit: limitParam(100),
        offset: offsetParam,
    }, READ_ONLY, async ({ root, limit, offset }) => {
        const resolvedRoot = resolve(root);
        if (!existsSync(resolvedRoot)) {
            return {
                content: [{ type: "text", text: JSON.stringify({ error: "not_found", message: `Directory not found: "${resolvedRoot}"`, root: resolvedRoot }, null, 2) }],
                isError: true,
            };
        }
        if (!statSync(resolvedRoot).isDirectory()) {
            return {
                content: [{ type: "text", text: JSON.stringify({ error: "not_a_directory", message: `Not a directory: "${resolvedRoot}"`, root: resolvedRoot }, null, 2) }],
                isError: true,
            };
        }
        const allModels = [];
        const unreadable = [];
        walk(resolvedRoot, resolvedRoot, allModels, unreadable);
        allModels.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
        const totalMatched = allModels.length;
        const models = allModels.slice(offset, offset + limit);
        const truncated = isTruncated(offset, models.length, totalMatched);
        const continuation = buildContinuation("ea_find_models", { root, limit }, offset, models.length, totalMatched);
        const response = {
            root: resolvedRoot,
            models,
            totalMatched,
            returned: models.length,
            offset,
            truncated,
            ...(continuation ? { continuation } : {}),
            unreadable,
            _meta: { sourceTables: [] },
        };
        return {
            content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
    });
}
