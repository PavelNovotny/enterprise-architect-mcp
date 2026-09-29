import { READ_ONLY } from "./annotations.js";
import { z } from "zod";
import { buildPackagePath } from "../package-path.js";
import { decodeEntities } from "../text.js";
import { breakdownApplies, buildBreakdown, buildContinuation, isTruncated, limitParam, offsetParam } from "./windowing.js";
const MAX_INLINE_ITEMS = 50;
const formatMultiplicity = (a) => a.LowerBound && a.UpperBound ? `${a.LowerBound}..${a.UpperBound}` : undefined;
export function configureElementTools(server, model) {
    server.tool("ea_get_element", "Get full details of an Enterprise Architect element by its ID, including its `Note`, `attributes`, `operations`, the `diagrams` it appears on, and its `constraints`. Attribute multiplicity supports a requiredness inference only when the element uses multiplicities contrastively; read `_meta.attributes.multiplicityIsUniform` before making that inference — when it is true the element's attributes carry no multiplicity contrast, so a value like 1..1 is not evidence of requiredness. Attributes and operations are capped inline: `attributesTruncated`/`operationsTruncated` say whether the returned list is partial, and `attributesTotal`/`operationsTotal` give the full counts, so never infer a count from the inline list alone.", {
        elementId: z.coerce.number().describe("The Object_ID of the element to retrieve"),
    }, READ_ONLY, async ({ elementId }) => {
        const db = await model.database();
        try {
            const element = db.prepare(`
          SELECT o.Object_ID, o.Object_Type, o.Name, o.Alias, o.Stereotype,
                 o.Package_ID, p.Name as PackageName, o.Note, o.Status,
                 o.Author, o.CreatedDate, o.ModifiedDate, o.Phase, o.Complexity
          FROM t_object o
          LEFT JOIN t_package p ON o.Package_ID = p.Package_ID
          WHERE o.Object_ID = ?
        `).get(elementId);
            if (!element) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ error: "not_found", message: `Element with ID ${elementId} not found`, elementId }, null, 2) }],
                    isError: true,
                };
            }
            // Get attributes
            const allAttributes = db.prepare(`
          SELECT ID, Name, Type, Scope, Stereotype, Notes, LowerBound, UpperBound, "Default",
                 Length, Precision, Scale
          FROM t_attribute
          WHERE Object_ID = ?
          ORDER BY Pos
        `).all(elementId);
            const attributesTruncated = allAttributes.length > MAX_INLINE_ITEMS;
            const attributes = allAttributes.slice(0, MAX_INLINE_ITEMS).map((a) => ({
                id: a.ID,
                name: a.Name,
                type: a.Type,
                scope: a.Scope,
                stereotype: a.Stereotype,
                notes: decodeEntities(a.Notes),
                multiplicity: formatMultiplicity(a),
                default: a.Default,
                length: a.Length,
                precision: a.Precision,
                scale: a.Scale,
            }));
            // Computed over every attribute, not the inline slice, so truncation cannot flip the flag.
            const multiplicityIsUniform = new Set(allAttributes.map(formatMultiplicity).filter((m) => m !== undefined)).size < 2;
            // Get operations
            const allOperations = db.prepare(`
          SELECT OperationID, Name, Type, Scope, Stereotype, Notes
          FROM t_operation
          WHERE Object_ID = ?
          ORDER BY Pos
        `).all(elementId);
            const operationsTruncated = allOperations.length > MAX_INLINE_ITEMS;
            const operations = allOperations.slice(0, MAX_INLINE_ITEMS).map((op) => {
                const params = db.prepare(`
            SELECT Name, Type, Kind, Notes
            FROM t_operationparams
            WHERE OperationID = ?
            ORDER BY Pos
          `).all(op.OperationID);
                return {
                    id: op.OperationID,
                    name: op.Name,
                    returnType: op.Type,
                    scope: op.Scope,
                    stereotype: op.Stereotype,
                    notes: decodeEntities(op.Notes),
                    parameters: params.map((p) => ({
                        name: p.Name,
                        type: p.Type,
                        kind: p.Kind,
                        notes: decodeEntities(p.Notes),
                    })),
                };
            });
            // R4: Diagrams this element appears on
            const diagramRows = db.prepare(`
          SELECT d.Diagram_ID, d.Name, d.Diagram_Type, d.Package_ID
          FROM t_diagramobjects do_
          JOIN t_diagram d ON do_.Diagram_ID = d.Diagram_ID
          WHERE do_.Object_ID = ?
        `).all(elementId);
            const diagrams = diagramRows.map((d) => ({
                diagramId: d.Diagram_ID,
                name: d.Name,
                type: d.Diagram_Type,
                packagePath: buildPackagePath(db, d.Package_ID),
            }));
            // R10: Constraints (pre-conditions, post-conditions, invariants, process rules)
            const constraintRows = db.prepare(`
          SELECT "Constraint" as name, ConstraintType, Notes, Status
          FROM t_objectconstraint
          WHERE Object_ID = ?
          ORDER BY ConstraintType, "Constraint"
        `).all(elementId);
            const constraints = constraintRows.map((c) => ({
                name: c.name,
                type: c.ConstraintType,
                notes: decodeEntities(c.Notes),
                status: c.Status || null,
            }));
            const result = {
                ...element,
                Note: decodeEntities(element.Note),
                attributes,
                attributesTruncated,
                attributesTotal: allAttributes.length,
                operations,
                operationsTruncated,
                operationsTotal: allOperations.length,
                diagrams,
                constraints,
                _meta: {
                    sourceTables: ["t_object", "t_package", "t_attribute", "t_operation", "t_operationparams", "t_diagramobjects", "t_diagram", "t_objectconstraint"],
                    attributes: { totalMatched: allAttributes.length, returned: attributes.length, truncated: attributesTruncated, multiplicityIsUniform },
                    operations: { totalMatched: allOperations.length, returned: operations.length, truncated: operationsTruncated },
                    diagrams: { totalMatched: diagramRows.length, returned: diagrams.length, truncated: false },
                    constraints: { totalMatched: constraintRows.length, returned: constraints.length, truncated: false },
                },
            };
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `Error retrieving element: ${msg}` }],
                isError: true,
            };
        }
    });
    server.tool("ea_list_elements", "List elements within a package, optionally filtered by object type. `elements` is a lightweight list (ID, type, name, alias, stereotype), grouped by element type and then ordered by the model's internal identity. That order is stable but artificial \u2014 neither alphabetical nor the analyst's tree order \u2014 so adjacency carries no meaning. Walk a large package with `offset` rather than a larger `limit`; while rows remain, `continuation` names the next call. When far more elements match than one window can hold, `breakdown` reports how many each type holds, so the next call can narrow by `objectType` instead of paging.", {
        packageId: z.coerce.number().describe("The Package_ID to list elements from"),
        objectType: z
            .string()
            .optional()
            .describe("Filter by object type (e.g., Class, UseCase, Activity, Screen)"),
        limit: limitParam(50),
        offset: offsetParam,
    }, READ_ONLY, async ({ packageId, objectType, limit, offset }) => {
        const db = await model.database();
        try {
            // Verify package exists
            const pkgExists = db.prepare("SELECT Package_ID FROM t_package WHERE Package_ID = ?").get(packageId);
            if (!pkgExists) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ error: "not_found", message: `Package with ID ${packageId} not found`, packageId }, null, 2) }],
                    isError: true,
                };
            }
            let sql = `
          SELECT Object_ID, Object_Type, Name, Alias, Stereotype
          FROM t_object
          WHERE Package_ID = ?
        `;
            const params = [packageId];
            if (objectType) {
                sql += " AND Object_Type = ?";
                params.push(objectType);
            }
            // Identity, not Name: SQLite's binary collation sorts every accented initial
            // past Z, which systematically exiles them from a truncated window.
            sql += " ORDER BY Object_Type, Object_ID LIMIT ? OFFSET ?";
            params.push(limit, offset);
            const rows = db.prepare(sql).all(...params);
            // Count total without limit for truncation reporting
            let countSql = "SELECT COUNT(*) as cnt FROM t_object WHERE Package_ID = ?";
            const countParams = [packageId];
            if (objectType) {
                countSql += " AND Object_Type = ?";
                countParams.push(objectType);
            }
            const totalMatched = db.prepare(countSql).get(...countParams).cnt;
            const truncated = isTruncated(offset, rows.length, totalMatched);
            let breakdown;
            if (!objectType && breakdownApplies(totalMatched, limit)) {
                const typeRows = db
                    .prepare("SELECT Object_Type, COUNT(*) as cnt FROM t_object WHERE Package_ID = ? GROUP BY Object_Type")
                    .all(packageId);
                breakdown = buildBreakdown({
                    objectType: new Map(typeRows.filter((r) => r.Object_Type).map((r) => [String(r.Object_Type), r.cnt])),
                });
            }
            const continuation = buildContinuation("ea_list_elements", { packageId, objectType, limit }, offset, rows.length, totalMatched);
            const response = {
                elements: rows,
                totalMatched,
                returned: rows.length,
                offset,
                truncated,
                ...(breakdown ? { breakdown } : {}),
                ...(continuation ? { continuation } : {}),
                _meta: { sourceTables: ["t_object"] },
            };
            return {
                content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
            };
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `Error listing elements: ${msg}` }],
                isError: true,
            };
        }
    });
}
