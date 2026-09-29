Status: Proposed
Date: 2026-09-29

# Add ea_export_document tool for writing a single embedded document to disk

## Context

`ea_get_documents` (slug 0004/0005/0006) can return embedded documents as
base64 (`binary: true`) or plain text (`content: true`), but saving them as
files requires the caller to manually decode base64, unzip the ZIP, and write
the result. This is impractical over MCP — the agent must round-trip large
base64 strings through tool calls, then shell out to decode and write them.

The existing `extractZipEntry` and `detectFormat` helpers in
`src/tools/documents.ts` already handle the ZIP/RTF extraction. The new tool
reuses them.

## Decision

Add a new `ea_export_document` tool in `src/tools/documents.ts` that writes a
single embedded document from the EA model to a file on disk.

Parameters:
- `elementId` (number, required) — the `Object_ID` of the element whose
  documents to export. The element's `ea_guid` is resolved from `t_object`
  and used to find linked rows in `t_document`.
- `outputDir` (string, required) — absolute path to the target directory.
  Created if it doesn't exist.

Behavior:
1. Resolve `ea_guid` from `t_object WHERE Object_ID = ?`.
2. Query `t_document WHERE ElementID = ?` for that element's documents.
3. For each document with `hasBinaryContent = true`:
   - Extract `str.dat` from the ZIP BLOB via `extractZipEntry`.
   - Write the raw RTF content to `<outputDir>/<DocName>.rtf`.
   - If the BLOB is not a ZIP (no `str.dat`), write the raw BLOB with the
     detected extension (`.doc`, `.docx`, `.rtf`).
4. For documents with `StrContent` (text, no BLOB), write `<DocName>.txt`.
5. Skip documents with neither `StrContent` nor `BinContent`.

Response:
- `exported`: array of `{ name, fileName, format, bytesWritten }` for each
  file written.
- `skipped`: array of `{ name, reason }` for documents that had no content.
- `outputDir`: the resolved absolute path.
- `totalExported`, `totalSkipped`: counts.

Filename sanitization: replace characters invalid in filenames (`/`, `\`,
`:`, `*`, `?`, `"`, `<`, `>`, `|`) with `_`. Append `.rtf` if no extension
is present.

Annotation: not `READ_ONLY` — the tool writes to the filesystem. Use a new
`WRITE_FILESYSTEM` annotation with `readOnlyHint: false`, `openWorldHint: false`.

## Consequences

- `src/tools/documents.ts`: new `ea_export_document` entry in
  `configureDocumentTools`, reusing `extractZipEntry`, `detectFormat`. New
  `WRITE_FILESYSTEM` annotation in `src/tools/annotations.ts`.
- `src/tools.ts`: register the new tool alongside existing document tools.
- `.agent/design.md`: add a section describing the export tool.
- `.agent/tasks.md`: add the new tool as implemented.
- The model database is not modified — the tool reads `t_document` and writes
  to the filesystem only.
