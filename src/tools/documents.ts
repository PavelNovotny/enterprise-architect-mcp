import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ModelAccess } from "../model-session.js";
import { READ_ONLY } from "./annotations.js";
import { z } from "zod";
import { decodeEntities } from "../text.js";
import { inflateRawSync } from "node:zlib";

/** Detect document format from the BLOB, peering inside ZIP for EA's RTF-in-ZIP. */
function detectFormat(buf: Buffer): "docx" | "doc" | "rtf" | "unknown" {
  if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return "doc"; // OLE compound
  if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "{\\rt") return "rtf";
  // ZIP — check if it contains str.dat with RTF (EA's ModelDocument format)
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
    const inner = extractZipEntry(buf, "str.dat");
    if (inner && inner.length >= 4 && inner.subarray(0, 4).toString("ascii") === "{\\rt") return "rtf";
    return "docx";
  }
  return "unknown";
}

/** Extract a file entry from a minimal ZIP archive by name. Returns the inflated content. */
function extractZipEntry(buf: Buffer, entryName: string): Buffer | null {
  // Scan local file headers (signature 0x04034b50)
  let offset = 0;
  while (offset < buf.length - 4) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) { offset++; continue; }

    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString("ascii");

    if (name === entryName) {
      const dataStart = offset + 30 + nameLen + extraLen;
      const rawData = buf.subarray(dataStart, dataStart + compSize);
      if (method === 8) return inflateRawSync(rawData); // deflate
      if (method === 0) return rawData;                   // stored
      return null;
    }
    offset += 30 + nameLen + extraLen + (method === 0 ? 0 : 0);
    // For scanning, advance past the entry data
    if (compSize > 0) offset = offset + 30 + nameLen + extraLen + compSize - (30 + nameLen + extraLen);
  }
  return null;
}

/** Strip RTF to plain text. */
function stripRtf(rtf: Buffer): string {
  let text = rtf.toString("latin1");
  // Unicode escapes \uNNNN
  text = text.replace(/\\u(-?\d+)\??/g, (_, n) => {
    const code = parseInt(n);
    return String.fromCharCode(code >= 0 ? code & 0xFFFF : code + 0x10000);
  });
  // Hex escapes \'NN
  text = text.replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => Buffer.from(h, "hex").toString("latin1"));
  // RTF control words (with optional numeric arg)
  text = text.replace(/\\[a-zA-Z]+-?\d* ?/g, "");
  // Remaining backslash escapes
  text = text.replace(/\\[^a-zA-Z]/g, "");
  // Braces
  text = text.replace(/[{}]/g, "");
  // Collapse whitespace into readable lines
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0).join("\n");
}

/** Extract plain text content from a binary document BLOB. */
function extractContent(buf: Buffer): string | null {
  const fmt = detectFormat(buf);
  if (fmt === "rtf" && buf.subarray(0, 4).toString("ascii") === "{\\rt") {
    return stripRtf(buf);
  }
  if (fmt === "rtf") {
    // RTF inside ZIP (EA ModelDocument)
    const inner = extractZipEntry(buf, "str.dat");
    if (inner) return stripRtf(inner);
  }
  if (fmt === "docx") {
    const inner = extractZipEntry(buf, "word/document.xml");
    if (inner) {
      // Extract text from <w:t> elements
      const xml = inner.toString("utf8");
      return xml.replace(/<[^>]+>/g, "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0).join("\n");
    }
  }
  return null;
}

export function configureDocumentTools(server: McpServer, model: ModelAccess): void {
  server.tool(
    "ea_get_documents",
    "Get embedded documents linked to an Enterprise Architect element. Documents are stored in `t_document` and linked via the element's `ea_guid`. Returns `DocName`, `DocType`, `Author`, `Version`, `Notes`, `StrContent` (text documents), and `hasBinaryContent` (whether `BinContent` is non-null). Set `binary: true` to also return `binContentBase64` (the BLOB as base64) and `detectedFormat` (`docx`, `doc`, `rtf`, or `unknown`). Set `content: true` to extract and return `textContent` (plain text) from binary documents — EA stores embedded documents as RTF inside a ZIP, which is unzipped and stripped to plain text.",
    {
      elementId: z.coerce.number().describe("The Object_ID of the element to get documents for"),
      binary: z.coerce.boolean().default(false).describe("When true, return binContentBase64 and detectedFormat for binary documents"),
      content: z.coerce.boolean().default(false).describe("When true, extract and return textContent (plain text) from binary documents"),
    },
    READ_ONLY,
    async ({ elementId, binary, content }) => {
      const db = await model.database();
      try {
        const element = db.prepare("SELECT ea_guid FROM t_object WHERE Object_ID = ?").get(elementId) as { ea_guid: string } | undefined;
        if (!element) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found", message: `Element with ID ${elementId} not found`, elementId }, null, 2) }],
            isError: true,
          };
        }

        const needBlob = binary || content;
        const selectCols = needBlob
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

          if (needBlob && r.hasBinaryContent === 1 && r.BinContent) {
            const buf = Buffer.from(r.BinContent as Uint8Array);
            doc.detectedFormat = detectFormat(buf);

            if (binary) doc.binContentBase64 = buf.toString("base64");

            if (content) {
              const text = extractContent(buf);
              if (text !== null) doc.textContent = text;
            }
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
