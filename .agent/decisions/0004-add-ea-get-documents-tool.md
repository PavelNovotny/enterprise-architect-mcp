Status: Done
Date: 2026-09-29

# Add ea_get_documents tool for embedded document access

## Context

The `t_document` table holds embedded documents linked to model elements via
`ElementID` (an element's `ea_guid`). The HC-ADAPTER model has 6 rows in
`t_document`, but no MCP tool queries this table. `ea_get_element` returns
attributes, operations, diagrams, and constraints — not documents.

The ModificationSheet package (id 26) has zero elements in `t_object`, so its
content is likely stored as documents attached to the package element itself
(element id 195, type Package) rather than as child elements.

`t_document` columns: `DocID`, `DocName`, `Notes`, `ElementID`, `ElementType`,
`StrContent` (TEXT), `BinContent` (BLOB), `DocType`, `Author`, `Version`,
`IsActive`, `Sequence`, `DocDate`.

## Decision

Add a new `ea_get_documents` tool in `src/tools/documents.ts` that takes an
`elementId` (Object_ID) and returns linked documents from `t_document`.

The tool resolves the element's `ea_guid` from `t_object`, then queries
`t_document WHERE ElementID = ?`. Returns `DocName`, `DocType`, `Author`,
`Version`, `IsActive`, `Sequence`, `DocDate`, `Notes`, `StrContent` (text
documents), and a flag indicating whether `BinContent` is non-null (binary
documents — the blob itself is not returned, as it may be large and is not
text-readable).

Register the tool in `src/tools.ts` alongside the other tool configurations.

## Consequences

- Embedded documents become accessible via MCP — ModificationSheet content,
  attached specs, and other linked documents.
- Binary content (`BinContent`) is reported as present/absent, not returned
  inline, to avoid large non-text payloads.
- `ea_get_element` stays unchanged — documents are a separate concern, fetched
  on demand.
- The tool reads one table (`t_document`) and joins `t_object` for `ea_guid`
  resolution only.
