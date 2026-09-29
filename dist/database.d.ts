import { DatabaseSync } from "node:sqlite";
export type Database = DatabaseSync;
/** Returns the original file path — the .qea path or the .EAP path, not a temp SQLite file. */
export declare function getOriginalPath(): string | undefined;
/** Resets the original path tracking — for testing. */
export declare function resetOriginalPath(): void;
export declare function openDatabase(path: string): Database;
