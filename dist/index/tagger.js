import { heuristicTags } from "./tags.js";
/**
 * Assign global numeric tags to a file using keyword heuristics.
 * Fully algorithmic — no LLM call needed.
 */
export async function tagFile(args) {
    return heuristicTags(args.relPath, args.content);
}
