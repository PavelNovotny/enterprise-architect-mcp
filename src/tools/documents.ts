import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ModelAccess } from "../model-session.js";
import { READ_ONLY } from "./annotations.js";
import { z } from "zod";
import { decodeEntities } from "../text.js";

/** Detect document format from the first bytes of a BLOB. */
function detectFormat(buf: Buffer): "docx" | "doc" | "rtf" | "unknown" {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return "docx";       // PK (ZIP)
  if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return "doc"; // OLE compound
  if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "{\\rt") return "rtf";
  return "unknown";
}

export function configureDocumentTools(server: McpServer, model: ModelAccess): void {
  server.tool(
    "ea_get_documents",
    "Get embedded documents linked to an Enterprise Architect element. Documents are stored in `t_document` and linked via the element's `ea_guid`. Returns `DocName`, `DocType`, `Author`, `Version`, `Notes`, `StrContent` (text documents), and `hasBinaryContent` (whether `BinContent` is non-null). Set `binary: true` to also return `binContentBase64` (the BLOB as base64) and `detectedFormat` (`docx`, `doc`, `rtf`, or `unknown`). Binary content is not returned by default to avoid large payloads.",
    {
      elementId: z.coerce.number().describe("The Object_ID of the element to get documents for"),
      binary: z.coerce.boolean().default(false).describe("When true, return binContentBase64 and detectedFormat for binary documents"),
    },
    READ_ONLY,
    async ({ elementId, binary }) => {
      const db = await model.database();
      try {
        const element = db.prepare("SELECT ea_guid FROM t_object WHERE Object_ID = ?").get(elementId) as { ea_guid: string } | undefined;
        if (!element) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found", message: `Element with ID ${elementId} not found`, elementId }, null, 2) }],
            isError: true,
          };
        }

        const selectCols = binary
          ? `DocID, DocName, DocType, Author, Version, IsActive, Sequence, DocDate, Notes, StrContent, BinContent, BinContent IS NOT NULL as hasBinaryContent`
          : `DocID, DocName, DocType, Author, Version, IsActive, Sequence, DocDate, Notes, StrContent, BinContent IS NOT NULL as hasBinaryContent`;

        const rows = db.prepare(`
          SELECT ${selectCols}
          FROM t_document
          WHERE ElementID = ?
          ORDER BY Sequence
        `).all(element.ea_guid) as any[];

        const documents = rows.map((r) => {
          const doc: any = {
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
          };

          if (binary && r.hasBinaryContent === 1 && r.BinContent) {
            const buf = Buffer.from(r.BinContent as Uint8Array);
            doc.detectedFormat = detectFormat(buf);
            doc.binContentBase64 = buf.toString("base64");
          }

          return doc;
        });

        const response = {
          documents,
          totalMatched: documents.length,
          returned: documents.length,
          truncated: false,
          _meta: { sourceTables: ["t_document", "t_object"] },
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error retrieving documents: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
