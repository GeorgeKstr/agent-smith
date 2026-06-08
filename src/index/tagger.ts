import type { SmithConfig } from "../types/index.js";
import { heuristicTags } from "./tags.js";

/**
 * Assign global numeric tags to a file using keyword heuristics.
 * Fully algorithmic — no LLM call needed.
 */
export async function tagFile(args: {
  config: SmithConfig;
  relPath: string;
  language: string;
  content: string;
  model?: string;
}): Promise<number[]> {
  return heuristicTags(args.relPath, args.content);
}
