Status: Done
Date: 2026-09-29

# Extract binary document content from t_document

## Context

`ea_get_documents` (slug 0004) returns document metadata and `hasBinaryContent`,
but not the binary content itself. The ModificationSheet document in the
HC-ADAPTER model has `StrContent = null` and `hasBinaryContent = true` — the
content is a binary BLOB in `t_document.BinContent`.

The BLOB is likely a Word `.doc` (OLE compound) or `.docx` (ZIP/XML) file.
`.docx` can be extracted by unzipping and reading `word/document.xml`.
Legacy `.doc` needs a dedicated parser.

The format can be detected from the first bytes of the BLOB:
- `PK` (0x504B) → ZIP archive → `.docx`
- `\xD0\xCF\x11\xE0` → OLE compound → `.doc`

## Decision

Add a `binary` boolean parameter to `ea_get_documents`. When `true`, the tool
also returns `binContentBase64` (the BLOB as base64) and `detectedFormat`
(`docx`, `doc`, `rtf`, or `unknown`, detected from the first bytes).

When `binary` is `false` (default), behavior is unchanged — no BLOB data
returned, `hasBinaryContent` flag only.

This lets the caller fetch metadata first, then request the binary content
only when needed, avoiding large payloads on every call.

## Consequences

- Binary documents become readable via MCP — the caller can decode the base64
  and parse it (or the agent can extract `.docx` text inline from the base64).
- Default behavior is unchanged — `binary: false` returns no BLOB data.
- `detectedFormat` lets the caller decide how to parse without guessing.
- Large documents increase response size when `binary: true` is requested.
