/** Which configuration source supplied the path. */
export type QeaPathSource = "argument" | "environment" | "dotenv" | "remembered" | "prompt";
export interface QeaPathCandidate {
    source: QeaPathSource;
    /** The value as configured, before resolution or directory scanning. */
    configured: string;
}
export interface RejectedCandidate extends QeaPathCandidate {
    reason: string;
}
export interface QeaPathOrigin extends QeaPathCandidate {
    /** Higher-priority sources that were tried and could not be opened. */
    ignored: RejectedCandidate[];
    /** Lower-priority sources carrying a different value — a forgotten setting shows up here. */
    shadowed: QeaPathCandidate[];
}
/**
 * The configured sources in priority order, without touching the filesystem
 * beyond reading .env.
 *
 * An empty source counts as unset, so a skipped ${input:...} in VS Code
 * (substituted as "") drops out here.
 */
export declare function listQeaPathCandidates(cliArg?: string): QeaPathCandidate[];
/** Turns a configured value into a concrete model file path (.qea or .eap). */
export declare function resolveQeaTarget(target: string): string;
