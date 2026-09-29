import { DatabaseSync } from "node:sqlite";
/**
 * Converts an .EAP file to a temporary SQLite database and returns the open
 * DatabaseSync handle. The caller is responsible for closing the database;
 * the temp file is deleted when the database is closed.
 */
export declare function convertEapToSqlite(eapPath: string): {
    db: DatabaseSync;
    tempPath: string;
};
