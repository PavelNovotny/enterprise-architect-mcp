import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
/** The server only ever reads a local .qea export: no writes, no network, no side effects. */
export declare const READ_ONLY: ToolAnnotations;
/** The tool writes files to the local filesystem (the model itself is not modified). */
export declare const WRITE_FILESYSTEM: ToolAnnotations;
