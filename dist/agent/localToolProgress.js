export function createEmptyLocalToolProgress() {
    return {
        consecutiveSearches: 0,
        consecutiveReads: 0,
        consecutiveInvalidOutputs: 0,
        totalSearches: 0,
        searchesAfterFirstRead: 0,
        firstReadHappened: false,
        lastSearchQueries: [],
        lastReadPaths: [],
        searchedSinceLastRead: false,
        readSinceLastSearch: false
    };
}
export function updateLocalToolProgress(input) {
    const next = { ...input.progress };
    next.lastToolName = input.toolName;
    if (!input.ok)
        return next;
    if (input.toolName === "search") {
        next.totalSearches += 1;
        next.consecutiveSearches += 1;
        next.consecutiveReads = 0;
        next.searchedSinceLastRead = true;
        next.readSinceLastSearch = false;
        if (next.firstReadHappened) {
            next.searchesAfterFirstRead += 1;
        }
        const query = typeof input.args.query === "string" ? input.args.query : "";
        if (query)
            next.lastSearchQueries = [...next.lastSearchQueries, query].slice(-5);
    }
    else if (input.toolName === "read") {
        next.firstReadHappened = true;
        next.consecutiveReads += 1;
        next.consecutiveSearches = 0;
        next.readSinceLastSearch = true;
        next.searchedSinceLastRead = false;
        const path = typeof input.args.path === "string" ? input.args.path : "";
        if (path)
            next.lastReadPaths = [...next.lastReadPaths, path].slice(-5);
    }
    else {
        next.consecutiveSearches = 0;
        next.consecutiveReads = 0;
    }
    return next;
}
