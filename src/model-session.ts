import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { openDatabase, type Database } from "./database.js";
import {
  listQeaPathCandidates,
  resolveQeaTarget,
  type QeaPathCandidate,
  type QeaPathOrigin,
  type QeaPathSource,
  type RejectedCandidate,
} from "./resolve-qea-path.js";
import { readRememberedPath, rememberPath } from "./remembered-path.js";

/** Long enough to go and find the file, short enough not to hang the conversation. */
const PROMPT_TIMEOUT_MS = 5 * 60_000;

const HOW_TO_CONFIGURE =
  "Provide it as a CLI argument, in the EA_QEA_PATH environment variable, " +
  "or as EA_QEA_PATH in a .env file in the working directory.";

/** What the tools need from the session: a database, and where it came from. */
export interface ModelAccess {
  database(): Promise<Database>;
  origin(): QeaPathOrigin | undefined;
}

export function describeSource(source: QeaPathSource): string {
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

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Tool errors reach the client as the message verbatim, which still owes callers structured JSON. */
const modelUnavailable = (message: string) =>
  new Error(JSON.stringify({ error: "no_model", message, howToConfigure: HOW_TO_CONFIGURE }, null, 2));

export class ModelSession implements ModelAccess {
  private db?: Database;
  private opened?: QeaPathOrigin;
  private opening?: Promise<Database>;
  /** A rejected answer is not remembered, so the next prompt has to carry the reason itself. */
  private lastPromptFailure?: string;

  constructor(
    private readonly server: McpServer,
    private readonly cliArg?: string
  ) {}

  origin(): QeaPathOrigin | undefined {
    return this.opened;
  }

  /** Startup diagnostics only: reports what is configured without opening anything. */
  reportConfiguration(): void {
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

  database(): Promise<Database> {
    if (this.db) return Promise.resolve(this.db);
    // Concurrent tool calls must share one attempt, or they each raise a prompt.
    this.opening ??= this.open().finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }

  private candidates(): QeaPathCandidate[] {
    const configured = listQeaPathCandidates(this.cliArg);
    const remembered = readRememberedPath();
    return remembered
      ? [...configured, { source: "remembered" as const, configured: remembered }]
      : configured;
  }

  private async open(): Promise<Database> {
    const candidates = this.candidates();
    const ignored: RejectedCandidate[] = [];
    const canAsk = Boolean(this.server.server.getClientCapabilities()?.elicitation);

    for (const [index, candidate] of candidates.entries()) {
      try {
        return this.adopt(candidate, {
          ignored,
          shadowed: candidates.slice(index + 1).filter((c) => c.configured !== candidate.configured),
        });
      } catch (err) {
        const reason = reasonOf(err);

        // Skipping a broken source only buys the user's answer a turn where an answer is possible.
        // Without a prompt there is nothing to protect, and falling through would quietly open some
        // other session's model. An explicit argument is this run's intent, never a stale default.
        if (candidate.source === "argument" || !canAsk) {
          throw modelUnavailable(`${reason} — configured by ${describeSource(candidate.source)}.`);
        }

        ignored.push({ ...candidate, reason });
        console.error(
          `mcp-server-ea: ignoring ${describeSource(candidate.source)} ("${candidate.configured}") — ${reason}`
        );
      }
    }

    const answer = await this.ask(this.promptReason(ignored));

    let db: Database;
    try {
      db = this.adopt(answer, { ignored, shadowed: [] });
    } catch (err) {
      // Remembering a path that does not open would make every later session start broken.
      this.lastPromptFailure = `${reasonOf(err)}.`;
      throw modelUnavailable(`${this.lastPromptFailure} Ask again to try another path.`);
    }

    this.lastPromptFailure = undefined;
    try {
      rememberPath(answer.configured);
    } catch (err) {
      // Persisting the answer is a convenience; the model is already open and the call must not fail.
      console.error(`mcp-server-ea: could not remember the path — ${reasonOf(err)}`);
    }
    return db;
  }

  /** Opens a candidate and, on success, makes it this session's model. */
  private adopt(
    candidate: QeaPathCandidate,
    context: { ignored: RejectedCandidate[]; shadowed: QeaPathCandidate[] }
  ): Database {
    const path = resolveQeaTarget(candidate.configured);
    const db = openDatabase(path);

    this.db = db;
    this.opened = { ...candidate, ...context };
    console.error(`mcp-server-ea: opened "${path}" from ${describeSource(candidate.source)}`);
    return db;
  }

  private promptReason(ignored: RejectedCandidate[]): string {
    if (this.lastPromptFailure) {
      return `That path did not work — ${this.lastPromptFailure}`;
    }
    if (ignored.length > 0) {
      return `The model configured by ${describeSource(ignored[0].source)} could not be opened — ${ignored[0].reason}.`;
    }
    return "No Enterprise Architect model is configured yet.";
  }

  private async ask(reason: string): Promise<QeaPathCandidate> {
    if (!this.server.server.getClientCapabilities()?.elicitation) {
      throw modelUnavailable(`${reason} This client cannot prompt for one.`);
    }

    let result;
    try {
      result = await this.server.server.elicitInput(
        {
          message: `${reason} Where is your .qea or .eap file?`,
          requestedSchema: {
            type: "object",
            properties: {
              qea_path: {
                type: "string",
                title: "Model path",
                description:
                  "Full path to a .qea or .eap file, or to a folder containing one — " +
                  "the newest model file in that folder is used.",
              },
            },
            required: ["qea_path"],
          },
        },
        { timeout: PROMPT_TIMEOUT_MS }
      );
    } catch (err) {
      if ((err as { code?: number }).code === ErrorCode.RequestTimeout) {
        throw modelUnavailable(
          "The model path prompt went unanswered. Ask again to retry, or set it up permanently."
        );
      }
      throw err;
    }

    if (result.action !== "accept") {
      throw modelUnavailable(
        "No model path was given, so there is nothing to read. Ask again to retry, or set it up permanently."
      );
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
