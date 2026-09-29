import { configureSearchTools } from "./tools/search.js";
import { configureElementTools } from "./tools/elements.js";
import { configureConnectorTools } from "./tools/connectors.js";
import { configurePackageTools } from "./tools/packages.js";
import { configureDiagramTools } from "./tools/diagrams.js";
import { configureScenarioTools } from "./tools/scenarios.js";
import { configureSchemaTools } from "./tools/schema.js";
import { configureResolveTools } from "./tools/resolve.js";
import { configureDocumentTools } from "./tools/documents.js";
import { configureOverviewTools } from "./tools/overview.js";
import { configureSwitchTools } from "./tools/switch.js";
import { configureDiscoverTools } from "./tools/discover.js";
export function configureAllTools(server, model) {
    configureSearchTools(server, model);
    configureElementTools(server, model);
    configureConnectorTools(server, model);
    configurePackageTools(server, model);
    configureDiagramTools(server, model);
    configureScenarioTools(server, model);
    configureSchemaTools(server, model);
    configureResolveTools(server, model);
    configureDocumentTools(server, model);
    configureOverviewTools(server, model);
    configureSwitchTools(server, model);
    configureDiscoverTools(server, model);
}
