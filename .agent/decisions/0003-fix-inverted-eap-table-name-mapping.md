Status: Proposed
Date: 2026-09-29

# Fix inverted EAP-to-QEA table name mapping

## Context

The EAP→SQLite converter in `src/eap-converter.ts` includes a `TABLE_NAME_MAP`
(line 18) that should rename EAP-native table names to the names the tool layer
expects (the QEA schema, as defined in `test/helpers/ea-schema.ts`).

The map is inverted: keys are the QEA/tool names and values are the EAP names.
The converter at line 129 looks up `TABLE_NAME_MAP[eapTableName]`, so the
current keys (`t_operation`, `t_operationparams`, …) never match the EAP table
names (`t_objectoperations`, `t_objectparams`, …). The EAP tables pass through
unchanged, and the tools then query names that don't exist.

Confirmed against the live file `HC-ADAPTER_Detail-design.EAP`:

| Tool | Error | SQL that fails |
|------|-------|----------------|
| `ea_search` | `no such table: t_operation` | `search.ts:264` — `SELECT … FROM t_operation` |
| `ea_get_element` | `no such table: t_operation` | `elements.ts:68` — `SELECT … FROM t_operation WHERE Object_ID = ?` |

`ea_get_package_tree` uses only `t_package` and `t_object` (not in the map), so
it is unaffected. Its intermittent "Failed to enqueue message" is a transient
MCP transport issue, not schema-related.

## Decision

Reverse `TABLE_NAME_MAP` so EAP names are keys and QEA/tool names are values:

```typescript
// src/eap-converter.ts:18-25
const TABLE_NAME_MAP: Record<string, string> = {
  t_objectoperations: "t_operation",
  t_objectparams: "t_operationparams",
  t_objectefforts: "t_objecteffort",
  t_scenarios: "t_objectscenarios",
  t_secroles: "t_secgroup",
  t_secpolperms: "t_secpolicies",
};
```

No other code changes. The converter logic at line 129
(`TABLE_NAME_MAP[eapTableName] ?? eapTableName`) then correctly translates
EAP's `t_objectoperations` → `t_operation`, and the tools find the tables
they expect.

## Consequences

- `ea_search` and `ea_get_element` work on `.EAP` files.
- `ea_get_scenarios` works (queries `t_objectscenarios`, which EAP calls
  `t_scenarios`).
- Feature-link resolution in `connectors.ts` and `diagrams.ts` works (both
  resolve GUIDs against `t_operation`).
- `.qea` files are unaffected — the map is only consulted during EAP conversion.
