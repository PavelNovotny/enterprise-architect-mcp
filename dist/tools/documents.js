import { READ_ONLY } from "./annotations.js";
import { z } from "zod";
import { decodeEntities } from "../text.js";
export function configureDocumentTools(server, model) {
    server.tool("ea_get_documents", "Get embedded documents linked to an Enterprise Architect element. Documents are stored in `t_document` and linked via the element's `ea_guid`. Returns `DocName`, `DocType`, `Author`, `Version`, `Notes`, `StrContent` (text documents), and `hasBinaryContent` (whether `BinContent` is non-null). Binary content is not returned inline.", {
        elementId: z.coerce.number().describe("The Object_ID of the element to get documents for"),
    }, READ_ONLY, async ({ elementId }) => {
        const db = await model.database();
        try {
            // Resolve the element's ea_guid
            const element = db.prepare("SELECT ea_guid FROM t_object WHERE Object_ID = ?").get(elementId);
            if (!element) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ error: "not_found", message: `Element with ID ${elementId} not found`, elementId }, null, 2) }],
                    isError: true,
                };
            }
            const rows = db.prepare(`
          SELECT DocID, DocName, DocType, Author, Version, IsActive, Sequence, DocDate,
                 Notes, StrContent, BinContent IS NOT NULL as hasBinaryContent
          FROM t_document
          WHERE ElementID = ?
          ORDER BY Sequence
        `).all(element.ea_guid);
            const documents = rows.map((r) => ({
                docId: r.DocID,
                name: r.DocName,
                type: r.DocType,
                author: r.Author,
                version: r.Version,
                isActive: r.IsActive === 1,
                sequence: r.Sequence,
                docDate: r.DocDate,
                notes: decodeEntities(r.Notes),
                strContent: r.StrContent,
                hasBinaryContent: r.hasBinaryContent === 1,
            }));
            const response = {
                documents,
                totalMatched: documents.length,
                returned: documents.length,
                truncated: false,
                _meta: { sourceTables: ["t_document", "t_object"] },
            };
            return {
                content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
            };
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `Error retrieving documents: ${msg}` }],
                isError: true,
            };
        }
    });
}
