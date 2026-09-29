import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "./database.js";
import { listQeaPathCandidates, resolveQeaTarget, } from "./resolve-qea-path.js";
import { readRememberedPath, rememberPath } from "./remembered-path.js";
/** Long enough to go and find the file, short enough not to hang the conversation. */
const PROMPT_TIMEOUT_MS = 5 * 60_000;
const HOW_TO_CONFIGURE = "Provide it as a CLI argument, in the EA_QEA_PATH environment variable, " +
    "or as EA_QEA_PATH in a .env file in the working directory.";
export function describeSource(source) {
    switch (source) {
        case "argument":
            return "the command line";
        case "environment":
            return "the EA_QEA_PATH environment variable";
        case "dotenv":
            return "EA_QEA_PATH in .env";
        case "remembered":
            return "a previous answer to the path prompt";
        case "prompt":
            return "your answer to the path prompt";
    }
}
const reasonOf = (err) => (err instanceof Error ? err.message : String(err));
/** Tool errors reach the client as the message verbatim, which still owes callers structured JSON. */
const modelUnavailable = (message) => new Error(JSON.stringify({ error: "no_model", message, howToConfigure: HOW_TO_CONFIGURE }, null, 2));
export class ModelSession {
    server;
    cliArg;
    db;
    opened;
    opening;
    /** A rejected answer is not remembered, so the next prompt has to carry the reason itself. */
    lastPromptFailure;
    constructor(server, cliArg) {
        this.server = server;
        this.cliArg = cliArg;
    }
    origin() {
        return this.opened;
    }
    /** Startup diagnostics only: reports what is configured without opening anything. */
    reportConfiguration() {
        const candidates = this.candidates();
        if (candidates.length === 0) {
            console.error("mcp-server-ea: no model configured — will ask for one on first use.");
            return;
        }
        for (const candidate of candidates) {
            const target = resolve(candidate.configured);
            const status = existsSync(target) ? "exists, not opened yet" : "NOT FOUND";
            console.error(`mcp-server-ea: ${describeSource(candidate.source)} → "${target}" (${status})`);
        }
    }
    database() {
        if (this.db)
            return Promise.resolve(this.db);
        // Concurrent tool calls must share one attempt, or they each raise a prompt.
        this.opening ??= this.open().finally(() => {
            this.opening = undefined;
        });
        return this.opening;
    }
    async switchModel(path) {
        // Close the current database if open
        if (this.db) {
            try {
                this.db.close();
            }
            catch { /* best effort */ }
            this.db = undefined;
            this.opened = undefined;
        }
        const resolved = resolveQeaTarget(path);
        const db = openDatabase(resolved);
        this.db = db;
        this.opened = { source: "prompt", configured: path, ignored: [], shadowed: [] };
        console.error(`mcp-server-ea: switched to "${resolved}"`);
        return db;
    }
    candidates() {
        const configured = listQeaPathCandidates(this.cliArg);
        const remembered = readRememberedPath();
        return remembered
            ? [...configured, { source: "remembered", configured: remembered }]
            : configured;
    }
    async open() {
        const candidates = this.candidates();
        const ignored = [];
        const canAsk = Boolean(this.server.server.getClientCapabilities()?.elicitation);
        for (const [index, candidate] of candidates.entries()) {
            try {
                return this.adopt(candidate, {
                    ignored,
                    shadowed: candidates.slice(index + 1).filter((c) => c.configured !== candidate.configured),
                });
            }
            catch (err) {
                const reason = reasonOf(err);
                // Skipping a broken source only buys the user's answer a turn where an answer is possible.
                // Without a prompt there is nothing to protect, and falling through would quietly open some
                // other session's model. An explicit argument is this run's intent, never a stale default.
                if (candidate.source === "argument" || !canAsk) {
                    throw modelUnavailable(`${reason} — configured by ${describeSource(candidate.source)}.`);
                }
                ignored.push({ ...candidate, reason });
                console.error(`mcp-server-ea: ignoring ${describeSource(candidate.source)} ("${candidate.configured}") — ${reason}`);
            }
        }
        const answer = await this.ask(this.promptReason(ignored));
        let db;
        try {
            db = this.adopt(answer, { ignored, shadowed: [] });
        }
        catch (err) {
            // Remembering a path that does not open would make every later session start broken.
            this.lastPromptFailure = `${reasonOf(err)}.`;
            throw modelUnavailable(`${this.lastPromptFailure} Ask again to try another path.`);
        }
        this.lastPromptFailure = undefined;
        try {
            rememberPath(answer.configured);
        }
        catch (err) {
            // Persisting the answer is a convenience; the model is already open and the call must not fail.
            console.error(`mcp-server-ea: could not remember the path — ${reasonOf(err)}`);
        }
        return db;
    }
    /** Opens a candidate and, on success, makes it this session's model. */
    adopt(candidate, context) {
        const path = resolveQeaTarget(candidate.configured);
        const db = openDatabase(path);
        this.db = db;
        this.opened = { ...candidate, ...context };
        console.error(`mcp-server-ea: opened "${path}" from ${describeSource(candidate.source)}`);
        return db;
    }
    promptReason(ignored) {
        if (this.lastPromptFailure) {
            return `That path did not work — ${this.lastPromptFailure}`;
        }
        if (ignored.length > 0) {
            return `The model configured by ${describeSource(ignored[0].source)} could not be opened — ${ignored[0].reason}.`;
        }
        return "No Enterprise Architect model is configured yet.";
    }
    async ask(reason) {
        if (!this.server.server.getClientCapabilities()?.elicitation) {
            throw modelUnavailable(`${reason} This client cannot prompt for one.`);
        }
        let result;
        try {
            result = await this.server.server.elicitInput({
                message: `${reason} Where is your .qea or .eap file?`,
                requestedSchema: {
                    type: "object",
                    properties: {
                        qea_path: {
                            type: "string",
                            title: "Model path",
                            description: "Full path to a .qea or .eap file, or to a folder containing one — " +
                                "the newest model file in that folder is used.",
                        },
                    },
                    required: ["qea_path"],
                },
            }, { timeout: PROMPT_TIMEOUT_MS });
        }
        catch (err) {
            if (err.code === ErrorCode.RequestTimeout) {
                throw modelUnavailable("The model path prompt went unanswered. Ask again to retry, or set it up permanently.");
            }
            throw err;
        }
        if (result.action !== "accept") {
            throw modelUnavailable("No model path was given, so there is nothing to read. Ask again to retry, or set it up permanently.");
        }
        const configured = String(result.content?.qea_path ?? "").trim();
        if (!configured) {
            // An empty value would resolve to the working directory and open whatever it finds there.
            this.lastPromptFailure = "the answer was empty.";
            throw modelUnavailable("No path was entered. Ask again to try another path.");
        }
        return { source: "prompt", configured };
    }
}
