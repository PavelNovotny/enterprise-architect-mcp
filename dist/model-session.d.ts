import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Database } from "./database.js";
import { type QeaPathOrigin, type QeaPathSource } from "./resolve-qea-path.js";
/** What the tools need from the session: a database, and where it came from. */
export interface ModelAccess {
    database(): Promise<Database>;
    origin(): QeaPathOrigin | undefined;
    switchModel(path: string): Promise<Database>;
}
export declare function describeSource(source: QeaPathSource): string;
export declare class ModelSession implements ModelAccess {
    private readonly server;
    private readonly cliArg?;
    private db?;
    private opened?;
    private opening?;
    /** A rejected answer is not remembered, so the next prompt has to carry the reason itself. */
    private lastPromptFailure?;
    constructor(server: McpServer, cliArg?: string | undefined);
    origin(): QeaPathOrigin | undefined;
    /** Startup diagnostics only: reports what is configured without opening anything. */
    reportConfiguration(): void;
    database(): Promise<Database>;
    switchModel(path: string): Promise<Database>;
    private candidates;
    private open;
    /** Opens a candidate and, on success, makes it this session's model. */
    private adopt;
    private promptReason;
    private ask;
}
