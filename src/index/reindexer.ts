import type { Indexer } from "./indexer.js";

/**
 * Immediately re-index the files touched by a patch so retrieval/graph data
 * stays consistent before checks run.
 */
export async function reindexAffected(indexer: Indexer, relPaths: string[]): Promise<{ changed: string[] }> {
  const unique = [...new Set(relPaths)];
  await indexer.reindexPaths(unique);
  return { changed: unique };
}
