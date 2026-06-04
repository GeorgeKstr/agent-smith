/**
 * Immediately re-index the files touched by a patch so retrieval/graph data
 * stays consistent before checks run.
 */
export async function reindexAffected(indexer, relPaths) {
    const unique = [...new Set(relPaths)];
    await indexer.reindexPaths(unique);
    return { changed: unique };
}
