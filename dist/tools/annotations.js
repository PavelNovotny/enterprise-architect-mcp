/** The server only ever reads a local .qea export: no writes, no network, no side effects. */
export const READ_ONLY = {
    readOnlyHint: true,
    openWorldHint: false,
};
/** The tool writes files to the local filesystem (the model itself is not modified). */
export const WRITE_FILESYSTEM = {
    readOnlyHint: false,
    openWorldHint: false,
};
