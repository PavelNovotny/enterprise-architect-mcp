Status: Done
Date: 2026-09-29

# Add content extraction to ea_get_documents

## Context

`ea_get_documents` (slug 0004/0005) returns binary documents as base64, but
reading them requires manual steps: decode base64, unzip, parse RTF. The
`detectedFormat` reports `docx` (ZIP signature), but the actual content is
RTF inside a ZIP — EA stores embedded `ModelDocument` content as RTF in a
single `str.dat` entry.

The format is predictable: ZIP containing one entry `str.dat`, which is an
RTF document. No external library is needed — Node's `zlib.inflateRawSync`
unzips the entry, and a simple regex stripper extracts plain text from RTF.

## Decision

Add a `content` boolean parameter to `ea_get_documents`. When `true`, the tool
extracts and returns `textContent` (plain text) for binary documents by:

1. Unzipping the BLOB (ZIP format — find local file header, read `str.dat`)
2. Inflating the entry with `zlib.inflateRawSync`
3. Stripping RTF control words, unicode escapes, hex escapes, and braces
4. Collapsing whitespace into readable lines

When `content` is `false` (default), behavior is unchanged.

Also update `detectedFormat` to report `rtf` (not `docx`) when the ZIP
contains `str.dat` with RTF content, so the format is accurate.

## Consequences

- Document content is readable in one call — no manual base64/unzip/RTF
  steps.
- `detectedFormat` becomes accurate for EA embedded documents (`rtf`, not
  `docx`).
- Plain text extraction loses formatting (fonts, styles, tables) but
  preserves the textual content — sufficient for reading modification
  sheets and similar documents.
- `content: true` adds CPU cost for unzip + RTF stripping, bounded by
  document size (typically small in EA models).
