Status: Done
Date: 2026-09-29

# Add Length, Precision, Scale to ea_get_element attributes

## Context

`ea_get_element` in `src/tools/elements.ts` selects `ID, Name, Type, Scope,
Stereotype, Notes, LowerBound, UpperBound, "Default"` from `t_attribute`. The
`t_attribute` table also has `Length` (INTEGER), `Precision` (INTEGER), and
`Scale` (INTEGER) columns that the query skips.

These columns hold the varchar length and numeric precision/scale shown in EA
diagrams. Without them, DDL generation from the model is incomplete — column
types like `varchar` have no length, and `number` has no precision/scale.

Confirmed: `t_attributetag` has 0 rows in the HC-ADAPTER model, so the lengths
are not in tagged values — they are in `t_attribute.Length`.

## Decision

Add `Length`, `Precision`, `Scale` to the attribute SELECT in `ea_get_element`
and include them in each attribute's output object as `length`, `precision`,
`scale` (null when not set).

One change: `src/tools/elements.ts` line 44-49 — add three columns to the
SELECT. Map them in the attribute output object alongside `type` and
`multiplicity`.

## Consequences

- DDL generation from `ea_get_element` output includes varchar lengths and
  numeric precision/scale.
- Existing consumers see three new nullable fields on each attribute — no
  breaking change, they are additive.
- No new tables, no new queries — just three more columns in an existing
  SELECT.
