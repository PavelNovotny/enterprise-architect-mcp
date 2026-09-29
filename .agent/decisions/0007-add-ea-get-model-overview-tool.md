Status: Done
Date: 2026-09-29

# Add ea_get_model_overview tool

## Context

A fresh agent needs 5-6 calls to orient itself in a new EA model:
`ea_get_model_info`, `ea_get_package_tree`, `ea_list_diagrams`, and a couple
of `ea_list_elements` calls to understand the structure. The
`ea-model-reading` skill documents this workflow, but a single-call
overview would let the agent skip straight to the relevant package or
diagram.

## Decision

Add a new `ea_get_model_overview` tool in `src/tools/overview.ts` that
returns in one call:

- Model identity (fileName, fileSizeBytes, lastModified, serverVersion) —
  same as `ea_get_model_info`
- Full package tree with element counts (recursive, capped at 200 packages)
- Diagram list (all diagrams with id, name, type, packagePath) — capped
  at 100
- Total element count from `t_object`

No filters, no pagination — this is a one-shot orientation call. If the
model is large enough that the response is truncated, the agent falls back
to the individual tools (package tree, list diagrams) with pagination.

Register in `src/tools.ts`.

## Consequences

- A fresh agent gets oriented in one call instead of 5-6.
- Response size is bounded by the 200-package and 100-diagram caps.
- The tool reads 3 tables (`t_object`, `t_package`, `t_diagram`) and
  reuses `buildPackagePath` from `package-path.ts` for diagram package
  paths.
- `ea_get_model_info` stays as-is — `ea_get_model_overview` is a superset
  for first-use; `ea_get_model_info` remains useful for lightweight checks.
